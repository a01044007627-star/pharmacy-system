export type ItemType = "stocked" | "service" | "digital" | "consignment"
export type ItemStatus = "active" | "inactive" | "archived" | "deleted"
export type ItemProductType = "single" | "variable"
export type BarcodeType = "EAN-13" | "Code-128" | "EAN-8" | "UPC-A" | "QR Code" | "C128"

export interface ItemBarcode {
  barcode: string
  barcode_type?: BarcodeType
  is_primary?: boolean
}

export interface ItemSubUnit {
  id?: string
  unit_name: string
  factor?: number
  barcode?: string
  sell_price?: number
  is_base?: boolean
  main_unit?: string
  sub_unit?: string
  qty_per_main_unit?: number
  unit_raw?: string
}

export interface ItemVariant {
  id?: string
  name: string
  value: string
  sku?: string
  sell_price?: number
  purchase_price?: number
  barcode?: string
  metadata?: Record<string, unknown>
}

export interface ItemWarranty {
  id?: string
  item_id?: string
  name: string
  duration_days: number
  description?: string
}

export interface ItemFormData {
  name_ar: string
  name_en: string
  sku: string
  barcodes: ItemBarcode[]
  barcode_type: string
  group_id: string | null
  group_name: string | null
  brand_id: string | null
  brand_name: string | null
  category: string
  sub_category: string
  unit: string
  sub_units: ItemSubUnit[]
  main_unit: string
  sub_unit: string
  qty_per_main_unit: string
  unit_raw: string
  item_type: ItemType
  product_type: ItemProductType
  manufacturer_name: string
  buy_price: string
  purchase_price_including_tax: string
  purchase_price_excluding_tax: string
  profit_margin: string
  sell_price: string
  old_sell_price: string
  manage_inventory: boolean
  not_for_sale: boolean
  min_stock: string
  max_stock: string
  opening_stock: string
  opening_stock_location: string
  has_expiry: boolean
  track_batch: boolean
  is_controlled: boolean
  requires_prescription: boolean
  serial_tracking_enabled: boolean
  expiry_date: string
  expiry_period_value: string
  expiry_period_unit: string
  image_url: string
  tax_name: string
  tax_percent: string
  selling_price_tax_type: string
  variation_name: string
  variation_values: string
  variation_skus: string
  weight: string
  rack: string
  shelf_row: string
  position: string
  product_locations: string
  custom_field_1: string
  custom_field_2: string
  custom_field_3: string
  custom_field_4: string
  product_description: string
  notes: string
  branch_id: string
  status: string
}
