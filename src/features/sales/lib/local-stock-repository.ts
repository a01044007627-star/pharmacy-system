"use client"

import { localDB } from "@/lib/sync/local-db"
import type { StockContainerState } from "@/domain/inventory/stock/physical-stock"
import type { PurchaseCostEntry } from "@/domain/inventory/pricing/cost-engine"
import type { SaleLineSnapshot } from "@/domain/sales/sales-line-factory"

const SALE_SNAPSHOTS_TABLE = "__sale_snapshots__"
const STOCK_MOVEMENTS_TABLE = "pharmacy_stock_movements"

function num(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export class LocalStockRepository {
  async loadPhysicalStock(
    pharmacyId: string,
    branchId: string,
    itemId: string,
  ): Promise<StockContainerState[]> {
    const batches = await localDB.getTableRows("pharmacy_item_batches")
    return batches
      .filter((b) =>
        b.pharmacy_id === pharmacyId &&
        b.item_id === itemId &&
        (!b.branch_id || b.branch_id === branchId),
      )
      .map((batch) => {
        const remaining = num(batch.remaining_quantity, num(batch.quantity))
        if (remaining <= 0) return null
        return {
          pharmacyId,
          branchId,
          itemId,
          batchId: String(batch.id),
          batchNumber: String(batch.batch_number ?? "") || null,
          expiryDate: String(batch.expiry_date ?? "") || null,
          sealedPrimaryCount: remaining,
          openedPrimaryContainers: 0,
          fullSecondaryCount: 0,
          openedSecondaryContainers: 0,
          looseTertiaryCount: 0,
          version: 1,
        } satisfies StockContainerState
      })
      .filter((s): s is StockContainerState => s !== null)
  }

  async savePhysicalStock(states: StockContainerState[]): Promise<void> {
    if (states.length === 0) return
    const { pharmacyId, branchId, itemId } = states[0]
    for (const state of states) {
      await localDB.putTableRow("pharmacy_item_batches", {
        id: state.batchId,
        pharmacy_id: state.pharmacyId,
        item_id: state.itemId,
        branch_id: state.branchId,
        batch_number: state.batchNumber,
        expiry_date: state.expiryDate,
        remaining_quantity: state.sealedPrimaryCount,
      }, false)
    }
    await this.updateAggregateBalance(pharmacyId, branchId, itemId)
  }

  async loadCostEntries(
    pharmacyId: string,
    batchIds: string[],
  ): Promise<Map<string, PurchaseCostEntry>> {
    const map = new Map<string, PurchaseCostEntry>()
    if (batchIds.length === 0) return map
    const items = await localDB.getTableRows("pharmacy_items")
    const itemPrices = new Map(items.map((i) => [String(i.id), num(i.buy_price)]))
    const batches = await localDB.getTableRows("pharmacy_item_batches")
    for (const batch of batches) {
      const id = String(batch.id)
      if (!batchIds.includes(id)) continue
      const remaining = num(batch.remaining_quantity, num(batch.quantity))
      const unitCost = num(batch.unit_cost) || num(batch.buy_price) || itemPrices.get(String(batch.item_id)) || 0
      map.set(id, {
        batchId: id,
        totalCost: remaining * unitCost,
        totalBaseUnits: remaining,
        costPerBaseUnit: unitCost,
        currency: "EGP",
      })
    }
    return map
  }

  async saveSaleSnapshot(snapshot: SaleLineSnapshot): Promise<void> {
    const id = `snap_${snapshot.itemId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    await localDB.putTableRow(SALE_SNAPSHOTS_TABLE, {
      id,
      item_id: snapshot.itemId,
      item_name: snapshot.itemName,
      unit_id: snapshot.unitId,
      unit_name: snapshot.unitName,
      unit_level: snapshot.unitLevel,
      sold_quantity: snapshot.soldQuantity,
      conversion_to_base: snapshot.conversionToBase,
      base_quantity_deducted: snapshot.baseQuantityDeducted,
      unit_price: snapshot.unitPrice,
      old_unit_price: snapshot.oldUnitPrice,
      subtotal: snapshot.subtotal,
      tax_mode: snapshot.taxMode,
      tax_rate: snapshot.taxRate,
      tax_amount: snapshot.taxAmount,
      line_total: snapshot.lineTotal,
      cost_summary: snapshot.costSummary,
      profit: snapshot.profit,
      margin_percent: snapshot.marginPercent,
      batch_allocations: snapshot.batchAllocations,
      stock_version_before: snapshot.stockVersionBefore,
      stock_version_after: snapshot.stockVersionAfter,
      created_at: new Date().toISOString(),
    }, false)
  }

  async loadSaleSnapshots(): Promise<Record<string, unknown>[]> {
    return localDB.getTableRows(SALE_SNAPSHOTS_TABLE)
  }

  async saveStockMovement(movement: Record<string, unknown>): Promise<void> {
    const id = `mov_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    await localDB.putTableRow(STOCK_MOVEMENTS_TABLE, {
      id,
      ...movement,
    }, false)
  }

  async saveStockMovements(movements: Record<string, unknown>[]): Promise<void> {
    for (const m of movements) await this.saveStockMovement(m)
  }

  private async updateAggregateBalance(
    pharmacyId: string,
    branchId: string,
    itemId: string,
  ): Promise<void> {
    const batches = await localDB.getTableRows("pharmacy_item_batches")
    const totalQty = batches
      .filter((b) =>
        b.pharmacy_id === pharmacyId &&
        b.item_id === itemId &&
        (!b.branch_id || b.branch_id === branchId),
      )
      .reduce((sum, b) => sum + num(b.remaining_quantity, num(b.quantity)), 0)
    await localDB.putTableRow("pharmacy_stock_balances", {
      pharmacy_id: pharmacyId,
      branch_id: branchId,
      item_id: itemId,
      quantity: totalQty,
    }, false)
    await localDB.addSyncLog({
      id: `agg_${itemId}_${Date.now()}`,
      table: "pharmacy_stock_balances",
      action: "update",
      status: "warning",
      timestamp: new Date().toISOString(),
      details: `تم تحديث رصيد المخزون محليًا بعد البيع (الكمية: ${totalQty})`,
    })
  }
}
