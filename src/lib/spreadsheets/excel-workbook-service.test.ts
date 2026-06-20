import { excelWorkbookService } from "./excel-workbook-service"

describe("ExcelWorkbookService", () => {
  test("creates and reads an XLSX template", async () => {
    const template = await excelWorkbookService.createTemplate({
      sheetName: "Items_Ready",
      headers: ["الاسم", "السعر"],
    })

    const rows = await excelWorkbookService.readRows(Buffer.from(template), {
      fileName: "items.xlsx",
      preferredSheetName: "Items_Ready",
    })

    expect(rows).toEqual([])
    expect(template.byteLength).toBeGreaterThan(100)
  })

  test("reads CSV rows through the same adapter", async () => {
    const rows = await excelWorkbookService.readRows(
      Buffer.from("name,price\nAspirin,25\n", "utf8"),
      { fileName: "items.csv" },
    )

    expect(rows).toEqual([{ name: "Aspirin", price: 25 }])
  })

  test("converts modern Excel serial dates", () => {
    expect(excelWorkbookService.excelSerialToDate(45_292)?.toISOString().slice(0, 10)).toBe("2024-01-01")
  })
})
