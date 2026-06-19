import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { numberValue } from "@/lib/helpers"

export const EXPIRY_SOON_DAYS = 60

export { numberValue }

export function money(value: unknown): string {
  return numberValue(value).toLocaleString("ar-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function quantity(item: PharmacyItemListRow, selectedBranchId?: string | null): number {
  const balances = item.balances ?? []
  if (balances.length > 0) {
    const scoped = selectedBranchId && selectedBranchId !== "all"
      ? balances.filter((row) => row.branch_id === selectedBranchId)
      : balances
    return scoped.reduce((sum, row) => sum + numberValue(row.quantity), 0)
  }
  return numberValue(item.opening_stock)
}

export { primaryBarcode } from "@/lib/helpers"

export function allSearchText(item: PharmacyItemListRow): string {
  const values = [
    item.name_ar,
    item.name_en,
    item.sku,
    item.category,
    item.sub_category,
    item.unit,
    item.manufacturer_name,
    item.item_type,
    item.product_type,
    item.barcode_type,
    item.tax_name,
    item.rack,
    item.shelf_row,
    item.position,
    item.product_description,
    item.import_metadata?.unit_raw,
    item.import_metadata?.main_unit,
    item.import_metadata?.sub_unit,
    item.import_metadata?.unit_factor,
    item.import_metadata?.secondary_unit,
    item.import_metadata?.secondary_unit_factor,
    item.custom_field_1,
    item.custom_field_2,
    item.custom_field_3,
    item.custom_field_4,
    ...(item.product_locations ?? []),
    ...(item.variation_values ?? []),
    ...(item.variation_skus ?? []),
    item.group?.name,
    item.brand?.name,
    item.branch?.name,
    item.branch?.code,
    item.buy_price,
    item.sell_price,
    item.old_sell_price,
    ...(item.barcodes ?? []).map((barcode) => barcode.barcode),
    ...(item.sub_units ?? []).flatMap((unit) => [unit.unit_name, unit.barcode, unit.sell_price]),
  ]
  return values.filter(Boolean).join(" ").toLowerCase()
}

export function isLowStock(item: PharmacyItemListRow, selectedBranchId?: string | null): boolean {
  if (item.manage_inventory === false) return false
  const min = numberValue(item.min_stock)
  if (min <= 0) return false
  return quantity(item, selectedBranchId) <= min
}

export function isOutOfStock(item: PharmacyItemListRow, selectedBranchId?: string | null): boolean {
  if (item.manage_inventory === false) return false
  return quantity(item, selectedBranchId) <= 0
}

export function getExpiryDate(item: PharmacyItemListRow): string | null {
  const dates = [
    item.expiry_date,
    ...(item.batches ?? []).map((batch) => batch.expiry_date),
  ].filter((date): date is string => Boolean(date))

  if (dates.length === 0) return null
  return dates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
}

export function expiryState(item: PharmacyItemListRow): "none" | "expired" | "soon" | "safe" {
  if (!item.has_expiry && !item.expiry_date && !(item.batches ?? []).some((batch) => batch.expiry_date)) return "none"
  const expiry = getExpiryDate(item)
  if (!expiry) return "none"

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(expiry)
  date.setHours(0, 0, 0, 0)
  if (date.getTime() < today.getTime()) return "expired"

  const days = Math.ceil((date.getTime() - today.getTime()) / 86_400_000)
  return days <= EXPIRY_SOON_DAYS ? "soon" : "safe"
}

export function expiryLabel(item: PharmacyItemListRow): string {
  const state = expiryState(item)
  const expiry = getExpiryDate(item)
  if (state === "none") return "بدون صلاحية"
  if (!expiry) return "—"
  const formatted = new Intl.DateTimeFormat("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(expiry))
  if (state === "expired") return `منتهي ${formatted}`
  if (state === "soon") return `قرب الانتهاء ${formatted}`
  return formatted
}


export function itemUnitMeta(item: PharmacyItemListRow) {
  const metadata = item.import_metadata ?? {}
  const units = item.sub_units ?? []
  const baseUnit = units.find((unit) => unit.is_base) ?? units.find((unit) => numberValue(unit.factor) === 1)
  const packUnit = units.find((unit) => !unit.is_base && numberValue(unit.factor) > 1)
  const mainUnit = String(metadata.main_unit ?? "").trim()
    || String(packUnit?.main_unit ?? "").trim()
    || String(packUnit?.unit_name ?? "").trim()
    || item.unit
    || ""
  const subUnit = String(metadata.sub_unit ?? "").trim()
    || String(baseUnit?.sub_unit ?? "").trim()
    || String(baseUnit?.unit_name ?? "").trim()
    || item.unit
    || ""
  const factor = numberValue(metadata.unit_factor, 0)
    || numberValue(packUnit?.qty_per_main_unit, 0)
    || numberValue(packUnit?.factor, 1)
    || 1
  const raw = String(metadata.unit_raw ?? "").trim() || String(baseUnit?.unit_raw ?? "").trim()
  const secondaryUnit = String(metadata.secondary_unit ?? "").trim()
  const secondaryFactor = numberValue(metadata.secondary_unit_factor, 0)
  return { mainUnit, subUnit, factor, raw, secondaryUnit, secondaryFactor }
}

export function unitEquationLabel(item: PharmacyItemListRow): string {
  const meta = itemUnitMeta(item)
  if (!meta.mainUnit && !meta.subUnit) return "—"
  if (meta.mainUnit && meta.subUnit && meta.factor > 1 && meta.mainUnit !== meta.subUnit) {
    const base = `1 ${meta.mainUnit} = ${meta.factor.toLocaleString("ar-EG", { maximumFractionDigits: 3 })} ${meta.subUnit}`
    if (meta.secondaryUnit && meta.secondaryFactor > 0) {
      return `${base} / ${meta.secondaryFactor.toLocaleString("ar-EG", { maximumFractionDigits: 3 })} ${meta.secondaryUnit}`
    }
    return base
  }
  return meta.subUnit || meta.mainUnit || item.unit || "—"
}

export function unitCountLabel(item: PharmacyItemListRow): string {
  const meta = itemUnitMeta(item)
  return meta.factor > 1 ? meta.factor.toLocaleString("ar-EG", { maximumFractionDigits: 3 }) : "—"
}

export function quantityBreakdownLabel(item: PharmacyItemListRow, selectedBranchId?: string | null): string {
  const q = quantity(item, selectedBranchId)
  const meta = itemUnitMeta(item)
  const unit = item.unit || meta.subUnit || "وحدة"
  const base = `${q.toLocaleString("ar-EG", { maximumFractionDigits: 3 })} ${unit}`
  if (q <= 0 || !meta.mainUnit || !meta.subUnit || meta.mainUnit === meta.subUnit || meta.factor <= 1) return base
  const mainQty = q / meta.factor
  const formattedMain = mainQty.toLocaleString("ar-EG", { maximumFractionDigits: mainQty % 1 === 0 ? 0 : 3 })
  return `${base} (${formattedMain} ${meta.mainUnit})`
}

export function itemTypeLabel(value?: string | null): string {
  const labels: Record<string, string> = {
    stocked: "مخزني",
    service: "خدمة",
    digital: "رقمي",
    consignment: "عهدة",
    "non-stocked": "غير مخزني",
  }
  return labels[value ?? ""] ?? value ?? "—"
}

export function statusLabel(value?: string | null): string {
  const labels: Record<string, string> = {
    active: "نشط",
    inactive: "غير نشط",
    draft: "مسودة",
    archived: "مؤرشف",
    deleted: "محذوف",
  }
  return labels[value ?? ""] ?? value ?? "—"
}

export function csvCell(value: unknown): string {
  const normalized = value === null || value === undefined ? "" : String(value)
  return `"${normalized.replace(/"/g, '""')}"`
}
