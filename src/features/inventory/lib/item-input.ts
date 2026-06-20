import { unitPolicyService } from "@/domain/inventory/units/unit-policy"
import type { ItemUnitInput } from "@/domain/inventory/units/unit-types"

export type BarcodeInput = { barcode?: unknown; is_primary?: boolean }
export type UnitInput = ItemUnitInput

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

  const unitNames = new Set<string>()
  const units = rawUnits
    .map((entry, index) => {
      const normalized = unitPolicyService.normalizeItemUnit(entry, index)
      const unitKey = normalizeItemName(normalized.unit_name)
      if (unitNames.has(unitKey)) throw new Error(`الوحدة مكررة داخل الصنف: ${normalized.unit_name}`)
      unitNames.add(unitKey)

      const barcode = normalizeBarcode(entry.barcode)
      let acceptedBarcode: string | null = barcode || null
      if (barcode && seen.has(barcode)) {
        duplicates.add(barcode)
        acceptedBarcode = null
      } else if (barcode) {
        seen.add(barcode)
      }

      return { ...normalized, barcode: acceptedBarcode }
    })
    .filter((entry) => entry.unit_name)

  const baseIndex = units.findIndex((unit) => unit.is_base)
  const normalizedUnits = units.map((unit, index) => {
    const isBase = baseIndex >= 0 ? index === baseIndex : index === 0
    return {
      ...unit,
      is_base: isBase,
      factor: isBase ? 1 : unit.factor,
      qty_per_main_unit: isBase && unit.main_unit === unit.sub_unit ? 1 : unit.qty_per_main_unit,
    }
  })

  return {
    barcodes,
    units: normalizedUnits,
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
