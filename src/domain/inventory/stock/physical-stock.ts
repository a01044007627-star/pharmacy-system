import Decimal from "decimal.js"
import type { UnitHierarchy, UnitNode } from "../units/unit-hierarchy"

export type StockContainerState = {
  pharmacyId: string
  branchId: string
  itemId: string
  batchId: string
  batchNumber: string | null
  expiryDate: string | null
  sealedPrimaryCount: number
  openedPrimaryContainers: number
  fullSecondaryCount: number
  openedSecondaryContainers: number
  looseTertiaryCount: number
  version: number
}

export type StockContainerSnapshot = {
  batchId: string
  batchNumber: string | null
  expiryDate: string | null
  sealedPrimary: number
  openedPrimary: number
  fullSecondary: number
  openedSecondary: number
  looseTertiary: number
}

export type PhysicalStockDisplay = {
  batchId: string
  batchNumber: string | null
  expiryDate: string | null
  sealedPrimary: number
  openedPrimaryContainers: number
  fullSecondary: number
  openedSecondaryContainers: number
  looseTertiary: number
}

export type UnpackEvent = {
  type: "unpack_primary"
  batchId: string
  sealedPrimaryBefore: number
  sealedPrimaryAfter: number
  openedPrimaryBefore: number
  openedPrimaryAfter: number
  fullSecondaryAdded: number
}

export type UnpackSecondaryEvent = {
  type: "unpack_secondary"
  batchId: string
  fullSecondaryBefore: number
  fullSecondaryAfter: number
  openedSecondaryBefore: number
  openedSecondaryAfter: number
  looseTertiaryAdded: number
}

export type StockMutation =
  | { type: "seal_primary"; batchId: string; delta: number }
  | { type: "unseal_primary"; batchId: string; delta: number; toOpened: boolean }
  | { type: "add_secondary"; batchId: string; delta: number }
  | { type: "remove_secondary"; batchId: string; delta: number }
  | { type: "add_tertiary"; batchId: string; delta: number }
  | { type: "remove_tertiary"; batchId: string; delta: number }
  | UnpackEvent
  | UnpackSecondaryEvent

export class PhysicalStockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PhysicalStockError"
  }
}

export class PhysicalStockService {
  calculateBaseEquivalent(
    state: StockContainerState,
    hierarchy: UnitHierarchy,
  ): number {
    const primary = hierarchy.levels.find((u) => u.position === 3)
    const secondary = hierarchy.levels.find((u) => u.position === 2)
    const tertiary = hierarchy.levels.find((u) => u.position === 1)
    if (!primary) throw new PhysicalStockError("المستوى الرئيسي مطلوب")

    let total = 0
    const priConversion = primary.conversionToBase
    total += new Decimal(state.sealedPrimaryCount).times(priConversion).toNumber()
    total += new Decimal(state.openedPrimaryContainers).times(priConversion).toNumber()

    if (secondary) {
      const secConversion = secondary.conversionToBase
      total += new Decimal(state.fullSecondaryCount).times(secConversion).toNumber()
      total += new Decimal(state.openedSecondaryContainers).times(secConversion).toNumber()
    }

    if (tertiary) {
      total += state.looseTertiaryCount
    }

    return total
  }

  canSellPrimary(state: StockContainerState, quantity: number): boolean {
    return state.sealedPrimaryCount >= quantity
  }

  canSellSecondary(state: StockContainerState, quantity: number): boolean {
    const hierarchy = this.estimateHierarchy(state)
    const availableSecondary = state.fullSecondaryCount
    return availableSecondary >= quantity
  }

  canSellTertiary(state: StockContainerState, quantity: number): boolean {
    return state.looseTertiaryCount >= quantity
  }

  applyMutation(state: StockContainerState, mutation: StockMutation): StockContainerState {
    const next = { ...state, version: state.version + 1 }

    switch (mutation.type) {
      case "seal_primary":
        next.sealedPrimaryCount += mutation.delta
        break
      case "unseal_primary":
        if (next.sealedPrimaryCount < mutation.delta) {
          throw new PhysicalStockError("لا توجد علب مغلقة كافية")
        }
        next.sealedPrimaryCount -= mutation.delta
        next.openedPrimaryContainers += mutation.delta
        break
      case "add_secondary":
        next.fullSecondaryCount += mutation.delta
        break
      case "remove_secondary":
        if (next.fullSecondaryCount < mutation.delta) {
          throw new PhysicalStockError("لا توجد وحدات كاملة كافية")
        }
        next.fullSecondaryCount -= mutation.delta
        break
      case "add_tertiary":
        next.looseTertiaryCount += mutation.delta
        break
      case "remove_tertiary":
        if (next.looseTertiaryCount < mutation.delta) {
          throw new PhysicalStockError("لا توجد وحدات فرعية كافية")
        }
        next.looseTertiaryCount -= mutation.delta
        break
      case "unpack_primary":
        next.sealedPrimaryCount = mutation.sealedPrimaryAfter
        next.openedPrimaryContainers = mutation.openedPrimaryAfter
        next.fullSecondaryCount += mutation.fullSecondaryAdded
        break
      case "unpack_secondary":
        next.fullSecondaryCount = mutation.fullSecondaryAfter
        next.openedSecondaryContainers = mutation.openedSecondaryAfter
        next.looseTertiaryCount += mutation.looseTertiaryAdded
        break
    }

    return next
  }

  createEmptyState(params: {
    pharmacyId: string
    branchId: string
    itemId: string
    batchId: string
    batchNumber?: string | null
    expiryDate?: string | null
  }): StockContainerState {
    return {
      pharmacyId: params.pharmacyId,
      branchId: params.branchId,
      itemId: params.itemId,
      batchId: params.batchId,
      batchNumber: params.batchNumber ?? null,
      expiryDate: params.expiryDate ?? null,
      sealedPrimaryCount: 0,
      openedPrimaryContainers: 0,
      fullSecondaryCount: 0,
      openedSecondaryContainers: 0,
      looseTertiaryCount: 0,
      version: 1,
    }
  }

  receiveStock(
    state: StockContainerState,
    primaryCount: number,
    secondaryPerPrimary: number,
    tertiaryPerSecondary: number,
    depth: number,
  ): { newState: StockContainerState; mutations: StockMutation[] } {
    const mutations: StockMutation[] = []
    let next = { ...state }

    if (depth >= 1) {
      next.sealedPrimaryCount += primaryCount
      mutations.push({ type: "seal_primary", batchId: state.batchId, delta: primaryCount })
    }
    if (depth >= 2) {
      const totalSecondary = primaryCount * secondaryPerPrimary
      next.fullSecondaryCount += totalSecondary
      mutations.push({ type: "add_secondary", batchId: state.batchId, delta: totalSecondary })
    }
    if (depth >= 3) {
      const totalTertiary = primaryCount * secondaryPerPrimary * tertiaryPerSecondary
      next.looseTertiaryCount += totalTertiary
      mutations.push({ type: "add_tertiary", batchId: state.batchId, delta: totalTertiary })
    }

    next.version = state.version + 1
    return { newState: next, mutations }
  }

  private estimateHierarchy(state: StockContainerState): {
    hasPrimary: boolean
    hasSecondary: boolean
    hasTertiary: boolean
  } {
    return {
      hasPrimary: state.sealedPrimaryCount > 0 || state.openedPrimaryContainers > 0,
      hasSecondary: state.fullSecondaryCount > 0 || state.openedSecondaryContainers > 0,
      hasTertiary: state.looseTertiaryCount > 0,
    }
  }
}

export const physicalStockService = new PhysicalStockService()
