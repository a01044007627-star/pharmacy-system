export const DEFAULT_GROUPS = [
  { value: "أدوية عامة", label: "أدوية عامة" },
  { value: "مضادات حيوية", label: "مضادات حيوية" },
  { value: "مسكنات", label: "مسكنات" },
  { value: "مكملات غذائية", label: "مكملات غذائية" },
  { value: "مستلزمات طبية", label: "مستلزمات طبية" },
  { value: "عناية شخصية وتجميل", label: "عناية شخصية وتجميل" },
]

export const DEFAULT_UNITS = [
  { value: "علبة", label: "علبة" },
  { value: "شريط", label: "شريط" },
  { value: "قرص", label: "قرص" },
  { value: "كبسولة", label: "كبسولة" },
  { value: "أمبول", label: "أمبول" },
  { value: "فيال", label: "فيال" },
  { value: "زجاجة", label: "زجاجة" },
  { value: "أنبوبة", label: "أنبوبة" },
  { value: "بخاخ", label: "بخاخ" },
  { value: "كيس", label: "كيس" },
]

export const BARCODE_TYPES = [
  { value: "EAN-13", label: "EAN-13" },
  { value: "Code-128", label: "Code-128" },
  { value: "EAN-8", label: "EAN-8" },
  { value: "UPC-A", label: "UPC-A" },
  { value: "QR Code", label: "QR Code" },
] as const

// القيمة الداخلية القديمة تظل stocked للمحافظة على البيانات السابقة،
// بينما التصنيف الصيدلي الحقيقي محفوظ في pharmacy_type.
export const ITEM_TYPES = [
  { value: "stocked", label: "صنف صيدلي مخزني" },
  { value: "service", label: "خدمة صيدلية" },
] as const

export const PHARMACY_ITEM_TYPES = [
  { value: "medicine", label: "دواء" },
  { value: "medical_supply", label: "مستلزم طبي" },
  { value: "supplement", label: "مكمل غذائي" },
  { value: "cosmetic", label: "تجميل وعناية بالبشرة" },
  { value: "personal_care", label: "عناية شخصية" },
  { value: "baby_care", label: "أم وطفل" },
  { value: "device", label: "جهاز طبي" },
  { value: "other", label: "صنف صيدلي آخر" },
] as const

export const DOSAGE_FORMS = [
  "أقراص",
  "كبسولات",
  "شراب",
  "معلق",
  "نقط",
  "أمبول",
  "فيال",
  "حقن جاهزة",
  "كريم",
  "مرهم",
  "جل",
  "لبوس",
  "بخاخ",
  "استنشاق",
  "محلول",
  "غسول",
  "لاصقة",
  "أكياس",
  "مستلزم طبي",
  "غير محدد",
] as const

export const DRAFT_STORAGE_KEY = "pharmacy-add-item-draft"
