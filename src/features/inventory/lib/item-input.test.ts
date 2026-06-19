import { normalizeBarcode, normalizeBarcodeInputs, normalizeItemName } from "./item-input"

describe("item input normalization", () => {
  test("normalizes Arabic and Persian barcode digits", () => {
    expect(normalizeBarcode(" ٦٢٢-۳۰۰ ١٢٣ ")).toBe("622300123")
  })

  test("normalizes item names consistently", () => {
    expect(normalizeItemName("  Panadol   Extra ")).toBe("panadol extra")
  })

  test("rejects duplicate barcode between item and units without dropping the unit", () => {
    const result = normalizeBarcodeInputs(
      [{ barcode: "622300" }],
      [{ unit_name: "شريط", barcode: "٦٢٢٣٠٠", factor: 2 }],
    )
    expect(result.duplicates).toEqual(["622300"])
    expect(result.units).toHaveLength(1)
    expect(result.units[0].barcode).toBeNull()
  })

  test("allows distinct barcodes and keeps one primary/base row", () => {
    const result = normalizeBarcodeInputs(
      [{ barcode: "1", is_primary: false }, { barcode: "2", is_primary: true }],
      [{ unit_name: "علبة", barcode: "3" }, { unit_name: "شريط", barcode: "4", is_base: true }],
    )
    expect(result.barcodes.map((row) => row.is_primary)).toEqual([true, false])
    expect(result.units.map((row) => row.is_base)).toEqual([false, true])
  })
})
