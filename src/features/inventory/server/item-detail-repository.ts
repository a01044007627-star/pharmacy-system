import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

type LookupTable = "pharmacy_item_groups" | "pharmacy_item_brands"

export class ItemDetailRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {}

  async find(itemId: string) {
    const { data: item, error } = await this.db
      .from("pharmacy_items")
      .select("*")
      .eq("id", itemId)
      .eq("pharmacy_id", this.pharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!item) return null

    const [group, brand, barcodes, units, variants] = await Promise.all([
      item.group_id ? this.readOptionalLookup("pharmacy_item_groups", item.group_id) : Promise.resolve(null),
      item.brand_id ? this.readOptionalLookup("pharmacy_item_brands", item.brand_id) : Promise.resolve(null),
      this.readBarcodes(itemId),
      this.readUnits(itemId),
      this.readVariants(itemId),
    ])

    return {
      item: { ...item, group, brand },
      barcodes,
      units,
      variants,
    }
  }

  private async readOptionalLookup(table: LookupTable, id: string) {
    const { data, error } = await this.db
      .from(table)
      .select("id,name")
      .eq("id", id)
      .eq("pharmacy_id", this.pharmacyId)
      .maybeSingle()

    if (error) {
      this.warn(`${table} lookup`, error)
      return null
    }
    return data ?? null
  }

  private async readBarcodes(itemId: string) {
    const { data, error } = await this.db
      .from("pharmacy_item_barcodes")
      .select("id,barcode,is_primary")
      .eq("item_id", itemId)
      .eq("pharmacy_id", this.pharmacyId)

    if (error) {
      this.warn("barcodes lookup", error)
      return []
    }
    return data ?? []
  }

  private async readUnits(itemId: string) {
    const fullQuery = await this.db
      .from("pharmacy_item_units")
      .select("id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw")
      .eq("item_id", itemId)
      .eq("pharmacy_id", this.pharmacyId)

    if (!fullQuery.error) return fullQuery.data ?? []

    // Older deployed schemas may not have the extended unit columns yet.
    const fallbackQuery = await this.db
      .from("pharmacy_item_units")
      .select("id,unit_name,factor,barcode,sell_price,is_base")
      .eq("item_id", itemId)
      .eq("pharmacy_id", this.pharmacyId)

    if (fallbackQuery.error) {
      this.warn("units lookup", fallbackQuery.error)
      return []
    }
    this.warn("extended units lookup; basic columns were used", fullQuery.error)
    return fallbackQuery.data ?? []
  }

  private async readVariants(itemId: string) {
    const { data, error } = await this.db
      .from("pharmacy_item_variants")
      .select("id,name,value,sku,sell_price,purchase_price")
      .eq("item_id", itemId)
      .eq("pharmacy_id", this.pharmacyId)
      .order("created_at")

    if (error) {
      this.warn("variants lookup", error)
      return []
    }
    return data ?? []
  }

  private warn(operation: string, error: { message?: string } | unknown) {
    const message = error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error)
    console.warn(`[ItemDetailRepository] ${operation} failed`, message)
  }
}
