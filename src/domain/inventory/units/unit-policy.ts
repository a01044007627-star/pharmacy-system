import Decimal from "decimal.js"
import { findCatalogUnit } from "./unit-catalog"
import {
  QuantityMode,
  UnitCategory,
  type ItemUnitInput,
  type NormalizedUnitDefinition,
  type UnitDefinitionInput,
} from "./unit-types"

const MAX_QUANTITY_SCALE = 6

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseCategory(value: unknown, fallback: UnitCategory) {
  return Object.values(UnitCategory).includes(value as UnitCategory) ? value as UnitCategory : fallback
}

function parseQuantityMode(value: unknown, fallback: QuantityMode) {
  return Object.values(QuantityMode).includes(value as QuantityMode) ? value as QuantityMode : fallback
}

export class QuantityPolicy {
  readonly mode: QuantityMode
  readonly scale: number

  constructor(mode: QuantityMode, scale?: number) {
    this.mode = mode
    this.scale = mode === QuantityMode.Discrete
      ? 0
      : Math.min(MAX_QUANTITY_SCALE, Math.max(0, Math.trunc(scale ?? 3)))
  }

  get allowsFraction() {
    return this.mode === QuantityMode.Continuous && this.scale > 0
  }

  normalize(value: unknown, options: { min?: number; fallback?: number } = {}) {
    let decimal: Decimal
    try {
      decimal = new Decimal(value as Decimal.Value)
    } catch {
      decimal = new Decimal(options.fallback ?? 0)
    }
    if (!decimal.isFinite()) decimal = new Decimal(options.fallback ?? 0)
    if (options.min !== undefined && decimal.lessThan(options.min)) decimal = new Decimal(options.min)
    return decimal.toDecimalPlaces(this.scale, Decimal.ROUND_HALF_UP).toNumber()
  }

  assertValid(value: unknown, label = "الكمية") {
    const normalized = this.normalize(value)
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`${label} غير صحيحة`)
    if (!this.allowsFraction && !Number.isInteger(parsed)) {
      throw new Error(`${label} يجب أن تكون رقمًا صحيحًا لهذه الوحدة`)
    }
    return normalized
  }
}

export class UnitPolicyService {
  normalizeDefinition(input: UnitDefinitionInput): NormalizedUnitDefinition {
    const name = text(input.unit_name ?? input.name)
    if (!name) throw new Error("اسم الوحدة مطلوب")

    const catalog = findCatalogUnit(input.code) ?? findCatalogUnit(name)
    const mode = parseQuantityMode(input.quantity_mode, catalog?.quantityMode ?? QuantityMode.Discrete)
    const requestedScale = Math.trunc(finite(input.quantity_scale, catalog?.quantityScale ?? (mode === QuantityMode.Discrete ? 0 : 3)))
    const policy = new QuantityPolicy(mode, requestedScale)

    return {
      code: text(input.code).toUpperCase() || catalog?.code || null,
      unit_name: name,
      symbol: text(input.symbol) || catalog?.symbol || null,
      category: parseCategory(input.category, catalog?.category ?? UnitCategory.Other),
      quantity_mode: mode,
      quantity_scale: policy.scale,
      allows_fraction: policy.allowsFraction,
      description: text(input.description) || null,
      is_active: input.is_active !== false,
      sort_order: Math.max(0, Math.trunc(finite(input.sort_order, catalog?.sortOrder ?? 1000))),
    }
  }

  normalizeItemUnit(input: ItemUnitInput, index: number) {
    const definition = this.normalizeDefinition(input)
    const policy = new QuantityPolicy(definition.quantity_mode, definition.quantity_scale)
    const rawFactor = finite(input.factor, 1)
    const rawPerMain = finite(input.qty_per_main_unit, rawFactor)
    const factor = policy.assertValid(Math.max(rawFactor, 1), "معامل التحويل")
    const qtyPerMain = policy.assertValid(Math.max(rawPerMain, 1), "عدد الوحدات الفرعية")

    return {
      unit_name: definition.unit_name,
      unit_code: definition.code,
      category: definition.category,
      quantity_mode: definition.quantity_mode,
      quantity_scale: definition.quantity_scale,
      allows_fraction: definition.allows_fraction,
      factor,
      barcode: text(input.barcode) || null,
      sell_price: input.sell_price === null || input.sell_price === undefined || input.sell_price === ""
        ? null
        : Math.max(0, finite(input.sell_price, 0)),
      is_base: Boolean(input.is_base ?? index === 0),
      main_unit: text(input.main_unit) || definition.unit_name,
      sub_unit: text(input.sub_unit) || definition.unit_name,
      qty_per_main_unit: qtyPerMain,
      unit_raw: text(input.unit_raw) || definition.unit_name,
      purchase_enabled: input.purchase_enabled !== false,
      sale_enabled: input.sale_enabled !== false,
    }
  }

  policyFor(value: { quantity_mode?: unknown; quantity_scale?: unknown; unit_name?: unknown; unit_code?: unknown }) {
    const catalog = findCatalogUnit(value.unit_code) ?? findCatalogUnit(value.unit_name)
    const mode = parseQuantityMode(value.quantity_mode, catalog?.quantityMode ?? QuantityMode.Discrete)
    const scale = finite(value.quantity_scale, catalog?.quantityScale ?? (mode === QuantityMode.Discrete ? 0 : 3))
    return new QuantityPolicy(mode, scale)
  }
}

export const unitPolicyService = new UnitPolicyService()
