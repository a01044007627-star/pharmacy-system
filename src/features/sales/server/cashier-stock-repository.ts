import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveCashierStock, type CashierStockAvailability } from "@/features/sales/lib/cashier-stock"

export type CashierStockSnapshot = CashierStockAvailability & {
  itemId: string
  itemName: string
  unit: string | null
}

type ItemRow = {
  id: string
  name_ar: string | null
  unit: string | null
  manage_inventory: boolean | null
  track_batch: boolean | null
  has_expiry: boolean | null
  expiry_date: string | null
}

type BalanceRow = { item_id: string; quantity: number | string | null }
type BatchRow = { item_id: string; expiry_date: string | null; remaining_quantity: number | string | null }

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class CashierStockAvailabilityError extends Error {
  readonly code = "INSUFFICIENT_SELLABLE_STOCK"
  constructor(message: string) {
    super(message)
    this.name = "CashierStockAvailabilityError"
  }
}

export class CashierStockRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
    private readonly branchId: string,
  ) {}

  async load(itemIds: string[]): Promise<Map<string, CashierStockSnapshot>> {
    const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)))
    if (uniqueIds.length === 0) return new Map()

    const [itemsResult, balancesResult, batchesResult] = await Promise.all([
      this.db
        .from("pharmacy_items")
        .select("id,name_ar,unit,manage_inventory,track_batch,has_expiry,expiry_date")
        .eq("pharmacy_id", this.pharmacyId)
        .in("id", uniqueIds),
      this.db
        .from("pharmacy_stock_balances")
        .select("item_id,quantity")
        .eq("pharmacy_id", this.pharmacyId)
        .eq("branch_id", this.branchId)
        .in("item_id", uniqueIds),
      this.db
        .from("pharmacy_item_batches")
        .select("item_id,expiry_date,remaining_quantity")
        .eq("pharmacy_id", this.pharmacyId)
        .in("item_id", uniqueIds)
        .or(`branch_id.is.null,branch_id.eq.${this.branchId}`)
        .gt("remaining_quantity", 0),
    ])

    if (itemsResult.error) throw itemsResult.error
    if (balancesResult.error) throw balancesResult.error
    if (batchesResult.error) throw batchesResult.error

    const quantityByItem = new Map<string, number>()
    for (const row of (balancesResult.data ?? []) as BalanceRow[]) {
      quantityByItem.set(row.item_id, (quantityByItem.get(row.item_id) ?? 0) + numberValue(row.quantity))
    }

    const today = new Date().toISOString().slice(0, 10)
    const batchTotals = new Map<string, { valid: number; expired: number; positive: number }>()
    for (const row of (batchesResult.data ?? []) as BatchRow[]) {
      const quantity = Math.max(0, numberValue(row.remaining_quantity))
      const current = batchTotals.get(row.item_id) ?? { valid: 0, expired: 0, positive: 0 }
      current.positive += quantity
      if (row.expiry_date && row.expiry_date < today) current.expired += quantity
      else current.valid += quantity
      batchTotals.set(row.item_id, current)
    }

    const output = new Map<string, CashierStockSnapshot>()
    for (const item of (itemsResult.data ?? []) as ItemRow[]) {
      const batches = batchTotals.get(item.id) ?? { valid: 0, expired: 0, positive: 0 }
      const availability = resolveCashierStock({
        manageInventory: item.manage_inventory,
        trackBatch: item.track_batch,
        hasExpiry: item.has_expiry,
        itemExpiry: item.expiry_date,
        physicalQty: quantityByItem.get(item.id) ?? 0,
        validBatchQty: batches.valid,
        expiredBatchQty: batches.expired,
        positiveBatchQty: batches.positive,
        today,
      })
      output.set(item.id, {
        ...availability,
        itemId: item.id,
        itemName: item.name_ar || "الصنف",
        unit: item.unit,
      })
    }
    return output
  }

  async assertLines(lines: Array<Record<string, unknown>>) {
    const itemIds = lines.map((line) => String(line.item_id ?? "")).filter(Boolean)
    const snapshots = await this.load(itemIds)
    for (const line of lines) {
      const itemId = String(line.item_id ?? "")
      const quantity = numberValue(line.quantity)
      const snapshot = snapshots.get(itemId)
      if (!snapshot || quantity <= 0) continue
      if (quantity > snapshot.sellableQty) {
        const base = snapshot.stockMessage
          ?? `المتاح للبيع ${snapshot.sellableQty} فقط من ${snapshot.itemName}.`
        throw new CashierStockAvailabilityError(
          `${base} الكمية المطلوبة ${quantity}${snapshot.unit ? ` ${snapshot.unit}` : ""}.`,
        )
      }
    }
    return snapshots
  }
}
