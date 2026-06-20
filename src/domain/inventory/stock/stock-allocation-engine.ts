import type { StockContainerState, StockMutation } from "./physical-stock"
import { physicalStockService } from "./physical-stock"
import type { UnitHierarchy, UnitNode } from "../units/unit-hierarchy"
import { UnitConversionService, unitConversionService } from "../units/unit-hierarchy"

export type SellLevel = "primary" | "secondary" | "tertiary"

export type AllocationRequest = {
  hierarchy: UnitHierarchy
  batches: StockContainerState[]
  sellLevel: SellLevel
  sellQuantity: number
  preferFefo: boolean
}

export type BatchAllocation = {
  batchId: string
  batchNumber: string | null
  expiryDate: string | null
  allocatedPrimary: number
  allocatedSecondary: number
  allocatedTertiary: number
  baseQuantityAllocated: number
  mutations: StockMutation[]
  resultingState: StockContainerState
}

export type AllocationResult = {
  success: boolean
  allocations: BatchAllocation[]
  totalBaseQuantity: number
  remainingRequest: number
  newBatchStates: StockContainerState[]
  error?: string
}

export class StockAllocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StockAllocationError"
  }
}

type SearchOrder = {
  batchIndex: number
  priority: number
  source: "opened_tertiary" | "opened_secondary" | "full_secondary" | "opened_primary" | "sealed_primary"
}

export class StockAllocationEngine {
  allocate(request: AllocationRequest): AllocationResult {
    const { hierarchy, batches, sellLevel, sellQuantity } = request

    if (sellQuantity <= 0) {
      throw new StockAllocationError("الكمية المطلوبة للبيع يجب أن تكون أكبر من صفر")
    }

    const baseUnit = hierarchy.baseUnit
    const selectedUnit = hierarchy.levels.find((u) => u.level === sellLevel)
    if (!selectedUnit) {
      throw new StockAllocationError(`مستوى البيع غير موجود: ${sellLevel}`)
    }

    if (!selectedUnit.isSellable) {
      throw new StockAllocationError(`الوحدة ${selectedUnit.name} غير مسموح بيعها`)
    }

    const totalBaseNeeded = sellQuantity * selectedUnit.conversionToBase

    const sortedBatches = request.preferFefo
      ? [...batches].sort(this.fefoSort)
      : [...batches]

    const allocations: BatchAllocation[] = []
    let remainingBase = totalBaseNeeded
    const newBatchStates: StockContainerState[] = []

    for (const batch of sortedBatches) {
      if (remainingBase <= 0) break

      const result = this.allocateFromBatch(
        batch,
        hierarchy,
        sellLevel,
        remainingBase,
      )

      allocations.push(result.alloc)
      remainingBase -= result.alloc.baseQuantityAllocated
      newBatchStates.push(result.newState)
    }

    if (remainingBase > 0) {
      return {
        success: false,
        allocations,
        totalBaseQuantity: totalBaseNeeded - remainingBase,
        remainingRequest: remainingBase,
        newBatchStates,
        error: `الكمية غير كافية. المتبقي: ${remainingBase} وحدة أساسية`,
      }
    }

    return {
      success: true,
      allocations,
      totalBaseQuantity: totalBaseNeeded,
      remainingRequest: 0,
      newBatchStates,
    }
  }

  private allocateFromBatch(
    batch: StockContainerState,
    hierarchy: UnitHierarchy,
    sellLevel: SellLevel,
    neededBase: number,
  ): { alloc: BatchAllocation; newState: StockContainerState } {
    const mutations: StockMutation[] = []
    let state = { ...batch }
    let allocatedPrimary = 0
    let allocatedSecondary = 0
    let allocatedTertiary = 0
    let baseAllocated = 0

    let remaining = neededBase

    if (sellLevel === "primary") {
      const availableSealed = state.sealedPrimaryCount
      const primaryUnit = hierarchy.levels.find((u) => u.position === 3)
      if (!primaryUnit) throw new StockAllocationError("المستوى الرئيسي غير موجود")
      const perPrimary = primaryUnit.conversionToBase
      const canTake = Math.min(
        availableSealed,
        Math.floor(remaining / perPrimary),
      )
      if (canTake > 0) {
        state.sealedPrimaryCount -= canTake
        allocatedPrimary = canTake
        const taken = canTake * perPrimary
        baseAllocated += taken
        remaining -= taken
        mutations.push({ type: "seal_primary", batchId: batch.batchId, delta: -canTake } as StockMutation)
      }
    }

    if (sellLevel === "secondary") {
      const result = this.tryAllocateSecondary(state, hierarchy, remaining, mutations)
      state = result.state
      allocatedSecondary = result.allocated
      baseAllocated += result.baseAmount
      remaining -= result.baseAmount
    }

    if (sellLevel === "tertiary") {
      const result = this.tryAllocateTertiary(state, hierarchy, remaining, mutations)
      state = result.state
      allocatedTertiary = result.allocated
      baseAllocated += result.baseAmount
      remaining -= result.baseAmount
    }

    return {
      alloc: {
        batchId: batch.batchId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        allocatedPrimary,
        allocatedSecondary,
        allocatedTertiary,
        baseQuantityAllocated: baseAllocated,
        mutations,
        resultingState: state,
      },
      newState: state,
    }
  }

  private tryAllocateSecondary(
    state: StockContainerState,
    hierarchy: UnitHierarchy,
    neededBase: number,
    mutations: StockMutation[],
  ): { state: StockContainerState; allocated: number; baseAmount: number } {
    const secondaryUnit = hierarchy.levels.find((u) => u.position === 2)
    if (!secondaryUnit) throw new StockAllocationError("المستوى الثانوي غير موجود")
    const perSecondary = secondaryUnit.conversionToBase

    let remaining = neededBase
    let allocated = 0
    let muts: StockMutation[] = []

    const fromFull = Math.min(
      state.fullSecondaryCount,
      Math.floor(remaining / perSecondary),
    )
    if (fromFull > 0) {
      state.fullSecondaryCount -= fromFull
      allocated += fromFull
      const taken = fromFull * perSecondary
      remaining -= taken
      muts.push({ type: "add_secondary", batchId: state.batchId, delta: -fromFull } as StockMutation)
    }

    if (remaining >= perSecondary && state.openedSecondaryContainers > 0) {
      const secondaryPerOpen = Math.min(
        state.openedSecondaryContainers,
        Math.floor(remaining / perSecondary),
      )
      if (secondaryPerOpen > 0) {
        state.openedSecondaryContainers -= secondaryPerOpen
        allocated += secondaryPerOpen
        const taken = secondaryPerOpen * perSecondary
        remaining -= taken
      }
    }

    if (remaining > 0 && state.sealedPrimaryCount > 0) {
      const primaryUnit = hierarchy.levels.find((u) => u.position === 3)
      if (primaryUnit) {
        const qtyPerPrimary = secondaryUnit.qtyInParent
        const needFullSecondaries = Math.ceil(remaining / perSecondary)
        const needPrimaries = Math.ceil(needFullSecondaries / qtyPerPrimary)
        const canOpen = Math.min(state.sealedPrimaryCount, needPrimaries)

        if (canOpen > 0) {
          state.sealedPrimaryCount -= canOpen
          state.openedPrimaryContainers += canOpen
          const newSecondaries = canOpen * qtyPerPrimary
          state.fullSecondaryCount += newSecondaries
          muts.push({
            type: "unpack_primary",
            batchId: state.batchId,
            sealedPrimaryBefore: state.sealedPrimaryCount + canOpen,
            sealedPrimaryAfter: state.sealedPrimaryCount,
            openedPrimaryBefore: state.openedPrimaryContainers - canOpen,
            openedPrimaryAfter: state.openedPrimaryContainers,
            fullSecondaryAdded: newSecondaries,
          })

          const nowFull = Math.min(
            state.fullSecondaryCount,
            Math.floor(remaining / perSecondary),
          )
          if (nowFull > 0) {
            state.fullSecondaryCount -= nowFull
            allocated += nowFull
            const taken = nowFull * perSecondary
            remaining -= taken
            muts.push({ type: "add_secondary", batchId: state.batchId, delta: -nowFull } as StockMutation)
          }
        }
      }
    }

    return {
      state,
      allocated,
      baseAmount: neededBase - remaining,
    }
  }

  private tryAllocateTertiary(
    state: StockContainerState,
    hierarchy: UnitHierarchy,
    neededBase: number,
    mutations: StockMutation[],
  ): { state: StockContainerState; allocated: number; baseAmount: number } {
    let remaining = neededBase
    let allocated = 0

    const fromLoose = Math.min(state.looseTertiaryCount, remaining)
    if (fromLoose > 0) {
      state.looseTertiaryCount -= fromLoose
      allocated += fromLoose
      remaining -= fromLoose
    }

    if (remaining > 0) {
      const secondaryUnit = hierarchy.levels.find((u) => u.position === 2)
      if (secondaryUnit) {
        const tertiaryPerSecondary = hierarchy.levels.find((u) => u.position === 1)?.qtyInParent ?? 1
        const result = this.unpackSecondaryForTertiary(
          state, hierarchy, remaining, tertiaryPerSecondary,
        )
        state = result.state
        const taken = result.allocatedTertiary
        if (taken > 0) {
          const fromNewLoose = Math.min(state.looseTertiaryCount, remaining)
          state.looseTertiaryCount -= fromNewLoose
          allocated += fromNewLoose
          remaining -= fromNewLoose
        }
      }
    }

    if (remaining > 0 && state.sealedPrimaryCount > 0) {
      const secondaryUnit = hierarchy.levels.find((u) => u.position === 2)
      const tertiaryUnit = hierarchy.levels.find((u) => u.position === 1)
      if (secondaryUnit && tertiaryUnit) {
        const tertiaryPerSecondary = tertiaryUnit.qtyInParent
        const secondaryPerPrimary = secondaryUnit.qtyInParent

        const needTertiary = remaining
        const needSecondaries = Math.ceil(needTertiary / tertiaryPerSecondary)
        const needPrimaries = Math.ceil(needSecondaries / secondaryPerPrimary)
        const canOpen = Math.min(state.sealedPrimaryCount, needPrimaries)

        if (canOpen > 0) {
          state.sealedPrimaryCount -= canOpen
          state.openedPrimaryContainers += canOpen
          const newSecondaries = canOpen * secondaryPerPrimary
          state.fullSecondaryCount += newSecondaries

          const toOpen = Math.min(state.fullSecondaryCount, Math.ceil(needTertiary / tertiaryPerSecondary))
          state.fullSecondaryCount -= toOpen
          state.openedSecondaryContainers += toOpen
          state.looseTertiaryCount += toOpen * tertiaryPerSecondary

          const fromNewLoose = Math.min(state.looseTertiaryCount, remaining)
          state.looseTertiaryCount -= fromNewLoose
          allocated += fromNewLoose
          remaining -= fromNewLoose
        }
      }
    }

    return {
      state,
      allocated,
      baseAmount: neededBase - remaining,
    }
  }

  private unpackSecondaryForTertiary(
    state: StockContainerState,
    hierarchy: UnitHierarchy,
    needed: number,
    tertiaryPerSecondary: number,
  ): { state: StockContainerState; allocatedTertiary: number } {
    let allocated = 0

    const fromFull = Math.min(
      state.fullSecondaryCount,
      Math.ceil(needed / tertiaryPerSecondary),
    )
    if (fromFull > 0) {
      state.fullSecondaryCount -= fromFull
      state.openedSecondaryContainers += fromFull
      state.looseTertiaryCount += fromFull * tertiaryPerSecondary
      const fromNewLoose = Math.min(state.looseTertiaryCount, needed)
      state.looseTertiaryCount -= fromNewLoose
      allocated = fromNewLoose
    }

    return { state, allocatedTertiary: allocated }
  }

  private fefoSort(a: StockContainerState, b: StockContainerState): number {
    if (!a.expiryDate && !b.expiryDate) return 0
    if (!a.expiryDate) return 1
    if (!b.expiryDate) return -1
    return a.expiryDate.localeCompare(b.expiryDate)
  }

  displayPhysicalStock(
    states: StockContainerState[],
    hierarchy: UnitHierarchy,
  ): string {
    let totalSealed = 0
    let totalOpened = 0
    let totalFullSecondary = 0
    let totalOpenedSecondary = 0
    let totalLoose = 0

    for (const s of states) {
      totalSealed += s.sealedPrimaryCount
      totalOpened += s.openedPrimaryContainers
      totalFullSecondary += s.fullSecondaryCount
      totalOpenedSecondary += s.openedSecondaryContainers
      totalLoose += s.looseTertiaryCount
    }

    const primaryName = hierarchy.levels.find((u) => u.position === 3)?.name ?? ""
    const secondaryName = hierarchy.levels.find((u) => u.position === 2)?.name ?? ""
    const tertiaryName = hierarchy.levels.find((u) => u.position === 1)?.name ?? ""

    const parts: string[] = []
    if (totalSealed > 0) parts.push(`${totalSealed} ${primaryName} مغلقة`)
    if (totalOpened > 0) parts.push(`${totalOpened} ${primaryName} مفتوحة`)
    if (totalFullSecondary > 0) parts.push(`${totalFullSecondary} ${secondaryName} كاملة`)
    if (totalOpenedSecondary > 0) parts.push(`${totalOpenedSecondary} ${secondaryName} مفتوحة`)
    if (totalLoose > 0) parts.push(`${totalLoose} ${tertiaryName}`)

    return parts.join(" | ") || "لا يوجد رصيد"
  }

  primaryDisplayOnly(
    states: StockContainerState[],
    primaryName: string,
  ): string {
    let total = 0
    for (const s of states) {
      total += this.primaryEquivalent(s, primaryName)
    }
    return `≈ ${total} ${primaryName}`
  }

  private primaryEquivalent(
    state: StockContainerState,
    _primaryName: string,
  ): number {
    return state.sealedPrimaryCount + state.openedPrimaryContainers
  }
}

export const stockAllocationEngine = new StockAllocationEngine()
