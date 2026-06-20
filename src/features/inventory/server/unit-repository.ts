import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { NormalizedUnitDefinition } from "@/domain/inventory/units/unit-types"

export type PharmacyUnitRow = {
  id: string
  pharmacy_id?: string
  code?: string | null
  unit_name: string
  symbol?: string | null
  category?: string | null
  quantity_mode?: string | null
  quantity_scale?: number | null
  allows_fraction?: boolean | null
  description?: string | null
  is_active?: boolean | null
  is_system?: boolean | null
  sort_order?: number | null
  created_at?: string | null
  updated_at?: string | null
}

function isMissingColumn(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "")
  return /column .* does not exist|schema cache|could not find.*column/i.test(message)
}

function isMissingTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "")
  return /pharmacy_units|relation .* does not exist/i.test(message)
}

export class UnitRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {}

  async list(): Promise<PharmacyUnitRow[]> {
    const rich = await this.db
      .from("pharmacy_units")
      .select("id,pharmacy_id,code,unit_name,symbol,category,quantity_mode,quantity_scale,allows_fraction,description,is_active,is_system,sort_order,created_at,updated_at")
      .eq("pharmacy_id", this.pharmacyId)
      .order("sort_order", { ascending: true })
      .order("unit_name", { ascending: true })

    if (!rich.error) return rich.data ?? []
    if (!isMissingColumn(rich.error) && !isMissingTable(rich.error)) throw rich.error

    const legacy = await this.db
      .from("pharmacy_units")
      .select("id,pharmacy_id,unit_name,description,is_active,created_at,updated_at")
      .eq("pharmacy_id", this.pharmacyId)
      .order("unit_name", { ascending: true })

    if (!legacy.error) return legacy.data ?? []
    if (!isMissingTable(legacy.error)) throw legacy.error

    const itemUnits = await this.db
      .from("pharmacy_item_units")
      .select("id,unit_name")
      .eq("pharmacy_id", this.pharmacyId)
      .order("unit_name", { ascending: true })
    if (itemUnits.error) throw itemUnits.error

    return Array.from(
      new Map((itemUnits.data ?? []).map((unit) => [String(unit.unit_name).trim(), unit])).values(),
    ).filter((unit) => unit.unit_name)
  }

  async create(definition: NormalizedUnitDefinition) {
    const payload = this.toPayload(definition)
    const rich = await this.db
      .from("pharmacy_units")
      .upsert(payload, { onConflict: "pharmacy_id,unit_name" })
      .select("id,pharmacy_id,code,unit_name,symbol,category,quantity_mode,quantity_scale,allows_fraction,description,is_active,is_system,sort_order,created_at,updated_at")
      .maybeSingle()

    if (!rich.error) return rich.data as PharmacyUnitRow | null
    if (!isMissingColumn(rich.error)) throw rich.error

    const legacy = await this.db
      .from("pharmacy_units")
      .upsert({
        pharmacy_id: this.pharmacyId,
        unit_name: definition.unit_name,
        description: definition.description,
        is_active: definition.is_active,
        updated_at: new Date().toISOString(),
      }, { onConflict: "pharmacy_id,unit_name" })
      .select("id,pharmacy_id,unit_name,description,is_active,created_at,updated_at")
      .maybeSingle()
    if (legacy.error) throw legacy.error
    return legacy.data as PharmacyUnitRow | null
  }

  async update(id: string, definition: NormalizedUnitDefinition) {
    const rich = await this.db
      .from("pharmacy_units")
      .update(this.toPayload(definition, false))
      .eq("id", id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,code,unit_name,symbol,category,quantity_mode,quantity_scale,allows_fraction,description,is_active,is_system,sort_order,created_at,updated_at")
      .maybeSingle()

    if (!rich.error) return rich.data as PharmacyUnitRow | null
    if (!isMissingColumn(rich.error)) throw rich.error

    const legacy = await this.db
      .from("pharmacy_units")
      .update({
        unit_name: definition.unit_name,
        description: definition.description,
        is_active: definition.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,unit_name,description,is_active,created_at,updated_at")
      .maybeSingle()
    if (legacy.error) throw legacy.error
    return legacy.data as PharmacyUnitRow | null
  }

  async delete(id: string) {
    const unit = await this.findById(id)
    if (!unit) throw new Error("الوحدة غير موجودة")

    let usage = await this.db
      .from("pharmacy_item_units")
      .select("id", { count: "exact", head: true })
      .eq("pharmacy_id", this.pharmacyId)
      .eq("unit_id", id)

    if (usage.error && isMissingColumn(usage.error)) {
      usage = await this.db
        .from("pharmacy_item_units")
        .select("id", { count: "exact", head: true })
        .eq("pharmacy_id", this.pharmacyId)
        .eq("unit_name", unit.unit_name)
    }
    if (usage.error) throw usage.error
    if ((usage.count ?? 0) > 0) {
      throw new Error("لا يمكن حذف وحدة مستخدمة في أصناف. عطّلها بدلًا من الحذف")
    }

    const { error } = await this.db
      .from("pharmacy_units")
      .delete()
      .eq("id", id)
      .eq("pharmacy_id", this.pharmacyId)
    if (error) throw error
  }

  private async findById(id: string): Promise<PharmacyUnitRow | null> {
    const { data, error } = await this.db
      .from("pharmacy_units")
      .select("id,pharmacy_id,unit_name")
      .eq("id", id)
      .eq("pharmacy_id", this.pharmacyId)
      .maybeSingle()
    if (error) throw error
    return data as PharmacyUnitRow | null
  }

  private toPayload(definition: NormalizedUnitDefinition, includePharmacy = true) {
    return {
      ...(includePharmacy ? { pharmacy_id: this.pharmacyId } : {}),
      code: definition.code,
      unit_name: definition.unit_name,
      symbol: definition.symbol,
      category: definition.category,
      quantity_mode: definition.quantity_mode,
      quantity_scale: definition.quantity_scale,
      allows_fraction: definition.allows_fraction,
      description: definition.description,
      is_active: definition.is_active,
      sort_order: definition.sort_order,
      updated_at: new Date().toISOString(),
    }
  }
}
