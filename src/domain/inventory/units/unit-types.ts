export enum UnitCategory {
  Package = "package",
  Dosage = "dosage",
  Volume = "volume",
  Mass = "mass",
  Length = "length",
  Service = "service",
  Other = "other",
}

export enum QuantityMode {
  Discrete = "discrete",
  Continuous = "continuous",
}

export type UnitCatalogEntry = {
  code: string
  nameAr: string
  symbol?: string
  category: UnitCategory
  quantityMode: QuantityMode
  quantityScale: number
  aliases: string[]
  sortOrder: number
}

export type UnitDefinitionInput = {
  code?: unknown
  unit_name?: unknown
  name?: unknown
  symbol?: unknown
  category?: unknown
  quantity_mode?: unknown
  quantity_scale?: unknown
  allows_fraction?: unknown
  description?: unknown
  is_active?: unknown
  sort_order?: unknown
}

export type NormalizedUnitDefinition = {
  code: string | null
  unit_name: string
  symbol: string | null
  category: UnitCategory
  quantity_mode: QuantityMode
  quantity_scale: number
  allows_fraction: boolean
  description: string | null
  is_active: boolean
  sort_order: number
}

export type ItemUnitInput = {
  unit_name?: unknown
  factor?: unknown
  barcode?: unknown
  sell_price?: unknown
  is_base?: boolean
  main_unit?: unknown
  sub_unit?: unknown
  qty_per_main_unit?: unknown
  unit_raw?: unknown
  unit_code?: unknown
  category?: unknown
  quantity_mode?: unknown
  quantity_scale?: unknown
  allows_fraction?: unknown
  purchase_enabled?: unknown
  sale_enabled?: unknown
}
