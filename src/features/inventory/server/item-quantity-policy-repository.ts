import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { unitPolicyService, type QuantityPolicy } from "@/domain/inventory/units/unit-policy"

type TransactionLine = Record<string, unknown> & {
  item_id?: unknown
  unit?: unknown
  quantity?: unknown
}

type ItemUnitPolicyRow = {
  item_id: string
  unit_name: string | null
  unit_code?: string | null
  quantity_mode?: string | null
  quantity_scale?: number | null
  is_base?: boolean | null
}

type ItemFallbackRow = {
  id: string
  unit: string | null
  status?: string | null
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function normalizedName(value: unknown) {
  return text(value).toLocaleLowerCase("ar-EG")
}

function isMissingPolicyColumn(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "")
  return /unit_code|quantity_mode|quantity_scale|schema cache|column .* does not exist/i.test(message)
}

/**
 * Resolves the quantity rules of each item/unit at the application boundary.
 * Database constraints remain the final guard, while this repository returns
 * clear Arabic validation errors before an operational RPC starts.
 */
export class ItemQuantityPolicyRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {}

  async describeBaseUnits(itemIds: string[]) {
    const uniqueIds = Array.from(new Set(itemIds.map(text).filter(Boolean)))
    if (uniqueIds.length === 0) return new Map<string, {
      unit_name: string
      quantity_mode: string
      quantity_scale: number
      allows_fraction: boolean
    }>()

    const [units, items] = await Promise.all([
      this.loadUnitPolicies(uniqueIds),
      this.loadItems(uniqueIds),
    ])
    const unitsByItem = new Map<string, ItemUnitPolicyRow[]>()
    for (const unit of units) {
      const rows = unitsByItem.get(unit.item_id) ?? []
      rows.push(unit)
      unitsByItem.set(unit.item_id, rows)
    }

    return new Map(items.map((item) => {
      const candidates = unitsByItem.get(item.id) ?? []
      const selected = candidates.find((unit) => unit.is_base) ?? candidates[0]
      const unitName = selected?.unit_name || item.unit || "وحدة"
      const policy = this.resolvePolicy(selected, unitName)
      return [item.id, {
        unit_name: unitName,
        quantity_mode: policy.mode,
        quantity_scale: policy.scale,
        allows_fraction: policy.allowsFraction,
      }]
    }))
  }

  async normalizeTransactionLines<T extends TransactionLine>(
    input: T[],
    options: { label?: string; allowZero?: boolean } = {},
  ): Promise<T[]> {
    if (!Array.isArray(input) || input.length === 0) throw new Error("أضف صنفًا واحدًا على الأقل")

    const itemIds = Array.from(new Set(input.map((line) => text(line.item_id)).filter(Boolean)))
    if (itemIds.length === 0) throw new Error("بيانات أصناف العملية غير صالحة")

    const [units, items] = await Promise.all([
      this.loadUnitPolicies(itemIds),
      this.loadItems(itemIds),
    ])
    const itemMap = new Map(items.map((item) => [item.id, item]))
    const unitsByItem = new Map<string, ItemUnitPolicyRow[]>()
    for (const unit of units) {
      const rows = unitsByItem.get(unit.item_id) ?? []
      rows.push(unit)
      unitsByItem.set(unit.item_id, rows)
    }

    return input.map((line, index) => {
      const itemId = text(line.item_id)
      const item = itemMap.get(itemId)
      if (!item || item.status === "deleted") {
        throw new Error(`الصنف في السطر ${index + 1} غير موجود أو محذوف`)
      }

      const requestedUnit = normalizedName(line.unit)
      const candidates = unitsByItem.get(itemId) ?? []
      const selected = candidates.find((unit) => normalizedName(unit.unit_name) === requestedUnit)
        ?? candidates.find((unit) => unit.is_base)
        ?? candidates[0]
      const policy = this.resolvePolicy(selected, text(line.unit) || item.unit || "وحدة")
      const quantity = policy.assertValid(line.quantity, `${options.label ?? "الكمية"} في السطر ${index + 1}`)
      if (options.allowZero ? quantity < 0 : quantity <= 0) {
        throw new Error(`${options.label ?? "الكمية"} في السطر ${index + 1} يجب أن تكون ${options.allowZero ? "صفرًا أو أكثر" : "أكبر من صفر"}`)
      }

      return {
        ...line,
        item_id: itemId,
        unit: selected?.unit_name || text(line.unit) || item.unit || "وحدة",
        quantity,
        quantity_mode: policy.mode,
        quantity_scale: policy.scale,
      } as T
    })
  }

  private resolvePolicy(unit: ItemUnitPolicyRow | undefined, fallbackUnitName: string): QuantityPolicy {
    return unitPolicyService.policyFor({
      unit_name: unit?.unit_name || fallbackUnitName,
      unit_code: unit?.unit_code,
      quantity_mode: unit?.quantity_mode,
      quantity_scale: unit?.quantity_scale,
    })
  }

  private async loadUnitPolicies(itemIds: string[]): Promise<ItemUnitPolicyRow[]> {
    const rich = await this.db
      .from("pharmacy_item_units")
      .select("item_id,unit_name,unit_code,quantity_mode,quantity_scale,is_base")
      .eq("pharmacy_id", this.pharmacyId)
      .in("item_id", itemIds)

    if (!rich.error) return (rich.data ?? []) as ItemUnitPolicyRow[]
    if (!isMissingPolicyColumn(rich.error)) throw rich.error

    const legacy = await this.db
      .from("pharmacy_item_units")
      .select("item_id,unit_name,is_base")
      .eq("pharmacy_id", this.pharmacyId)
      .in("item_id", itemIds)
    if (legacy.error) throw legacy.error
    return (legacy.data ?? []) as ItemUnitPolicyRow[]
  }

  private async loadItems(itemIds: string[]): Promise<ItemFallbackRow[]> {
    const { data, error } = await this.db
      .from("pharmacy_items")
      .select("id,unit,status")
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", itemIds)
    if (error) throw error
    return (data ?? []) as ItemFallbackRow[]
  }
}
