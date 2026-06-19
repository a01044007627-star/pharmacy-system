export type ItemsMode = "active" | "deleted"

export type PharmacyOption = {
  id: string
  name: string
  legal_name?: string | null
  owner_id?: string | null
  status?: string | null
}

export type BranchOption = {
  id: string
  pharmacy_id: string
  code?: string | null
  name: string
  is_default?: boolean | null
  status?: string | null
}

export type LookupOption = {
  id: string
  name: string
}

export type ItemBarcodeRow = {
  id?: string
  barcode: string
  is_primary?: boolean | null
}

export type ItemSubUnitRow = {
  id?: string
  unit_name: string
  factor?: number | string | null
  barcode?: string | null
  sell_price?: number | string | null
  is_base?: boolean | null
  main_unit?: string | null
  sub_unit?: string | null
  qty_per_main_unit?: number | string | null
  unit_raw?: string | null
}

export type ItemBatchRow = {
  id?: string
  batch_number?: string | null
  expiry_date?: string | null
  quantity?: number | string | null
  remaining_quantity?: number | string | null
}

export type ItemBalanceRow = {
  branch_id?: string | null
  quantity?: number | string | null
}

export type PharmacyItemListRow = {
  id: string
  pharmacy_id: string
  branch_id?: string | null
  group_id?: string | null
  brand_id?: string | null
  name_ar: string
  name_en?: string | null
  sku?: string | null
  category?: string | null
  sub_category?: string | null
  unit?: string | null
  manufacturer_name?: string | null
  manufacturer_country?: string | null
  pharmacy_type?: string | null
  generic_name?: string | null
  active_ingredient?: string | null
  therapeutic_class?: string | null
  dosage_form?: string | null
  strength?: string | null
  package_size?: string | null
  route_of_administration?: string | null
  registration_number?: string | null
  storage_condition?: string | null
  item_type?: string | null
  buy_price?: number | string | null
  sell_price?: number | string | null
  old_sell_price?: number | string | null
  manage_inventory?: boolean | null
  not_for_sale?: boolean | null
  min_stock?: number | string | null
  max_stock?: number | string | null
  opening_stock?: number | string | null
  has_expiry?: boolean | null
  track_batch?: boolean | null
  is_controlled?: boolean | null
  requires_prescription?: boolean | null
  expiry_date?: string | null
  image_url?: string | null
  barcode_type?: string | null
  expiry_period_value?: number | string | null
  expiry_period_unit?: string | null
  tax_name?: string | null
  tax_percent?: number | string | null
  selling_price_tax_type?: string | null
  product_type?: string | null
  variation_name?: string | null
  variation_values?: string[] | null
  variation_skus?: string[] | null
  purchase_price_including_tax?: number | string | null
  purchase_price_excluding_tax?: number | string | null
  profit_margin?: number | string | null
  opening_stock_location?: string | null
  serial_tracking_enabled?: boolean | null
  weight?: number | string | null
  rack?: string | null
  shelf_row?: string | null
  position?: string | null
  product_description?: string | null
  custom_field_1?: string | null
  custom_field_2?: string | null
  custom_field_3?: string | null
  custom_field_4?: string | null
  product_locations?: string[] | null
  import_metadata?: {
    unit_raw?: string | null
    main_unit?: string | null
    sub_unit?: string | null
    unit_factor?: number | string | null
    secondary_unit?: string | null
    secondary_unit_factor?: number | string | null
    unit_parse_note?: string | null
    [key: string]: unknown
  } | null
  status?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
  deleted_by?: string | null
  group?: LookupOption | null
  brand?: LookupOption | null
  branch?: BranchOption | null
  barcodes?: ItemBarcodeRow[]
  sub_units?: ItemSubUnitRow[]
  batches?: ItemBatchRow[]
  balances?: ItemBalanceRow[]
}

export type ItemsPayload = {
  items: PharmacyItemListRow[]
  itemsTotal?: number
  itemsLoaded?: number
  page?: number
  pageSize?: number
  totalPages?: number
  summary?: {
    lowStock: number
    outOfStock: number
    expirySoon: number
    expired: number
  }
  groups: LookupOption[]
  brands: LookupOption[]
  manufacturers: string[]
  activeIngredients: string[]
  dosageForms: string[]
  pharmacyTypes: string[]
  units: string[]
  subUnits: string[]
  branches: BranchOption[]
  pharmacyId: string | null
  branchId: string | null
}
