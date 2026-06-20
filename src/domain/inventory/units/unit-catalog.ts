import { QuantityMode, UnitCategory, type UnitCatalogEntry } from "./unit-types"

export const PHARMACY_UNIT_CATALOG: readonly UnitCatalogEntry[] = [
  { code: "BOX", nameAr: "علبة", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["علبه", "box"], sortOrder: 10 },
  { code: "PACK", nameAr: "عبوة", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["باك", "pack", "package"], sortOrder: 20 },
  { code: "CARTON", nameAr: "كرتونة", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["كرتونه", "carton"], sortOrder: 30 },
  { code: "STRIP", nameAr: "شريط", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["strip", "blister"], sortOrder: 40 },
  { code: "BOTTLE", nameAr: "زجاجة", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["زجاجه", "bottle"], sortOrder: 50 },
  { code: "TUBE", nameAr: "أنبوبة", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["انبوبه", "تيوب", "tube"], sortOrder: 60 },
  { code: "SACHET", nameAr: "كيس", category: UnitCategory.Package, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["sachet", "packet"], sortOrder: 70 },
  { code: "PIECE", nameAr: "قطعة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["قطعه", "وحدة", "وحده", "piece", "unit"], sortOrder: 100 },
  { code: "TABLET", nameAr: "قرص", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["حباية", "حبايه", "tablet", "pill"], sortOrder: 110 },
  { code: "CAPSULE", nameAr: "كبسولة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["كبسوله", "capsule"], sortOrder: 120 },
  { code: "AMPOULE", nameAr: "أمبول", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["امبول", "ampoule", "ampule"], sortOrder: 130 },
  { code: "VIAL", nameAr: "فيال", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["vial"], sortOrder: 140 },
  { code: "INJECTION", nameAr: "حقنة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["حقنه", "سرنجة", "سرنجه", "injection", "syringe"], sortOrder: 150 },
  { code: "SUPPOSITORY", nameAr: "لبوسة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["لبوس", "لبوسه", "suppository"], sortOrder: 160 },
  { code: "PATCH", nameAr: "لاصقة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["لاصقه", "patch"], sortOrder: 170 },
  { code: "DROP", nameAr: "نقطة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["نقطه", "drop"], sortOrder: 180 },
  { code: "DOSE", nameAr: "جرعة", category: UnitCategory.Dosage, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["جرعه", "dose"], sortOrder: 190 },
  { code: "MILLILITER", nameAr: "ملليلتر", symbol: "ml", category: UnitCategory.Volume, quantityMode: QuantityMode.Continuous, quantityScale: 3, aliases: ["مل", "ملي", "ml", "milliliter", "millilitre"], sortOrder: 210 },
  { code: "LITER", nameAr: "لتر", symbol: "L", category: UnitCategory.Volume, quantityMode: QuantityMode.Continuous, quantityScale: 3, aliases: ["liter", "litre", "l"], sortOrder: 220 },
  { code: "MILLIGRAM", nameAr: "ملليجرام", symbol: "mg", category: UnitCategory.Mass, quantityMode: QuantityMode.Continuous, quantityScale: 3, aliases: ["مجم", "mg", "milligram"], sortOrder: 230 },
  { code: "GRAM", nameAr: "جرام", symbol: "g", category: UnitCategory.Mass, quantityMode: QuantityMode.Continuous, quantityScale: 3, aliases: ["جم", "g", "gram"], sortOrder: 240 },
  { code: "KILOGRAM", nameAr: "كيلوجرام", symbol: "kg", category: UnitCategory.Mass, quantityMode: QuantityMode.Continuous, quantityScale: 3, aliases: ["كجم", "kg", "kilogram"], sortOrder: 250 },
  { code: "CENTIMETER", nameAr: "سنتيمتر", symbol: "cm", category: UnitCategory.Length, quantityMode: QuantityMode.Continuous, quantityScale: 2, aliases: ["سم", "cm", "centimeter"], sortOrder: 260 },
  { code: "METER", nameAr: "متر", symbol: "m", category: UnitCategory.Length, quantityMode: QuantityMode.Continuous, quantityScale: 2, aliases: ["m", "meter", "metre"], sortOrder: 270 },
  { code: "SERVICE", nameAr: "خدمة", category: UnitCategory.Service, quantityMode: QuantityMode.Discrete, quantityScale: 0, aliases: ["خدمه", "service"], sortOrder: 300 },
] as const

function normalizeLookup(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
}

const catalogByLookup = new Map<string, UnitCatalogEntry>()
for (const unit of PHARMACY_UNIT_CATALOG) {
  for (const candidate of [unit.code, unit.nameAr, unit.symbol, ...unit.aliases]) {
    const key = normalizeLookup(candidate)
    if (key) catalogByLookup.set(key, unit)
  }
}

export function findCatalogUnit(value: unknown) {
  return catalogByLookup.get(normalizeLookup(value)) ?? null
}
