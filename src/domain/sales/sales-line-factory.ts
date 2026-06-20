import type { UnitHierarchy, UnitNode } from "../inventory/units/unit-hierarchy"
import { unitConversionService } from "../inventory/units/unit-hierarchy"
import type { StockContainerState } from "../inventory/stock/physical-stock"
import { stockAllocationEngine, type SellLevel, type AllocationResult } from "../inventory/stock/stock-allocation-engine"
import { accountingStockService, type AccountingStockCache } from "../inventory/stock/accounting-stock"
import { pricingEngine, type TaxMode, type FullPriceQuote } from "../inventory/pricing/pricing-engine"
import { costEngine, type PurchaseCostEntry, type CostSummary } from "../inventory/pricing/cost-engine"
import { Money } from "../shared/decimal-value"

export type SaleLineSnapshot = {
  itemId: string
  itemName: string
  unitId: string
  unitName: string
  unitLevel: SellLevel
  soldQuantity: number
  conversionToBase: number
  baseQuantityDeducted: number
  unitPrice: number
  oldUnitPrice: number | null
  subtotal: number
  taxMode: TaxMode
  taxRate: number
  taxAmount: number
  lineTotal: number
  costSummary: CostSummary | null
  profit: number | null
  marginPercent: number | null
  batchAllocations: Array<{
    batchId: string
    batchNumber: string | null
    baseQuantityAllocated: number
    allocatedCost: number
  }>
  stockVersionBefore: number
  stockVersionAfter: number
}

export type CreateSaleLineInput = {
  itemId: string
  itemName: string
  hierarchy: UnitHierarchy
  sellLevel: SellLevel
  sellQuantity: number
  batches: StockContainerState[]
  costEntries: Map<string, PurchaseCostEntry>
  accountingCache: AccountingStockCache
  taxRate: number
  taxMode: TaxMode
  preferFefo?: boolean
  useOldPrice?: boolean
}

export type CreateSaleLineOutput = {
  snapshot: SaleLineSnapshot
  allocation: AllocationResult
  newAccountingCache: AccountingStockCache
  newBatchStates: StockContainerState[]
}

export class SalesLineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SalesLineError"
  }
}

export class SalesLineFactory {
  create(input: CreateSaleLineInput): CreateSaleLineOutput {
    const { hierarchy, sellLevel, sellQuantity, batches, costEntries, accountingCache, taxRate, taxMode } = input

    const selectedUnit = hierarchy.levels.find((u) => u.level === sellLevel)
    if (!selectedUnit) throw new SalesLineError(`مستوى البيع ${sellLevel} غير موجود`)
    if (!selectedUnit.isSellable) throw new SalesLineError(`الوحدة ${selectedUnit.name} غير مسموح بيعها`)
    if (sellQuantity <= 0) throw new SalesLineError("الكمية يجب أن تكون أكبر من صفر")

    const allocation = stockAllocationEngine.allocate({
      hierarchy,
      batches,
      sellLevel,
      sellQuantity,
      preferFefo: input.preferFefo ?? true,
    })
    if (!allocation.success) {
      throw new SalesLineError(allocation.error ?? "فشل تخصيص المخزون")
    }

    const baseQtyDeducted = allocation.totalBaseQuantity

    const priceQuote: FullPriceQuote = pricingEngine.fullQuote(
      selectedUnit,
      sellQuantity,
      taxRate,
      taxMode,
      input.useOldPrice ?? false,
    )

    const costInfo: CostSummary = costEngine.allocateFromBatchAllocations(
      allocation.allocations,
      costEntries,
    )

    const profit = priceQuote.price.subtotal - costInfo.totalCost
    const marginPercent = costInfo.totalCost > 0
      ? Money.from(profit).divide(costInfo.totalCost).multiply(100).toNumber()
      : 100

    const newAccountingCache = accountingStockService.deduct(
      accountingCache,
      baseQtyDeducted,
    )

    const batchAllocations = allocation.allocations.map((a) => ({
      batchId: a.batchId,
      batchNumber: a.batchNumber,
      baseQuantityAllocated: a.baseQuantityAllocated,
      allocatedCost: costInfo.allocations.find((c) => c.batchId === a.batchId)?.allocatedCost ?? 0,
    }))

    const snapshot: SaleLineSnapshot = {
      itemId: input.itemId,
      itemName: input.itemName,
      unitId: selectedUnit.id,
      unitName: selectedUnit.name,
      unitLevel: sellLevel,
      soldQuantity: sellQuantity,
      conversionToBase: selectedUnit.conversionToBase,
      baseQuantityDeducted: baseQtyDeducted,
      unitPrice: priceQuote.price.unitPrice,
      oldUnitPrice: priceQuote.price.oldUnitPrice,
      subtotal: priceQuote.price.subtotal,
      taxMode,
      taxRate,
      taxAmount: priceQuote.tax.taxAmount,
      lineTotal: priceQuote.lineTotal,
      costSummary: costInfo,
      profit,
      marginPercent,
      batchAllocations,
      stockVersionBefore: accountingCache.version,
      stockVersionAfter: newAccountingCache.version,
    }

    return {
      snapshot,
      allocation,
      newAccountingCache,
      newBatchStates: allocation.newBatchStates,
    }
  }

  recalculateFromSnapshot(
    snapshot: SaleLineSnapshot,
    quantityDelta: number,
  ): Partial<SaleLineSnapshot> {
    const newSoldQty = Math.max(0, snapshot.soldQuantity + quantityDelta)
    const ratio = newSoldQty / snapshot.soldQuantity

    return {
      soldQuantity: newSoldQty,
      baseQuantityDeducted: Money.from(snapshot.baseQuantityDeducted).multiply(ratio).toNumber(),
      subtotal: Money.from(snapshot.subtotal).multiply(ratio).toNumber(),
      lineTotal: Money.from(snapshot.lineTotal).multiply(ratio).toNumber(),
      taxAmount: Money.from(snapshot.taxAmount).multiply(ratio).toNumber(),
    }
  }
}

export const salesLineFactory = new SalesLineFactory()
