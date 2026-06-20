import type { UnitNode, UnitHierarchy } from "../units/unit-hierarchy"
import { Money } from "../../shared/decimal-value"

export type PriceLevel = {
  unitId: string
  unitName: string
  level: string
  oldSellPrice: number | null
  currentSellPrice: number | null
}

export type PriceQuote = {
  unitId: string
  unitName: string
  level: string
  quantity: number
  unitPrice: number
  oldUnitPrice: number | null
  subtotal: number
}

export type TaxMode = "inclusive" | "exclusive"

export type TaxQuote = {
  mode: TaxMode
  rate: number
  taxableAmount: number
  taxAmount: number
  totalWithTax: number
}

export type FullPriceQuote = {
  price: PriceQuote
  tax: TaxQuote
  lineTotal: number
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PricingError"
  }
}

export class PricingEngine {
  getUnitPrice(unit: UnitNode, useOldPrice = false): number {
    if (useOldPrice) {
      return unit.oldSellPrice ?? unit.currentSellPrice ?? 0
    }
    return unit.currentSellPrice ?? unit.oldSellPrice ?? 0
  }

  quotePrice(
    unit: UnitNode,
    quantity: number,
    useOldPrice = false,
  ): PriceQuote {
    const unitPrice = this.getUnitPrice(unit, useOldPrice)
    const subtotal = Money.from(unitPrice).multiply(quantity).toNumber()

    return {
      unitId: unit.id,
      unitName: unit.name,
      level: unit.level,
      quantity,
      unitPrice,
      oldUnitPrice: unit.oldSellPrice ?? null,
      subtotal,
    }
  }

  calculateTax(
    subtotal: number,
    rate: number,
    mode: TaxMode,
  ): TaxQuote {
    if (rate <= 0) {
      return {
        mode,
        rate: 0,
        taxableAmount: subtotal,
        taxAmount: 0,
        totalWithTax: subtotal,
      }
    }

    if (mode === "inclusive") {
      const taxAmount = Money.from(subtotal)
        .multiply(rate / (100 + rate))
        .toNumber()
      return {
        mode,
        rate,
        taxableAmount: Money.from(subtotal).subtract(taxAmount).toNumber(),
        taxAmount,
        totalWithTax: subtotal,
      }
    }

    const taxAmount = Money.from(subtotal).multiply(rate / 100).toNumber()
    return {
      mode,
      rate,
      taxableAmount: subtotal,
      taxAmount,
      totalWithTax: Money.from(subtotal).add(taxAmount).toNumber(),
    }
  }

  fullQuote(
    unit: UnitNode,
    quantity: number,
    taxRate: number,
    taxMode: TaxMode,
    useOldPrice = false,
  ): FullPriceQuote {
    const price = this.quotePrice(unit, quantity, useOldPrice)
    const tax = this.calculateTax(price.subtotal, taxRate, taxMode)

    return {
      price,
      tax,
      lineTotal: tax.totalWithTax,
    }
  }

  availableLevels(hierarchy: UnitHierarchy): PriceLevel[] {
    return hierarchy.levels
      .filter((u) => u.isSellable)
      .map((u) => ({
        unitId: u.id,
        unitName: u.name,
        level: u.level,
        oldSellPrice: u.oldSellPrice,
        currentSellPrice: u.currentSellPrice,
      }))
  }
}

export const pricingEngine = new PricingEngine()
