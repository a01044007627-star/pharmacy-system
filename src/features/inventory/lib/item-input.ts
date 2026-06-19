export type BarcodeInput = { barcode?: unknown; is_primary?: boolean }
export type UnitInput = {
  unit_name?: unknown
  factor?: unknown
  barcode?: unknown
  sell_price?: unknown
  is_base?: boolean
  main_unit?: unknown
  sub_unit?: unknown
  qty_per_main_unit?: unknown
  unit_raw?: unknown
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

export function cleanItemText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

export function normalizeItemName(value: unknown): string {
  return cleanItemText(value).normalize("NFKC").toLocaleLowerCase("ar")
}

export function normalizeBarcode(value: unknown): string {
  return cleanItemText(value)
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[\s\u200e\u200f\u202a-\u202e-]/g, "")
}

export function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function normalizeBarcodeInputs(
  rawBarcodes: BarcodeInput[] = [],
  rawUnits: UnitInput[] = [],
) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  const barcodes = rawBarcodes
    .map((entry, index) => ({
      barcode: normalizeBarcode(entry.barcode),
      is_primary: entry.is_primary ?? index === 0,
    }))
    .filter((entry) => {
      if (!entry.barcode) return false
      if (seen.has(entry.barcode)) {
        duplicates.add(entry.barcode)
        return false
      }
      seen.add(entry.barcode)
      return true
    })
    .map((entry, index) => ({ ...entry, is_primary: index === 0 }))

  const units = rawUnits
    .map((entry) => {
      const barcode = normalizeBarcode(entry.barcode)
      let acceptedBarcode: string | null = barcode || null
      if (barcode && seen.has(barcode)) {
        duplicates.add(barcode)
        acceptedBarcode = null
      } else if (barcode) {
        seen.add(barcode)
      }

      return {
        unit_name: cleanItemText(entry.unit_name),
        factor: Math.max(0.001, finiteNonNegative(entry.factor, 1) || 1),
        barcode: acceptedBarcode,
        sell_price: entry.sell_price === null || entry.sell_price === undefined || entry.sell_price === ""
          ? null
          : finiteNonNegative(entry.sell_price),
        is_base: Boolean(entry.is_base),
        main_unit: cleanItemText(entry.main_unit) || null,
        sub_unit: cleanItemText(entry.sub_unit) || null,
        qty_per_main_unit: Math.max(0, finiteNonNegative(entry.qty_per_main_unit)),
        unit_raw: cleanItemText(entry.unit_raw) || null,
      }
    })
    .filter((entry) => entry.unit_name)

  const baseIndex = units.findIndex((unit) => unit.is_base)
  return {
    barcodes,
    units: units.map((unit, index) => ({
      ...unit,
      is_base: baseIndex >= 0 ? index === baseIndex : index === 0,
    })),
    duplicates: Array.from(duplicates),
    all: Array.from(seen),
  }
}

export function postgresErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "")

  if (/barcode_already_used|duplicate key.*barcode|uq_.*barcode|pharmacy_item_barcodes.*barcode/i.test(raw)) {
    return "أحد الباركودات مستخدم بالفعل لصنف أو وحدة أخرى"
  }
  if (/pharmacy_items_pharmacy_id_sku_key|duplicate key.*sku/i.test(raw)) {
    return "كود SKU مستخدم بالفعل لصنف آخر"
  }
  if (/item_name_already_used|duplicate.*name/i.test(raw)) {
    return "يوجد صنف نشط بنفس الاسم"
  }
  return raw || fallback
}
