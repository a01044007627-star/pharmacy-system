import type { StockContainerState } from "./physical-stock"
import type { UnitHierarchy } from "../units/unit-hierarchy"
import { unitConversionService } from "../units/unit-hierarchy"

export type AccountingStockCache = {
  pharmacyId: string
  branchId: string
  itemId: string
  baseEquivalentQuantity: number
  version: number
  lastReconciledAt: string | null
}

export class AccountingStockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccountingStockError"
  }
}

export class AccountingStockService {
  projectFromPhysical(
    physicalStates: StockContainerState[],
    hierarchy: UnitHierarchy,
  ): AccountingStockCache {
    if (physicalStates.length === 0) {
      const first = hierarchy.levels[0]
      return {
        pharmacyId: "",
        branchId: "",
        itemId: hierarchy.itemId,
        baseEquivalentQuantity: 0,
        version: 0,
        lastReconciledAt: null,
      }
    }

    const first = physicalStates[0]
    let totalBase = 0
    for (const state of physicalStates) {
      totalBase += this.calcSingleState(state, hierarchy)
    }

    return {
      pharmacyId: first.pharmacyId,
      branchId: first.branchId,
      itemId: hierarchy.itemId,
      baseEquivalentQuantity: totalBase,
      version: first.version,
      lastReconciledAt: new Date().toISOString(),
    }
  }

  private calcSingleState(
    state: StockContainerState,
    hierarchy: UnitHierarchy,
  ): number {
    const baseUnit = hierarchy.baseUnit
    const baseConv = baseUnit.conversionToBase
    let total = 0

    const primaryUnit = hierarchy.levels.find((u) => u.position === 3)
    if (primaryUnit) {
      const sealedBase = state.sealedPrimaryCount * primaryUnit.conversionToBase
      const openedBase = state.openedPrimaryContainers * primaryUnit.conversionToBase
      total += sealedBase + openedBase
    }

    const secondaryUnit = hierarchy.levels.find((u) => u.position === 2)
    if (secondaryUnit) {
      total += state.fullSecondaryCount * secondaryUnit.conversionToBase
      total += state.openedSecondaryContainers * secondaryUnit.conversionToBase
    }

    const tertiaryUnit = hierarchy.levels.find((u) => u.position === 1)
    if (tertiaryUnit) {
      total += state.looseTertiaryCount * tertiaryUnit.conversionToBase
    }

    return total
  }

  canFulfill(
    cache: AccountingStockCache,
    requestedBaseQuantity: number,
  ): boolean {
    return cache.baseEquivalentQuantity >= requestedBaseQuantity
  }

  deduct(
    cache: AccountingStockCache,
    baseQuantity: number,
  ): AccountingStockCache {
    if (cache.baseEquivalentQuantity < baseQuantity) {
      throw new AccountingStockError("الكمية الحسابية غير كافية")
    }
    return {
      ...cache,
      baseEquivalentQuantity: cache.baseEquivalentQuantity - baseQuantity,
      version: cache.version + 1,
      lastReconciledAt: new Date().toISOString(),
    }
  }

  add(
    cache: AccountingStockCache,
    baseQuantity: number,
  ): AccountingStockCache {
    return {
      ...cache,
      baseEquivalentQuantity: cache.baseEquivalentQuantity + baseQuantity,
      version: cache.version + 1,
      lastReconciledAt: new Date().toISOString(),
    }
  }

  reconcile(
    physicalStates: StockContainerState[],
    hierarchy: UnitHierarchy,
    currentCache: AccountingStockCache,
  ): {
    newCache: AccountingStockCache
    expected: number
    actual: number
    difference: number
  } {
    const expected = this.projectFromPhysical(physicalStates, hierarchy)
    const actual = currentCache.baseEquivalentQuantity
    const difference = expected.baseEquivalentQuantity - actual

    return {
      newCache: expected,
      expected: expected.baseEquivalentQuantity,
      actual,
      difference,
    }
  }
}

export const accountingStockService = new AccountingStockService()
