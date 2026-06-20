import { Money } from "../../shared/decimal-value"
import type { BatchAllocation } from "../stock/stock-allocation-engine"

export type PurchaseCostEntry = {
  batchId: string
  totalCost: number
  totalBaseUnits: number
  costPerBaseUnit: number
  currency: string
}

export type CostAllocation = {
  batchId: string
  batchNumber: string | null
  baseQuantityUsed: number
  costPerBaseUnit: number
  allocatedCost: number
  totalCostBefore: number
  remainingBaseUnits: number
}

export type CostSummary = {
  totalCost: number
  allocations: CostAllocation[]
  averageCostPerUnit: number
}

export class CostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CostError"
  }
}

export class CostEngine {
  calculateCostPerUnit(
    totalCost: number,
    totalBaseUnits: number,
  ): number {
    if (totalBaseUnits <= 0) throw new CostError("إجمالي الوحدات الأساسية يجب أن يكون أكبر من صفر")
    if (totalCost < 0) throw new CostError("إجمالي التكلفة لا يمكن أن يكون سالبًا")
    return Money.from(totalCost).divide(totalBaseUnits).toNumber()
  }

  createPurchaseEntry(params: {
    batchId: string
    totalCost: number
    totalBaseUnits: number
    currency?: string
  }): PurchaseCostEntry {
    const costPerBaseUnit = this.calculateCostPerUnit(
      params.totalCost,
      params.totalBaseUnits,
    )
    return {
      batchId: params.batchId,
      totalCost: params.totalCost,
      totalBaseUnits: params.totalBaseUnits,
      costPerBaseUnit,
      currency: params.currency ?? "EGP",
    }
  }

  allocateCost(
    entry: PurchaseCostEntry,
    baseQuantityUsed: number,
    remainingBaseUnits: number,
  ): CostAllocation {
    if (baseQuantityUsed > entry.totalBaseUnits) {
      throw new CostError("الكمية المستخدمة أكبر من إجمالي الوحدات في هذه التكلفة")
    }

    const allocatedCost = Money.from(entry.costPerBaseUnit)
      .multiply(baseQuantityUsed)
      .toNumber()

    return {
      batchId: entry.batchId,
      batchNumber: null,
      baseQuantityUsed,
      costPerBaseUnit: entry.costPerBaseUnit,
      allocatedCost,
      totalCostBefore: entry.totalCost,
      remainingBaseUnits,
    }
  }

  allocateFromBatchAllocations(
    allocations: BatchAllocation[],
    costEntries: Map<string, PurchaseCostEntry>,
  ): CostSummary {
    const costAllocations: CostAllocation[] = []
    let totalCost = 0

    for (const alloc of allocations) {
      const entry = costEntries.get(alloc.batchId)
      if (!entry) continue

      const remainingBase = entry.totalBaseUnits - alloc.baseQuantityAllocated
      const ca = this.allocateCost(
        entry,
        alloc.baseQuantityAllocated,
        Math.max(0, remainingBase),
      )
      costAllocations.push(ca)
      totalCost = Money.from(totalCost).add(ca.allocatedCost).toNumber()
    }

    const totalBase = costAllocations.reduce(
      (sum, a) => sum + a.baseQuantityUsed,
      0,
    )
    const avgCost = totalBase > 0
      ? Money.from(totalCost).divide(totalBase).toNumber()
      : 0

    return {
      totalCost,
      allocations: costAllocations,
      averageCostPerUnit: avgCost,
    }
  }

  profitMargin(
    sellingPrice: number,
    costPerUnit: number,
  ): { profit: number; marginPercent: number } {
    if (costPerUnit <= 0) {
      return { profit: sellingPrice, marginPercent: 100 }
    }
    const profit = Money.from(sellingPrice).subtract(costPerUnit).toNumber()
    const marginPercent = Money.from(profit)
      .divide(costPerUnit)
      .multiply(100)
      .toNumber()
    return { profit, marginPercent }
  }
}

export const costEngine = new CostEngine()
