export const DEFAULT_GROUPS = [
  { value: "أدوية عامة", label: "أدوية عامة" },
  { value: "مضادات حيوية", label: "مضادات حيوية" },
  { value: "مسكنات", label: "مسكنات" },
  { value: "مكملات غذائية", label: "مكملات غذائية" },
  { value: "أجهزة قياس وضغط", label: "أجهزة قياس وضغط" },
]

export const DEFAULT_UNITS = [
  { value: "علبة", label: "علبة" },
  { value: "شريط", label: "شريط" },
  { value: "قرص", label: "قرص" },
  { value: "كابسولة", label: "كابسولة" },
  { value: "أمبول", label: "أمبول" },
  { value: "زجاجة", label: "زجاجة" },
  { value: "بخاخ", label: "بخاخ" },
]

export const BARCODE_TYPES = [
  { value: "EAN-13", label: "EAN-13" },
  { value: "Code-128", label: "Code-128" },
  { value: "EAN-8", label: "EAN-8" },
  { value: "UPC-A", label: "UPC-A" },
  { value: "QR Code", label: "QR Code" },
] as const

export const ITEM_TYPES = [
  { value: "stocked", label: "مخزّن" },
  { value: "service", label: "خدمة" },
  { value: "digital", label: "رقمي" },
  { value: "consignment", label: "عرضة" },
] as const

export const DRAFT_STORAGE_KEY = "pharmacy-add-item-draft"
