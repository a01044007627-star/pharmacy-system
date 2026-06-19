export type SubUnit = {
  level: number
  unit: string
  quantityInParent: string
  parentUnit: string
}

export type MedicineImage = {
  name: string
  size: number
  type: string
  url?: string
}

export type PriceRange = {
  old: string
  new: string
}

export type InventorySettings = {
  minAlert: string | null
  expiry: string | null
}

export type MedicineItem = {
  id: string
  nameAr: string
  nameEn?: string
  company?: string
  selectedGroup: string
  selectedUnit: string
  subUnits?: SubUnit[]
  branchId?: string
  image?: MedicineImage
  barcodes: string[]
  barcodeType: string
  pricing: {
    purchase: string
    selling: string
    range?: PriceRange | null
  }
  inventory?: InventorySettings | null
  createdAt: number
  updatedAt: number
  createdBy?: string
}

export type MedicineItemFormData = {
  nameAr: string
  nameEn?: string
  company?: string
  selectedGroup: string
  selectedUnit: string
  subUnits?: SubUnit[]
  branchId?: string
  image?: MedicineImage
  barcodes: string[]
  barcodeType: string
  pricing: {
    purchase: string
    selling: string
    range?: PriceRange | null
  }
  inventory?: InventorySettings | null
}

export type StoredItem = {
  id: string
  name_ar: string
  name_en: string | null
  company: string | null
  group: string
  unit: string
  sub_units: SubUnit[] | null
  branch_id: string | null
  image: MedicineImage | null
  barcodes: string[]
  barcode_type: string
  purchase_price: string
  selling_price: string
  price_range: PriceRange | null
  inventory_min_alert: string | null
  inventory_expiry: string | null
  created_at: number
  updated_at: number
  created_by: string | null
}
