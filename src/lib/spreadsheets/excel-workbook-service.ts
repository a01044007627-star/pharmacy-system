import { Readable } from "node:stream"
import ExcelJS, { type Cell, type Worksheet } from "exceljs"

export type SpreadsheetRow = Record<string, unknown>

type TemplateOptions = {
  sheetName: string
  headers: readonly string[]
  minColumnWidth?: number
  maxColumnWidth?: number
  requiredHeaders?: readonly string[]
  textHeaders?: readonly string[]
  numberHeaders?: readonly string[]
  dateHeaders?: readonly string[]
  listValidations?: readonly {
    header: string
    values: readonly (string | number)[]
  }[]
  instructions?: readonly {
    field: string
    required?: boolean
    format?: string
    example?: string
    notes?: string
  }[]
}

type ReadOptions = {
  fileName: string
  preferredSheetName?: string
}

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim() === ""
}

function formulaResult(value: ExcelJS.CellValue) {
  if (!value || typeof value !== "object" || !("result" in value)) return undefined
  return value.result
}

/**
 * Reusable Node.js spreadsheet adapter used by API routes.
 * It keeps Excel parsing/writing out of business logic and supports XLSX and CSV.
 */
export class ExcelWorkbookService {
  async createTemplate(options: TemplateOptions): Promise<ArrayBuffer> {
    const minWidth = options.minColumnWidth ?? 16
    const maxWidth = options.maxColumnWidth ?? 55
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Logixa Digital Systems"
    workbook.created = new Date()
    const worksheet = workbook.addWorksheet(options.sheetName)

    worksheet.addRow([...options.headers])
    worksheet.columns = options.headers.map((header) => ({
      width: Math.min(Math.max(header.length + 3, minWidth), maxWidth),
    }))

    const requiredHeaders = new Set(options.requiredHeaders ?? [])
    const textHeaders = new Set(options.textHeaders ?? [])
    const numberHeaders = new Set(options.numberHeaders ?? [])
    const dateHeaders = new Set(options.dateHeaders ?? [])

    const headerRow = worksheet.getRow(1)
    headerRow.height = 32
    headerRow.eachCell((cell, columnNumber) => {
      const header = options.headers[columnNumber - 1]
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: requiredHeaders.has(header) ? "FFB42318" : "FF155EEF" },
      }
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D5DD" } },
        bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
        left: { style: "thin", color: { argb: "FFD0D5DD" } },
        right: { style: "thin", color: { argb: "FFD0D5DD" } },
      }
    })

    for (let index = 0; index < options.headers.length; index += 1) {
      const header = options.headers[index]
      const column = worksheet.getColumn(index + 1)
      if (textHeaders.has(header)) column.numFmt = "@"
      if (numberHeaders.has(header)) column.numFmt = "0.###"
      if (dateHeaders.has(header)) column.numFmt = "yyyy-mm-dd"
      column.alignment = { vertical: "middle", horizontal: "right", wrapText: true }
    }

    const maxTemplateRows = 5_000
    for (const validation of options.listValidations ?? []) {
      const columnIndex = options.headers.indexOf(validation.header) + 1
      if (columnIndex <= 0 || validation.values.length === 0) continue
      const formula = `"${validation.values.map(String).join(",")}"`
      for (let rowNumber = 2; rowNumber <= maxTemplateRows; rowNumber += 1) {
        worksheet.getCell(rowNumber, columnIndex).dataValidation = {
          type: "list",
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: "error",
          errorTitle: "قيمة غير مدعومة",
          error: "اختر قيمة من القائمة المتاحة.",
          formulae: [formula],
        }
      }
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: options.headers.length },
    }
    worksheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]

    if (options.instructions?.length) {
      const instructions = workbook.addWorksheet("تعليمات")
      instructions.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]
      instructions.addRow(["الحقل", "إجباري؟", "الصيغة", "مثال", "ملاحظات"])
      for (const item of options.instructions) {
        instructions.addRow([
          item.field,
          item.required ? "نعم" : "لا",
          item.format ?? "نص",
          item.example ?? "",
          item.notes ?? "",
        ])
      }
      instructions.columns = [
        { width: 34 },
        { width: 12 },
        { width: 28 },
        { width: 30 },
        { width: 65 },
      ]
      const instructionHeader = instructions.getRow(1)
      instructionHeader.height = 28
      instructionHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF344054" } }
        cell.alignment = { vertical: "middle", horizontal: "center" }
      })
      instructions.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return
        row.alignment = { vertical: "top", horizontal: "right", wrapText: true }
        row.height = 36
      })
    }

    const output = await workbook.xlsx.writeBuffer()
    if (output instanceof ArrayBuffer) return output
    const view = output as unknown as Uint8Array
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
  }

  async readRows(buffer: Buffer, options: ReadOptions): Promise<SpreadsheetRow[]> {
    const workbook = new ExcelJS.Workbook()
    const extension = options.fileName.toLowerCase().split(".").pop()
    let worksheet: Worksheet | undefined

    if (extension === "csv") {
      worksheet = await workbook.csv.read(Readable.from([buffer]))
    } else if (extension === "xlsx") {
      const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      await workbook.xlsx.load(data)
      worksheet = this.findWorksheet(workbook, options.preferredSheetName)
    } else {
      throw new Error("صيغة الملف غير مدعومة؛ استخدم XLSX أو CSV")
    }

    if (!worksheet) return []
    return this.worksheetToRows(worksheet)
  }

  excelSerialToDate(value: number): Date | null {
    if (!Number.isFinite(value) || value <= 0) return null
    const millisecondsPerDay = 86_400_000
    const excelEpoch = Date.UTC(1899, 11, 30)
    const date = new Date(excelEpoch + Math.floor(value) * millisecondsPerDay)
    return Number.isNaN(date.getTime()) ? null : date
  }

  private findWorksheet(workbook: ExcelJS.Workbook, preferredSheetName?: string) {
    const normalizedPreferred = preferredSheetName?.trim().toLocaleLowerCase("en")
    if (normalizedPreferred) {
      const preferred = workbook.worksheets.find(
        (sheet) => sheet.name.trim().toLocaleLowerCase("en") === normalizedPreferred,
      )
      if (preferred) return preferred
    }
    return workbook.worksheets[0]
  }

  private worksheetToRows(worksheet: Worksheet): SpreadsheetRow[] {
    const headerRow = worksheet.getRow(1)
    const headers: string[] = []

    for (let column = 1; column <= headerRow.cellCount; column += 1) {
      headers[column - 1] = String(this.cellValue(headerRow.getCell(column)) ?? "").trim()
    }

    const rows: SpreadsheetRow[] = []
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const record: SpreadsheetRow = {}
      let hasValue = false

      for (let column = 1; column <= headers.length; column += 1) {
        const header = headers[column - 1]
        if (!header) continue
        const value = this.cellValue(row.getCell(column))
        record[header] = value
        if (!isBlank(value)) hasValue = true
      }

      if (hasValue) rows.push(record)
    })

    return rows
  }

  private cellValue(cell: Cell): unknown {
    const value = cell.value
    if (value === null || value === undefined) return ""
    if (value instanceof Date) return value

    const result = formulaResult(value)
    if (result !== undefined) return result

    if (typeof value === "object") {
      if ("richText" in value) return value.richText.map((part) => part.text).join("")
      if ("text" in value) return value.text
      if ("error" in value) return value.error
    }

    if (typeof value === "number" && cell.text.startsWith("0")) return cell.text
    return value
  }
}

export const excelWorkbookService = new ExcelWorkbookService()
