export type ItemType = "stocked" | "service" | "digital" | "consignment"
export type ItemStatus = "active" | "draft" | "archived"
export type BarcodeType = "EAN-13" | "Code-128" | "EAN-8" | "UPC-A" | "QR Code"

export interface ItemBarcode {
  barcode: string
  barcode_type: BarcodeType
  is_primary: boolean
}

export interface ItemSubUnit {
  id: string
  unit_name: string
  factor: number
  barcode?: string
  sell_price?: number
  is_base: boolean
}

export interface ItemFormData {
  name_ar: string
  name_en: string
  sku: string
  barcodes: ItemBarcode[]
  group_id: string | null
  group_name: string | null
  brand_id: string | null
  brand_name: string | null
  unit: string
  sub_units: ItemSubUnit[]
  item_type: ItemType
  manufacturer_name: string
  buy_price: string
  sell_price: string
  old_sell_price: string
  manage_inventory: boolean
  not_for_sale: boolean
  min_stock: string
  max_stock: string
  opening_stock: string
  has_expiry: boolean
  track_batch: boolean
  is_controlled: boolean
  requires_prescription: boolean
  expiry_date: string
  image_url: string
  notes: string
  status: ItemStatus
}
