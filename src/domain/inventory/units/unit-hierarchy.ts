import Decimal from "decimal.js"
import { findCatalogUnit } from "./unit-catalog"
import { QuantityMode, UnitCategory } from "./unit-types"

export enum UnitLevel {
  Primary = "primary",
  Secondary = "secondary",
  Tertiary = "tertiary",
}

export type UnitNode = {
  id: string
  itemId: string
  level: UnitLevel
  position: 1 | 2 | 3
  name: string
  code: string | null
  category: UnitCategory
  quantityMode: QuantityMode
  quantityScale: number
  parentId: string | null
  qtyInParent: number
  conversionToBase: number
  isSellable: boolean
  barcode: string | null
  oldSellPrice: number | null
  currentSellPrice: number | null
  purchaseEnabled: boolean
  saleEnabled: boolean
}

export type UnitHierarchy = {
  itemId: string
  levels: UnitNode[]
  baseUnit: UnitNode
  depth: 1 | 2 | 3
}

export type UnitConversionRequest = {
  fromUnitId: string
  toUnitId: string
  quantity: number
  hierarchy: UnitHierarchy
}

export type UnitConversionResult = {
  convertedQuantity: number
  fromUnit: UnitNode
  toUnit: UnitNode
}

export type UnitDisplay = {
  level: UnitLevel
  name: string
  code: string | null
  isSellable: boolean
  barcode: string | null
  currentSellPrice: number | null
}

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnitConversionError"
  }
}

export class UnitConversionService {
  buildHierarchy(levels: UnitNode[]): UnitHierarchy {
    if (levels.length === 0) throw new UnitConversionError("لا توجد وحدات للصنف")
    const sorted = [...levels].sort((a, b) => a.position - b.position)
    const baseUnit = sorted.find((u) => u.position === sorted.length)
      ?? sorted[sorted.length - 1]
    return {
      itemId: sorted[0].itemId,
      levels: sorted,
      baseUnit,
      depth: sorted.length as 1 | 2 | 3,
    }
  }

  toBase(quantity: number, unit: UnitNode): number {
    return new Decimal(quantity).times(unit.conversionToBase).toNumber()
  }

  fromBase(baseQuantity: number, targetUnit: UnitNode): number {
    if (targetUnit.conversionToBase === 0) throw new UnitConversionError("معامل تحويل الوحدة صفر")
    return new Decimal(baseQuantity).dividedBy(targetUnit.conversionToBase).toNumber()
  }

  convert(request: UnitConversionRequest): UnitConversionResult {
    const { fromUnitId, toUnitId, quantity, hierarchy } = request
    const fromUnit = hierarchy.levels.find((u) => u.id === fromUnitId)
    const toUnit = hierarchy.levels.find((u) => u.id === toUnitId)
    if (!fromUnit) throw new UnitConversionError(`الوحدة المصدر غير موجودة: ${fromUnitId}`)
    if (!toUnit) throw new UnitConversionError(`الوحدة الهدف غير موجودة: ${toUnitId}`)

    const baseQty = this.toBase(quantity, fromUnit)
    const converted = this.fromBase(baseQty, toUnit)

    return { convertedQuantity: converted, fromUnit, toUnit }
  }

  displayUnits(hierarchy: UnitHierarchy): UnitDisplay[] {
    return hierarchy.levels
      .filter((u) => u.isSellable)
      .map((u) => ({
        level: u.level,
        name: u.name,
        code: u.code,
        isSellable: u.isSellable,
        barcode: u.barcode,
        currentSellPrice: u.currentSellPrice,
      }))
  }

  resolveByBarcode(hierarchy: UnitHierarchy, barcode: string): UnitNode | null {
    return hierarchy.levels.find((u) => u.barcode === barcode) ?? null
  }

  createNode(input: {
    itemId: string
    position: 1 | 2 | 3
    name: string
    parentId?: string | null
    qtyInParent?: number
    conversionToBase?: number
    isSellable?: boolean
    barcode?: string | null
    oldSellPrice?: number | null
    currentSellPrice?: number | null
  }): UnitNode {
    const catalog = findCatalogUnit(input.name)
    const isBase = input.position === 1 || (
      input.position === 2 && !input.parentId
    )

    const level: UnitLevel =
      input.position === 1 ? UnitLevel.Tertiary
        : input.position === 2 ? UnitLevel.Secondary
          : UnitLevel.Primary

    return {
      id: `${input.itemId}_${level}`,
      itemId: input.itemId,
      level,
      position: input.position,
      name: input.name,
      code: catalog?.code ?? null,
      category: catalog?.category ?? UnitCategory.Other,
      quantityMode: catalog?.quantityMode ?? QuantityMode.Discrete,
      quantityScale: catalog?.quantityScale ?? 0,
      parentId: input.parentId ?? null,
      qtyInParent: input.qtyInParent ?? 1,
      conversionToBase: isBase ? 1 : (input.conversionToBase ?? input.qtyInParent ?? 1),
      isSellable: input.isSellable ?? true,
      barcode: input.barcode ?? null,
      oldSellPrice: input.oldSellPrice ?? null,
      currentSellPrice: input.currentSellPrice ?? null,
      purchaseEnabled: true,
      saleEnabled: input.isSellable ?? true,
    }
  }
}

export const unitConversionService = new UnitConversionService()
