"use client"

import { localDB } from "@/lib/sync/local-db"

export type OfflineCashierProduct = {
  id: string
  name_ar: string
  name_en?: string | null
  sku?: string | null
  barcode?: string | null
  barcodes?: Array<{ barcode?: string | null; is_primary?: boolean | null }>
  unit?: string | null
  sell_price: number
  old_sell_price?: number | null
  buy_price?: number
  available_qty: number
  manage_inventory?: boolean
  min_stock?: number | null
  group_id?: string | null
  group_name?: string | null
  brand_id?: string | null
  brand_name?: string | null
  category?: string | null
  manufacturer_name?: string | null
  item_type?: string | null
  has_expiry?: boolean
  track_batch?: boolean
  nearest_batch_id?: string | null
  nearest_batch_number?: string | null
  nearest_expiry?: string | null
  active_batches_count?: number
}

export type OfflineCashierShift = {
  id: string
  user_id?: string | null
  opened_at: string
  opening_balance: number
  expected_balance: number | null
  cash_sales: number | null
  card_sales: number | null
  credit_sales: number | null
  total_collected: number | null
  total_expenses: number | null
  status: "open" | "closed"
  notes?: string | null
}

function text(value: unknown) { return typeof value === "string" ? value : "" }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function boolean(value: unknown, fallback = false) { return typeof value === "boolean" ? value : value == null ? fallback : ["1", "true", "yes"].includes(String(value).toLowerCase()) }
function searchable(parts: unknown[]) { return parts.filter((value) => value != null).join(" ").toLocaleLowerCase("ar") }

export async function loadOfflineCashierCatalog(input: { pharmacyId: string; branchId: string; query?: string; limit?: number }): Promise<OfflineCashierProduct[]> {
  const [items, barcodeRows, balanceRows, groupRows, brandRows, batchRows] = await Promise.all([
    localDB.getTableRows("pharmacy_items"),
    localDB.getTableRows("pharmacy_item_barcodes"),
    localDB.getTableRows("pharmacy_stock_balances"),
    localDB.getTableRows("pharmacy_item_groups"),
    localDB.getTableRows("pharmacy_item_brands"),
    localDB.getTableRows("pharmacy_item_batches"),
  ])
  const pharmacyItems = items.filter((row) => row.pharmacy_id === input.pharmacyId && String(row.status ?? "active") === "active" && row.not_for_sale !== true && (!row.branch_id || row.branch_id === input.branchId))
  const itemIds = new Set(pharmacyItems.map((row) => String(row.id)))
  const barcodesByItem = new Map<string, Array<{ barcode?: string | null; is_primary?: boolean | null }>>()
  for (const row of barcodeRows) {
    if (row.pharmacy_id !== input.pharmacyId || !itemIds.has(String(row.item_id))) continue
    const itemId = String(row.item_id)
    const list = barcodesByItem.get(itemId) ?? []
    list.push({ barcode: text(row.barcode) || null, is_primary: boolean(row.is_primary) })
    barcodesByItem.set(itemId, list)
  }
  const quantityByItem = new Map<string, number>()
  for (const row of balanceRows) {
    if (row.pharmacy_id !== input.pharmacyId || row.branch_id !== input.branchId || !itemIds.has(String(row.item_id))) continue
    const itemId = String(row.item_id)
    quantityByItem.set(itemId, (quantityByItem.get(itemId) ?? 0) + number(row.quantity))
  }
  const groups = new Map(groupRows.filter((row) => row.pharmacy_id === input.pharmacyId).map((row) => [String(row.id), text(row.name)]))
  const brands = new Map(brandRows.filter((row) => row.pharmacy_id === input.pharmacyId).map((row) => [String(row.id), text(row.name)]))
  const today = new Date().toISOString().slice(0, 10)
  const batchesByItem = new Map<string, Record<string, unknown>[]>()
  for (const row of batchRows) {
    if (row.pharmacy_id !== input.pharmacyId || !itemIds.has(String(row.item_id))) continue
    if (row.branch_id && row.branch_id !== input.branchId) continue
    if (number(row.remaining_quantity, number(row.quantity)) <= 0) continue
    const expiry = text(row.expiry_date)
    if (expiry && expiry < today) continue
    const itemId = String(row.item_id)
    const list = batchesByItem.get(itemId) ?? []
    list.push(row)
    batchesByItem.set(itemId, list)
  }
  for (const rows of batchesByItem.values()) rows.sort((a, b) => text(a.expiry_date || "9999-12-31").localeCompare(text(b.expiry_date || "9999-12-31")))

  const needle = (input.query ?? "").trim().toLocaleLowerCase("ar")
  const result = pharmacyItems.map((row): OfflineCashierProduct => {
    const id = String(row.id)
    const barcodes = barcodesByItem.get(id) ?? []
    const batches = batchesByItem.get(id) ?? []
    const nearest = batches[0]
    const groupId = text(row.group_id) || null
    const brandId = text(row.brand_id) || null
    const primaryBarcode = (barcodes.find((barcode) => barcode.is_primary)?.barcode ?? barcodes[0]?.barcode ?? text(row.sku)) || null
    return {
      id,
      name_ar: text(row.name_ar) || text(row.name_en) || "صنف بدون اسم",
      name_en: text(row.name_en) || null,
      sku: text(row.sku) || null,
      barcode: primaryBarcode,
      barcodes,
      unit: text(row.unit) || "علبة",
      sell_price: number(row.sell_price),
      old_sell_price: number(row.old_sell_price),
      buy_price: number(row.buy_price),
      available_qty: quantityByItem.has(id) ? quantityByItem.get(id)! : number(row.opening_stock),
      manage_inventory: boolean(row.manage_inventory, true),
      min_stock: number(row.min_stock),
      group_id: groupId,
      group_name: groupId ? groups.get(groupId) ?? null : null,
      brand_id: brandId,
      brand_name: brandId ? brands.get(brandId) ?? null : null,
      category: text(row.category) || null,
      manufacturer_name: text(row.manufacturer_name) || null,
      item_type: text(row.item_type) || null,
      has_expiry: boolean(row.has_expiry),
      track_batch: boolean(row.track_batch),
      nearest_batch_id: nearest ? text(nearest.id) || null : null,
      nearest_batch_number: nearest ? text(nearest.batch_number) || null : null,
      nearest_expiry: nearest ? text(nearest.expiry_date) || null : text(row.expiry_date) || null,
      active_batches_count: batches.length,
    }
  }).filter((product) => !needle || searchable([
    product.name_ar, product.name_en, product.sku, product.barcode, product.unit, product.group_name,
    product.brand_name, product.category, product.manufacturer_name, product.item_type,
    ...(product.barcodes ?? []).map((barcode) => barcode.barcode),
  ]).includes(needle))
  result.sort((a, b) => Number(b.available_qty > 0) - Number(a.available_qty > 0) || a.name_ar.localeCompare(b.name_ar, "ar"))
  return result.slice(0, Math.max(1, input.limit ?? 5000))
}

export async function loadOfflineOpenShift(input: { pharmacyId: string; branchId: string; userId?: string | null }): Promise<OfflineCashierShift | null> {
  const rows = await localDB.getTableRows("pharmacy_shifts")
  const matches = rows.filter((row) => row.pharmacy_id === input.pharmacyId && row.branch_id === input.branchId && String(row.status) === "open" && (!input.userId || !row.user_id || row.user_id === input.userId))
  matches.sort((a, b) => text(b.opened_at).localeCompare(text(a.opened_at)))
  const row = matches[0]
  if (!row?.id) return null
  return {
    id: String(row.id),
    user_id: text(row.user_id) || null,
    opened_at: text(row.opened_at) || new Date().toISOString(),
    opening_balance: number(row.opening_balance),
    expected_balance: row.expected_balance == null ? null : number(row.expected_balance),
    cash_sales: row.cash_sales == null ? null : number(row.cash_sales),
    card_sales: row.card_sales == null ? null : number(row.card_sales),
    credit_sales: row.credit_sales == null ? null : number(row.credit_sales),
    total_collected: row.total_collected == null ? null : number(row.total_collected),
    total_expenses: row.total_expenses == null ? null : number(row.total_expenses),
    status: "open",
    notes: text(row.notes) || null,
  }
}
