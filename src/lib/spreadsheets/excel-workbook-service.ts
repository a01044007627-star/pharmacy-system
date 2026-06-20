import { Readable } from "node:stream"
import ExcelJS, { type Cell, type Worksheet } from "exceljs"

export type SpreadsheetRow = Record<string, unknown>

type TemplateOptions = {
  sheetName: string
  headers: readonly string[]
  minColumnWidth?: number
  maxColumnWidth?: number
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
    const worksheet = workbook.addWorksheet(options.sheetName)

    worksheet.addRow([...options.headers])
    worksheet.columns = options.headers.map((header) => ({
      width: Math.min(Math.max(header.length + 3, minWidth), maxWidth),
    }))

    const headerRow = worksheet.getRow(1)
    headerRow.font = { bold: true }
    headerRow.alignment = { vertical: "middle", horizontal: "right" }
    headerRow.height = 24
    worksheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]

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
