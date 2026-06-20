"use client"

import type { SellLevel } from "@/domain/inventory/stock/stock-allocation-engine"
import type { SaleLineSnapshot } from "@/domain/sales/sales-line-factory"
import { salesLineFactory } from "@/domain/sales/sales-line-factory"
import { unitConversionService, type UnitNode } from "@/domain/inventory/units/unit-hierarchy"
import { accountingStockService } from "@/domain/inventory/stock/accounting-stock"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { LocalStockRepository } from "@/features/sales/lib/local-stock-repository"

export type OfflineSaleInput = {
  itemId: string
  itemName: string
  sellLevel: SellLevel
  sellQuantity: number
  pharmacyId: string
  branchId: string
  batchId?: string
}

export type OfflineSaleResult = {
  success: boolean
  snapshot: SaleLineSnapshot | null
  error?: string
  syncOperationId: string
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

async function buildUnitHierarchy(itemId: string): ReturnType<typeof unitConversionService.buildHierarchy> {
  const unitRows = await localDB.getTableRows("pharmacy_item_units")
  const matching = unitRows.filter((r) => String(r.item_id) === itemId)
  if (matching.length === 0) throw new Error(`لا توجد وحدات مسجلة للصنف ${itemId}`)

  const sorted = matching.sort((a, b) => {
    const aBase = a.is_base === true || a.is_base === "true" ? 0 : 1
    const bBase = b.is_base === true || b.is_base === "true" ? 0 : 1
    if (aBase !== bBase) return aBase - bBase
    return num(a.factor) - num(b.factor)
  })

  const nodes: UnitNode[] = sorted.map((row, index) => {
    const position = Math.min(index + 1, 3) as 1 | 2 | 3
    const factor = Math.max(1, num(row.factor))
    const isBase = position === 1
    const conversionToBase = isBase ? 1 : factor

    return unitConversionService.createNode({
      itemId,
      position,
      name: text(row.unit_name),
      parentId: index > 0 ? sorted[index - 1]?.id : null,
      qtyInParent: isBase ? 1 : num(row.qty_per_main_unit) || 1,
      conversionToBase,
      isSellable: row.sale_enabled !== false,
      barcode: text(row.barcode) || null,
      currentSellPrice: num(row.sell_price) || 0,
      oldSellPrice: num(row.old_sell_price) || null,
    })
  })

  return unitConversionService.buildHierarchy(nodes)
}

function resolveTaxMode(): "inclusive" | "exclusive" {
  if (typeof window === "undefined") return "inclusive"
  try {
    const setting = window.localStorage.getItem("pharmacy-tax-mode")
    if (setting === "exclusive" || setting === "inclusive") return setting
  } catch {}
  return "inclusive"
}

function resolveTaxRate(): number {
  if (typeof window === "undefined") return 0
  try {
    const rate = Number(window.localStorage.getItem("pharmacy-tax-rate"))
    return Number.isFinite(rate) ? Math.max(0, rate) : 0
  } catch {
    return 0
  }
}

export async function executeOfflineSale(
  input: OfflineSaleInput,
): Promise<OfflineSaleResult> {
  const repo = new LocalStockRepository()
  const syncOperationId = `offline_sale_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`

  try {
    if (input.sellQuantity <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر")

    const hierarchy = await buildUnitHierarchy(input.itemId)

    const stockStates = await repo.loadPhysicalStock(
      input.pharmacyId,
      input.branchId,
      input.itemId,
    )

    if (stockStates.length === 0) throw new Error("لا يوجد رصيد للصنف في المخزون المحلي")

    const filteredStates = input.batchId
      ? stockStates.filter((s) => s.batchId === input.batchId)
      : stockStates

    if (filteredStates.length === 0) throw new Error("لا توجد تشغيلة مطابقة للبيع")

    const costEntries = await repo.loadCostEntries(
      input.pharmacyId,
      filteredStates.map((s) => s.batchId),
    )

    const accountingCache = accountingStockService.projectFromPhysical(
      filteredStates,
      hierarchy,
    )

    const taxMode = resolveTaxMode()
    const taxRate = resolveTaxRate()

    const result = salesLineFactory.create({
      itemId: input.itemId,
      itemName: input.itemName,
      hierarchy,
      sellLevel: input.sellLevel,
      sellQuantity: input.sellQuantity,
      batches: filteredStates,
      costEntries,
      accountingCache,
      taxRate,
      taxMode,
      preferFefo: true,
    })

    await repo.savePhysicalStock(result.newBatchStates)
    await repo.saveSaleSnapshot(result.snapshot)

    const movements = result.newBatchStates.map((state) => ({
      pharmacy_id: input.pharmacyId,
      branch_id: input.branchId,
      item_id: input.itemId,
      batch_id: state.batchId,
      type: "sale" as const,
      quantity_change: -state.sealedPrimaryCount,
      base_quantity: result.snapshot.baseQuantityDeducted,
      reference_id: syncOperationId,
      reference_type: "offline_sale",
      created_at: new Date().toISOString(),
    }))
    await repo.saveStockMovements(movements)

    await localDB.addSyncLog({
      id: `offline_exec_${syncOperationId}`,
      table: "offline_sale",
      action: "create",
      status: "warning",
      timestamp: new Date().toISOString(),
      details: `تم تنفيذ البيع محليًا: ${input.itemName} × ${input.sellQuantity}`,
    })

    return {
      success: true,
      snapshot: result.snapshot,
      syncOperationId,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تنفيذ البيع محليًا"
    await localDB.addSyncLog({
      id: `offline_fail_${syncOperationId}`,
      table: "offline_sale",
      action: "create",
      status: "failed",
      timestamp: new Date().toISOString(),
      details: message,
    })
    return {
      success: false,
      snapshot: null,
      error: message,
      syncOperationId,
    }
  }
}
