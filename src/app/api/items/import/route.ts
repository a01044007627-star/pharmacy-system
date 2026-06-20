import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { excelWorkbookService, type SpreadsheetRow } from "@/lib/spreadsheets/excel-workbook-service"
import { normalizeBarcode, normalizeItemName } from "@/features/inventory/lib/item-input"
import { unitPolicyService } from "@/domain/inventory/units/unit-policy"

export const runtime = "nodejs"
export const maxDuration = 300

const IMPORT_BATCH_SIZE = 500
const ATOMIC_IMPORT_BATCH_SIZE = 200
const RESPONSE_SAMPLE_LIMIT = 100
const RESPONSE_ERROR_LIMIT = 300
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_ROWS = 50_000

const CLIENT_TEMPLATE_HEADERS = [
  "اسم الدواء / الصنف",
  "الاسم الإنجليزي",
  "كود الصنف (SKU)",
  "النوع الصيدلي",
  "الاسم العلمي",
  "المادة الفعالة",
  "المجموعة العلاجية",
  "الشكل الدوائي",
  "التركيز",
  "حجم العبوة",
  "طريقة الاستخدام",
  "رقم التسجيل",
  "الشركة المنتجة",
  "بلد المنشأ",
  "العلامة التجارية",
  "المجموعة الرئيسية",
  "المجموعة الفرعية",
  "وحدة البيع",
  "الوحدة الرئيسية",
  "الوحدة الفرعية",
  "عدد الوحدات الفرعية",
  "وحدة فرعية ثانية",
  "عدد الوحدة الفرعية الثانية",
  "الباركود",
  "نوع الباركود",
  "إدارة المخزون (1/0)",
  "سعر الشراء شامل الضريبة",
  "سعر الشراء غير شامل الضريبة",
  "سعر البيع القديم",
  "سعر البيع الجديد",
  "هامش الربح %",
  "الحد الأدنى للمخزون",
  "الحد الأقصى للمخزون",
  "الرصيد الافتتاحي",
  "فرع الرصيد الافتتاحي",
  "رقم التشغيلة",
  "له صلاحية (1/0)",
  "تتبع التشغيلات (1/0)",
  "تاريخ الصلاحية",
  "مدة الصلاحية",
  "وحدة مدة الصلاحية (months/days)",
  "دواء مراقب (1/0)",
  "يتطلب روشتة (1/0)",
  "شرط التخزين",
  "الضريبة",
  "نوع ضريبة البيع (inclusive/exclusive)",
  "نوع المنتج (single/variable)",
  "اسم المتغير",
  "قيم المتغير (مفصولة بـ |)",
  "أكواد المتغيرات SKU (مفصولة بـ |)",
  "تتبع السيريال/IMEI (1/0)",
  "الوزن",
  "الرف",
  "الصف",
  "المكان",
  "الصورة",
  "ملاحظات صيدلية",
  "الحقل المخصص 1",
  "الحقل المخصص 2",
  "الحقل المخصص 3",
  "الحقل المخصص 4",
  "غير مخصص للبيع (1/0)",
  "مواقع المنتج (مفصولة بـ |)",
] as const

const CLIENT_TEMPLATE_INSTRUCTIONS = CLIENT_TEMPLATE_HEADERS.map((field) => {
  const required = field === "اسم الدواء / الصنف"
  const formats: Record<string, string> = {
    "كود الصنف (SKU)": "نص فريد؛ اتركه فارغًا للتوليد التلقائي",
    "الباركود": "نص رقمي من 4 إلى 30 رقمًا",
    "إدارة المخزون (1/0)": "0 أو 1",
    "له صلاحية (1/0)": "0 أو 1",
    "تتبع التشغيلات (1/0)": "0 أو 1",
    "دواء مراقب (1/0)": "0 أو 1",
    "يتطلب روشتة (1/0)": "0 أو 1",
    "تتبع السيريال/IMEI (1/0)": "0 أو 1",
    "غير مخصص للبيع (1/0)": "0 أو 1",
    "تاريخ الصلاحية": "YYYY-MM-DD",
    "وحدة مدة الصلاحية (months/days)": "months أو days",
    "نوع ضريبة البيع (inclusive/exclusive)": "inclusive أو exclusive",
    "نوع المنتج (single/variable)": "single أو variable",
    "قيم المتغير (مفصولة بـ |)": "قيمة1|قيمة2|قيمة3",
    "أكواد المتغيرات SKU (مفصولة بـ |)": "SKU-1|SKU-2|SKU-3",
    "مواقع المنتج (مفصولة بـ |)": "موقع1|موقع2",
  }
  const notes: Record<string, string> = {
    "اسم الدواء / الصنف": "الحقل الوحيد الإجباري. يجب ألا يكون رقمًا فقط وألا يكرر صنفًا موجودًا.",
    "فرع الرصيد الافتتاحي": "اتركه فارغًا لاستخدام الفرع النشط. عند كتابته يجب أن يطابق اسم الفرع أو كوده.",
    "وحدة البيع": "إن تُركت فارغة ستستخدم المنظومة وحدة افتراضية باسم «وحدة».",
    "عدد الوحدات الفرعية": "مثال: العلبة تحتوي 10 شرائط؛ اكتب 10.",
    "سعر الشراء غير شامل الضريبة": "هو السعر الأساسي المعتمد للتكلفة عند وجوده.",
    "الضريبة": "يمكن كتابة 14% أو 14.",
    "الباركود": "يُحفظ كنص للحفاظ على الأصفار في البداية.",
  }
  return {
    field,
    required,
    format: formats[field] ?? (/سعر|رصيد|مخزون|الوزن|عدد/.test(field) ? "رقم أكبر من أو يساوي صفر" : "نص"),
    notes: notes[field] ?? "",
  }
})


type ExcelRow = SpreadsheetRow
type LookupRow = { id: string; name: string }
type BranchLookupRow = { id: string; name: string; code?: string | null; is_default?: boolean | null }
type ImportError = { row: number; sku?: string; name?: string; message: string }

type NormalizedProductRow = {
  name: string
  pharmacyType: string
  genericName: string
  activeIngredient: string
  therapeuticClass: string
  dosageForm: string
  strength: string
  packageSize: string
  routeOfAdministration: string
  registrationNumber: string
  manufacturerCountry: string
  storageCondition: string
  isControlled: boolean
  requiresPrescription: boolean
  batchNumber: string
  brand: string
  unit: string
  unitRaw: string
  mainUnit: string
  subUnit: string
  unitFactor: number
  secondaryUnit: string
  secondaryUnitFactor: number
  unitParseNote: string
  primaryBarcode: string
  category: string
  subCategory: string
  sku: string
  barcodeType: string
  manageStock: boolean
  alertQuantity: number
  expiresIn: number
  expiryPeriodUnit: string
  applicableTax: string
  taxPercent: number
  sellingPriceTaxType: string
  productType: "single" | "variable"
  variationName: string
  variationValues: string[]
  variationSkus: string[]
  purchasePriceIncludingTax: number
  purchasePriceExcludingTax: number
  profitMargin: number
  oldSellingPrice: number
  sellingPrice: number
  openingStock: number
  openingStockLocation: string
  expiryDate: string | null
  serialTrackingEnabled: boolean
  weight: number
  rack: string
  shelfRow: string
  position: string
  imageUrl: string
  productDescription: string
  customField1: string
  customField2: string
  customField3: string
  customField4: string
  notForSelling: boolean
  productLocations: string[]
  legacyBarcode: string
  legacyNameEn: string
  legacyManufacturer: string
  legacyMaxStock: number
  legacyHasExpiry: boolean
  legacyTrackBatch: boolean
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function normalizeHeader(value: string) {
  return clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeRow(row: ExcelRow) {
  const map = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) {
    map.set(normalizeHeader(key), value)
  }
  return map
}

function valueOf(row: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row.get(normalizeHeader(alias))
    if (value !== undefined && value !== null && clean(value) !== "") return value
  }
  return ""
}

function hasHeader(row: ExcelRow, aliases: string[]) {
  const headers = new Set(Object.keys(row).map(normalizeHeader))
  return aliases.some((alias) => headers.has(normalizeHeader(alias)))
}

function numberField(row: Map<string, unknown>, aliases: string[], label: string, fallback = 0) {
  const raw = valueOf(row, aliases)
  if (clean(raw) === "") return fallback
  const parsed = numberValue(raw, Number.NaN)
  if (!Number.isFinite(parsed)) throw new Error(`${label} يجب أن يكون رقمًا صالحًا`)
  return parsed
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : fallback
  let normalized = normalizeArabicDigits(clean(value))
    .replace(/[٪%]/g, "")
    .replace(/[ججمEGP\s]/gi, "")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".")
    } else {
      normalized = normalized.replace(/,/g, "")
    }
  } else if (normalized.includes(",")) {
    const parts = normalized.split(",")
    normalized = parts.length === 2 && parts[1].length > 0 && (parts[1].length <= 2 || (parts[0] === "0" && parts[1].length <= 3))
      ? `${parts[0]}.${parts[1]}`
      : parts.join("")
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function boolValue(value: unknown, fallback = false) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return fallback
  if (["1", "yes", "y", "true", "نعم", "اه", "أه", "صح"].includes(normalized)) return true
  if (["0", "no", "n", "false", "لا", "خطأ", "غلط"].includes(normalized)) return false
  throw new Error(`القيمة المنطقية "${clean(value)}" غير صحيحة؛ استخدم 1 أو 0`)
}

function splitPipe(value: unknown) {
  return clean(value)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeTaxType(value: unknown) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return null
  if (["inclusive", "شامل", "شاملة", "include", "incl"].includes(normalized)) return "inclusive"
  if (["exclusive", "غير شامل", "غير شاملة", "exclude", "excl"].includes(normalized)) return "exclusive"
  throw new Error("نوع ضريبة البيع يجب أن يكون inclusive أو exclusive")
}

function normalizeProductType(value: unknown): "single" | "variable" {
  const normalized = clean(value).toLowerCase()
  if (!normalized || normalized === "single" || normalized === "فردي") return "single"
  if (normalized === "variable" || normalized === "متغير") return "variable"
  throw new Error("نوع المنتج يجب أن يكون single أو variable")
}

function normalizeExpiryPeriodUnit(value: unknown) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return ""
  if (["month", "months", "شهر", "شهور", "أشهر", "اشهر"].includes(normalized)) return "months"
  if (["day", "days", "يوم", "أيام", "ايام"].includes(normalized)) return "days"
  throw new Error("وحدة مدة الصلاحية يجب أن تكون months أو days")
}


function normalizeArabicDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"
  const latin = "01234567890123456789"
  return value.replace(/[٠-٩۰-۹]/g, (char) => latin[arabic.indexOf(char)] ?? char)
}

function normalizeUnitText(value: unknown) {
  return normalizeArabicDigits(clean(value))
    .replace(/[\u200E\u200F]/g, "")
    .replace(/أمبول|امبولة|امبولات/g, "امبول")
    .replace(/أقراص|اقراص|قلرص/g, "قرص")
    .replace(/شرائط|اشرطة/g, "شريط")
    .replace(/أكياس|اكياس/g, "كيس")
    .replace(/بالعبة|بالعلبه|بالعلبة/g, "")
    .replace(/كبسولات/g, "كبسولة")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(علبة|شريط|قرص|امبول|كيس|فيلم)\s+[در]$/, "$1")
}

const KNOWN_UNITS = ["ماكينة حلاقة", "علبة", "شريط", "قرص", "امبول", "كيس", "فيلم", "زجاجة", "فيال", "قطعة", "كبسولة", "عبوة", "سرنجة", "حقنة", "لبوس", "نقط", "مرهم", "كريم", "كدلس"]

function knownUnitFromText(value: string) {
  const normalized = normalizeUnitText(value).replace(/[()]/g, " ").replace(/\s+/g, " ").trim()
  return KNOWN_UNITS.find((unit) => normalized.includes(unit)) || normalized
}

function extractUnitPairs(value: string) {
  const normalized = normalizeUnitText(value)
  const pairs: Array<{ index: number; unit: string; factor: number }> = []
  for (const unit of KNOWN_UNITS.sort((a, b) => b.length - a.length)) {
    const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const qtyBefore = new RegExp(`(?<![\\d.])(\\d+(?:\\.\\d+)?)\\s*${escaped}`, "g")
    for (const match of normalized.matchAll(qtyBefore)) {
      const factor = numberValue(match[1], 1)
      if (factor > 0) pairs.push({ index: match.index ?? 0, unit, factor })
    }
    const unitBefore = new RegExp(`${escaped}\\s*(\\d+(?:\\.\\d+)?)(?![\\d.])`, "g")
    for (const match of normalized.matchAll(unitBefore)) {
      const end = (match.index ?? 0) + match[0].length
      if (end < normalized.length && /[\u0600-\u06FF]/.test(normalized[end] ?? "")) continue
      const factor = numberValue(match[1], 1)
      if (factor > 0) pairs.push({ index: match.index ?? 0, unit, factor })
    }
  }
  const seen = new Set<string>()
  return pairs
    .sort((a, b) => a.index - b.index)
    .filter((pair) => {
      const key = `${pair.unit}:${pair.factor}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function parseImportedUnit(row: Map<string, unknown>) {
  const rawUnit = clean(valueOf(row, ["UNIT RAW (Original)", "UNIT RAW", "UNIT_ORIGINAL", "الوحدة الأصلية"]))
  const unitInput = clean(valueOf(row, ["وحدة البيع", "UNIT", "وحدة", "unit", "Unit"]))
  const explicitMainUnit = clean(valueOf(row, ["الوحدة الرئيسية", "MAIN UNIT", "PRIMARY UNIT", "وحدة رئيسية"]))
  const explicitSubUnit = clean(valueOf(row, ["الوحدة الفرعية", "SUB UNIT", "SUB-UNIT", "وحدة فرعية"]))
  const explicitFactor = numberValue(valueOf(row, ["عدد الوحدات الفرعية", "QTY PER MAIN UNIT", "UNITS PER MAIN UNIT", "COUNT PER UNIT", "عدد لكل واحدة", "عدد الوحدة الفرعية داخل الرئيسية"]), 0)
  const explicitSecondaryUnit = clean(valueOf(row, ["وحدة فرعية ثانية", "SECONDARY UNIT"]))
  const explicitSecondaryFactor = numberValue(valueOf(row, ["عدد الوحدة الفرعية الثانية", "SECONDARY QTY", "SECONDARY UNIT COUNT"]), 0)
  const unitParseNote = clean(valueOf(row, ["UNIT PARSE NOTE", "ملاحظة الوحدة"]))

  if (explicitMainUnit || explicitSubUnit || explicitFactor > 0) {
    const baseUnit = explicitSubUnit || unitInput || explicitMainUnit
    return {
      unit: normalizeUnitText(baseUnit) || normalizeUnitText(unitInput),
      unitRaw: rawUnit || unitInput,
      mainUnit: normalizeUnitText(explicitMainUnit || unitInput || explicitSubUnit),
      subUnit: normalizeUnitText(explicitSubUnit),
      unitFactor: explicitFactor > 0 ? explicitFactor : 1,
      secondaryUnit: normalizeUnitText(explicitSecondaryUnit),
      secondaryUnitFactor: explicitSecondaryFactor > 0 ? explicitSecondaryFactor : 0,
      unitParseNote,
    }
  }

  const source = rawUnit || unitInput
  const normalized = normalizeUnitText(source)
  if (!normalized) {
    return { unit: "وحدة", unitRaw: "", mainUnit: "وحدة", subUnit: "", unitFactor: 1, secondaryUnit: "", secondaryUnitFactor: 0, unitParseNote: "تم استخدام وحدة افتراضية لأن الوحدة فارغة" }
  }

  const pairs = extractUnitPairs(normalized)
  if (pairs.length > 0) {
    const primary = pairs.find((pair) => pair.unit !== "علبة") || pairs[0]
    const unit = primary.factor === 1 ? primary.unit : primary.unit
    const mainUnit = primary.unit === "علبة" || primary.factor === 1 ? primary.unit : "علبة"
    const subUnit = primary.unit === "علبة" || primary.factor === 1 ? "" : primary.unit
    const secondary = pairs.find((pair) => pair.unit !== primary.unit && pair.unit !== "علبة")
    return {
      unit,
      unitRaw: source,
      mainUnit,
      subUnit,
      unitFactor: primary.factor || 1,
      secondaryUnit: secondary?.unit || "",
      secondaryUnitFactor: secondary?.factor || 0,
      unitParseNote: secondary ? "وحدة مركبة بأكتر من مستوى؛ راجع المعادلة" : "",
    }
  }

  const fallbackUnit = knownUnitFromText(normalized)
  return { unit: fallbackUnit, unitRaw: source, mainUnit: fallbackUnit, subUnit: "", unitFactor: 1, secondaryUnit: "", secondaryUnitFactor: 0, unitParseNote: unitParseNote || "" }
}

function looksLikeBarcode(value: string) {
  const normalized = value.replace(/[\s|]/g, "")
  return /^\d{4,30}$/.test(normalized)
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return null
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function parseDateValue(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === "number") {
    const parsed = excelWorkbookService.excelSerialToDate(value)
    if (parsed) return parsed.toISOString().slice(0, 10)
  }
  const raw = normalizeArabicDigits(clean(value))
  if (!raw) return null
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const egyptian = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (egyptian) return validIsoDate(Number(egyptian[3]), Number(egyptian[2]), Number(egyptian[1]))
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function parseTaxPercent(value: unknown) {
  const raw = normalizeArabicDigits(clean(value)).replace(/٫/g, ".").replace(/٬/g, ",")
  const match = raw.match(/\d+(?:[.,]\d+)?/)
  return match ? numberValue(match[0]) : 0
}

function makeSku(rowNum: number, usedSkus: Set<string>) {
  let counter = rowNum
  let sku = `ITM-${Date.now().toString(36).toUpperCase()}-${String(counter).padStart(4, "0")}`
  while (usedSkus.has(sku.toLowerCase())) {
    counter += 1
    sku = `ITM-${Date.now().toString(36).toUpperCase()}-${String(counter).padStart(4, "0")}`
  }
  return sku
}

function normalizePharmacyType(value: unknown, hint = "") {
  const explicit = clean(value).toLowerCase().replace(/[\s-]+/g, "_")
  const map: Record<string, string> = {
    medicine: "medicine", drug: "medicine", "دواء": "medicine", "أدوية": "medicine",
    medical_supply: "medical_supply", supply: "medical_supply", "مستلزم_طبي": "medical_supply", "مستلزمات_طبية": "medical_supply",
    supplement: "supplement", "مكمل": "supplement", "مكمل_غذائي": "supplement",
    cosmetic: "cosmetic", cosmetics: "cosmetic", "تجميل": "cosmetic",
    personal_care: "personal_care", "عناية_شخصية": "personal_care",
    baby_care: "baby_care", "أم_وطفل": "baby_care", "ام_وطفل": "baby_care",
    device: "device", "جهاز_طبي": "device", "أجهزة_طبية": "device",
    other: "other", "أخرى": "other", "اخرى": "other",
  }
  if (map[explicit]) return map[explicit]
  const text = `${clean(value)} ${hint}`.toLowerCase()
  if (/مستلزم|شاش|قطن|سرنج|قسطرة|medical supply/.test(text)) return "medical_supply"
  if (/مكمل|فيتامين|vitamin|supplement/.test(text)) return "supplement"
  if (/تجميل|بشرة|makeup|cosmetic/.test(text)) return "cosmetic"
  if (/شامبو|عناية شخصية|معجون|غسول|personal care/.test(text)) return "personal_care"
  if (/طفل|بيبي|حفاض|baby/.test(text)) return "baby_care"
  if (/جهاز|ميزان|ترمومتر|نبولايزر|device/.test(text)) return "device"
  return "medicine"
}

function normalizeProductRow(row: ExcelRow): NormalizedProductRow {
  const normalized = normalizeRow(row)
  const productType = normalizeProductType(valueOf(normalized, ["نوع المنتج (single/variable)", "PRODUCT TYPE (single or variable)", "PRODUCT TYPE", "نوع المنتج"]))
  const rawExpiryDate = valueOf(normalized, ["تاريخ الصلاحية", "EXPIRY DATE", "expiry_date"])
  const expiryDate = parseDateValue(rawExpiryDate)
  if (clean(rawExpiryDate) && !expiryDate) throw new Error("تاريخ الصلاحية غير صحيح؛ استخدم YYYY-MM-DD")
  const expiresIn = numberField(normalized, ["مدة الصلاحية", "EXPIRES IN", "تنتهي خلال", "expires_in"], "مدة الصلاحية")
  const applicableTax = clean(valueOf(normalized, ["الضريبة", "APPLICABLE TAX", "الضريبة المطبقة", "tax", "tax_name"]))
  const unitInfo = parseImportedUnit(normalized)
  const legacyBarcode = clean(valueOf(normalized, ["الباركود", "باركود", "barcode", "Barcode", "BARCODE"]))
  if (legacyBarcode && !looksLikeBarcode(normalizeBarcode(legacyBarcode))) {
    throw new Error("الباركود يجب أن يحتوي على أرقام فقط بطول من 4 إلى 30 رقمًا")
  }
  const variationSkus = splitPipe(valueOf(normalized, ["أكواد المتغيرات SKU (مفصولة بـ |)", "VARIATION SKUs (| seperated values & blank if product type if single)", "VARIATION SKUs", "variation_skus"]))
  const skuValue = clean(valueOf(normalized, ["كود الصنف (SKU)", "SKU (Leave blank to auto generate sku)", "SKU", "كود", "sku", "كود الصنف"]))
  const primaryBarcode = legacyBarcode
  return {
    name: clean(valueOf(normalized, ["اسم الدواء / الصنف", "NAME", "الاسم", "اسم الصنف", "name_ar", "Name"])),
    pharmacyType: normalizePharmacyType(valueOf(normalized, ["النوع الصيدلي", "PHARMACY TYPE", "pharmacy_type"]), `${clean(valueOf(normalized, ["CATEGORY", "المجموعة الرئيسية", "مجموعة", "التصنيف"]))} ${clean(valueOf(normalized, ["NAME", "اسم الدواء / الصنف", "اسم الصنف"]))}`),
    genericName: clean(valueOf(normalized, ["الاسم العلمي", "GENERIC NAME", "generic_name"])),
    activeIngredient: clean(valueOf(normalized, ["المادة الفعالة", "ACTIVE INGREDIENT", "active_ingredient"])),
    therapeuticClass: clean(valueOf(normalized, ["المجموعة العلاجية", "THERAPEUTIC CLASS", "therapeutic_class"])),
    dosageForm: clean(valueOf(normalized, ["الشكل الدوائي", "DOSAGE FORM", "dosage_form"])),
    strength: clean(valueOf(normalized, ["التركيز", "STRENGTH", "strength"])),
    packageSize: clean(valueOf(normalized, ["حجم العبوة", "PACKAGE SIZE", "package_size"])),
    routeOfAdministration: clean(valueOf(normalized, ["طريقة الاستخدام", "ROUTE OF ADMINISTRATION", "route_of_administration"])),
    registrationNumber: clean(valueOf(normalized, ["رقم التسجيل", "REGISTRATION NUMBER", "registration_number"])),
    manufacturerCountry: clean(valueOf(normalized, ["بلد المنشأ", "MANUFACTURER COUNTRY", "manufacturer_country"])),
    storageCondition: clean(valueOf(normalized, ["شرط التخزين", "STORAGE CONDITION", "storage_condition"])),
    isControlled: boolValue(valueOf(normalized, ["دواء مراقب (1/0)", "دواء مراقب", "IS CONTROLLED", "is_controlled"])),
    requiresPrescription: boolValue(valueOf(normalized, ["يتطلب روشتة (1/0)", "يتطلب روشتة", "REQUIRES PRESCRIPTION", "requires_prescription"])),
    batchNumber: clean(valueOf(normalized, ["رقم التشغيلة", "BATCH NUMBER", "batch_number"])),
    brand: clean(valueOf(normalized, ["العلامة التجارية", "BRAND", "ماركة", "brand", "Brand"])),
    unit: unitInfo.unit,
    unitRaw: unitInfo.unitRaw,
    mainUnit: unitInfo.mainUnit,
    subUnit: unitInfo.subUnit,
    unitFactor: unitInfo.unitFactor,
    secondaryUnit: unitInfo.secondaryUnit,
    secondaryUnitFactor: unitInfo.secondaryUnitFactor,
    unitParseNote: unitInfo.unitParseNote,
    primaryBarcode,
    category: clean(valueOf(normalized, ["المجموعة الرئيسية", "CATEGORY", "مجموعة", "group", "Group", "التصنيف"])),
    subCategory: clean(valueOf(normalized, ["المجموعة الفرعية", "SUB-CATEGORY", "SUB CATEGORY", "sub_category", "تصنيف فرعي"])),
    sku: skuValue,
    barcodeType: clean(valueOf(normalized, ["BARCODE TYPE", "نوع الباركود", "barcode_type"])),
    manageStock: boolValue(valueOf(normalized, ["إدارة المخزون (1/0)", "MANAGE STOCK (1=yes 0=No)", "MANAGE STOCK", "إدارة المخزون", "manage_inventory"]), true),
    alertQuantity: numberField(normalized, ["الحد الأدنى للمخزون", "ALERT QUANTITY", "حد أدنى", "min_stock", "Min Stock"], "الحد الأدنى للمخزون"),
    expiresIn,
    expiryPeriodUnit: normalizeExpiryPeriodUnit(valueOf(normalized, ["وحدة مدة الصلاحية (months/days)", "EXPIRY PERIOD UNIT (months/days)", "EXPIRY PERIOD UNIT", "expiry_period_unit"])),
    applicableTax,
    taxPercent: parseTaxPercent(applicableTax),
    sellingPriceTaxType: normalizeTaxType(valueOf(normalized, ["نوع ضريبة البيع (inclusive/exclusive)", "Selling Price Tax Type (inclusive or exclusive)", "SELLING PRICE TAX TYPE", "selling_price_tax_type"])) ?? "exclusive",
    productType,
    variationName: clean(valueOf(normalized, ["اسم المتغير", "VARIATION NAME (Keep blank if product type is single)", "VARIATION NAME", "variation_name"])),
    variationValues: splitPipe(valueOf(normalized, ["قيم المتغير (مفصولة بـ |)", "VARIATION VALUES (| seperated values & blank if product type if single)", "VARIATION VALUES", "variation_values"])),
    variationSkus,
    purchasePriceIncludingTax: numberField(normalized, ["سعر الشراء شامل الضريبة", "PURCHASE PRICE (Including tax)", "PURCHASE PRICE INCLUDING TAX", "purchase_price_including_tax"], "سعر الشراء شامل الضريبة"),
    purchasePriceExcludingTax: numberField(normalized, ["سعر الشراء غير شامل الضريبة", "سعر الشراء", "PURCHASE PRICE (Excluding tax)", "PURCHASE PRICE EXCLUDING TAX", "purchase_price_excluding_tax", "buy_price", "Buy Price"], "سعر الشراء غير شامل الضريبة"),
    profitMargin: numberField(normalized, ["هامش الربح %", "PROFIT MARGIN", "هامش الربح", "profit_margin"], "هامش الربح"),
    oldSellingPrice: numberField(normalized, ["سعر البيع القديم", "OLD SELLING PRICE", "PREVIOUS SELLING PRICE", "old_sell_price"], "سعر البيع القديم"),
    sellingPrice: numberField(normalized, ["سعر البيع الجديد", "SELLING PRICE", "سعر البيع", "sell_price", "Sell Price"], "سعر البيع الجديد"),
    openingStock: numberField(normalized, ["الرصيد الافتتاحي", "OPENING STOCK", "رصيد افتتاحي", "opening_stock", "Opening Stock"], "الرصيد الافتتاحي"),
    openingStockLocation: clean(valueOf(normalized, ["فرع الرصيد الافتتاحي", "OPENING STOCK LOCATION", "opening_stock_location"])),
    expiryDate,
    serialTrackingEnabled: boolValue(valueOf(normalized, ["تتبع السيريال/IMEI (1/0)", "ENABLE IMEI OR SERIAL NUMBER(1=yes 0=No)", "ENABLE IMEI OR SERIAL NUMBER", "serial_tracking_enabled"])),
    weight: numberField(normalized, ["WEIGHT", "الوزن", "weight"], "الوزن"),
    rack: clean(valueOf(normalized, ["RACK", "رف", "rack"])),
    shelfRow: clean(valueOf(normalized, ["ROW", "صف", "shelf_row"])),
    position: clean(valueOf(normalized, ["POSITION", "مكان", "position"])),
    imageUrl: clean(valueOf(normalized, ["IMAGE", "صورة", "image_url"])),
    productDescription: clean(valueOf(normalized, ["ملاحظات صيدلية", "PRODUCT DESCRIPTION", "وصف المنتج", "PRODUCT DESC", "notes", "ملاحظات"])),
    customField1: clean(valueOf(normalized, ["الحقل المخصص 1", "CUSTOM FIELD 1", "custom_field_1"])),
    customField2: clean(valueOf(normalized, ["الحقل المخصص 2", "CUSTOM FIELD 2", "custom_field_2"])),
    customField3: clean(valueOf(normalized, ["الحقل المخصص 3", "CUSTOM FIELD 3", "custom_field_3"])),
    customField4: clean(valueOf(normalized, ["الحقل المخصص 4", "CUSTOM FIELD 4", "custom_field_4"])),
    notForSelling: boolValue(valueOf(normalized, ["غير مخصص للبيع (1/0)", "NOT FOR SELLING(1=yes 0=No)", "NOT FOR SELLING", "not_for_sale"])),
    productLocations: splitPipe(valueOf(normalized, ["مواقع المنتج (مفصولة بـ |)", "PRODUCT LOCATIONS", "مواقع المنتج", "product_locations"])),
    legacyBarcode,
    legacyNameEn: clean(valueOf(normalized, ["الاسم الإنجليزي", "اسم إنجليزي", "name_en", "Name En"])),
    legacyManufacturer: clean(valueOf(normalized, ["الشركة المنتجة", "الشركة المصنعة", "manufacturer", "Manufacturer"])),
    legacyMaxStock: numberField(normalized, ["الحد الأقصى للمخزون", "حد أقصى", "max_stock", "Max Stock"], "الحد الأقصى للمخزون"),
    legacyHasExpiry: boolValue(valueOf(normalized, ["له صلاحية (1/0)", "صلاحية", "has_expiry", "expiry"]), Boolean(expiryDate || expiresIn)),
    legacyTrackBatch: boolValue(valueOf(normalized, ["تتبع التشغيلات (1/0)", "تشغيلات", "track_batch", "batch"]), Boolean(expiryDate)),
  }
}

function findBranchId(branches: BranchLookupRow[], nameOrCode: string, fallbackId?: string | null) {
  const normalized = clean(nameOrCode).toLowerCase()
  if (normalized) {
    const branch = branches.find((item) => item.id.toLowerCase() === normalized || item.name.toLowerCase() === normalized || clean(item.code).toLowerCase() === normalized)
    if (!branch) throw new Error(`فرع المخزون غير موجود: ${nameOrCode}`)
    return branch.id
  }
  if (fallbackId && branches.some((branch) => branch.id === fallbackId)) return fallbackId
  const defaultBranches = branches.filter((branch) => branch.is_default)
  if (defaultBranches.length === 1) return defaultBranches[0].id
  if (branches.length === 1) return branches[0].id
  return null
}


type PreparedImportRow = {
  rowNum: number
  sourceRow: ExcelRow
  row: NormalizedProductRow
  sku: string
  branchId: string | null
  itemPayload: Record<string, unknown>
}


function chunkArray<T>(rows: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

function normalizeLookupKey(value: string) {
  return clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ")
}

function uniqueNames(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map(clean).filter(Boolean)) {
    const key = normalizeLookupKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

async function refreshLookupMap(db: SupabaseClient, table: "pharmacy_item_groups" | "pharmacy_item_brands", pharmacyId: string) {
  const { data, error } = await db.from(table).select("id,name").eq("pharmacy_id", pharmacyId)
  if (error) throw error
  return new Map(((data ?? []) as LookupRow[]).map((item) => [normalizeLookupKey(item.name), item.id]))
}

async function ensureLookupsBulk(
  db: SupabaseClient,
  table: "pharmacy_item_groups" | "pharmacy_item_brands",
  pharmacyId: string,
  currentMap: Map<string, string>,
  names: string[],
) {
  const missing = uniqueNames(names).filter((name) => !currentMap.has(normalizeLookupKey(name)))
  if (missing.length > 0) {
    for (const chunk of chunkArray(missing, IMPORT_BATCH_SIZE)) {
      const { error } = await db
        .from(table)
        .upsert(chunk.map((name) => ({ pharmacy_id: pharmacyId, name })), { onConflict: "pharmacy_id,name", ignoreDuplicates: true })
      if (error) throw error
    }
  }
  return refreshLookupMap(db, table, pharmacyId)
}

function buildItemPayload(
  pharmacyId: string,
  fileName: string,
  prepared: Omit<PreparedImportRow, "itemPayload">,
  groupId: string | null,
  brandId: string | null,
) {
  const row = prepared.row
  const buyPrice = row.purchasePriceExcludingTax || row.purchasePriceIncludingTax || 0
  return {
    pharmacy_id: pharmacyId,
    branch_id: prepared.branchId,
    name_ar: row.name,
    name_en: row.legacyNameEn || null,
    sku: prepared.sku,
    category: row.category || null,
    group_id: groupId,
    brand_id: brandId,
    unit: row.unit || "وحدة",
    item_type: "stocked",
    manufacturer_name: row.legacyManufacturer || row.brand || null,
    manufacturer_country: row.manufacturerCountry || null,
    pharmacy_type: row.pharmacyType || "medicine",
    generic_name: row.genericName || null,
    active_ingredient: row.activeIngredient || null,
    therapeutic_class: row.therapeuticClass || null,
    dosage_form: row.dosageForm || null,
    strength: row.strength || null,
    package_size: row.packageSize || null,
    route_of_administration: row.routeOfAdministration || null,
    registration_number: row.registrationNumber || null,
    storage_condition: row.storageCondition || null,
    is_controlled: row.isControlled,
    requires_prescription: row.requiresPrescription,
    buy_price: buyPrice,
    sell_price: row.sellingPrice,
    old_sell_price: row.oldSellingPrice,
    manage_inventory: row.manageStock,
    not_for_sale: row.notForSelling,
    min_stock: row.alertQuantity,
    max_stock: row.legacyMaxStock,
    opening_stock: row.openingStock,
    has_expiry: Boolean(row.legacyHasExpiry || row.expiryDate || row.expiresIn > 0),
    track_batch: Boolean(row.legacyTrackBatch || row.expiryDate),
    expiry_date: row.expiryDate,
    image_url: row.imageUrl || null,
    notes: row.productDescription || null,
    sub_category: row.subCategory || null,
    barcode_type: row.barcodeType || null,
    expiry_period_value: row.expiresIn,
    expiry_period_unit: row.expiryPeriodUnit || null,
    tax_name: row.applicableTax || null,
    tax_percent: row.taxPercent,
    selling_price_tax_type: row.sellingPriceTaxType,
    product_type: row.productType,
    variation_name: row.productType === "variable" ? row.variationName || "متغير" : null,
    variation_values: row.productType === "variable" ? row.variationValues : [],
    variation_skus: row.productType === "variable" ? row.variationSkus : [],
    purchase_price_including_tax: row.purchasePriceIncludingTax,
    purchase_price_excluding_tax: row.purchasePriceExcludingTax,
    profit_margin: row.profitMargin,
    opening_stock_location: row.openingStockLocation || null,
    serial_tracking_enabled: row.serialTrackingEnabled,
    weight: row.weight,
    rack: row.rack || null,
    shelf_row: row.shelfRow || null,
    position: row.position || null,
    product_description: row.productDescription || null,
    custom_field_1: row.customField1 || null,
    custom_field_2: row.customField2 || null,
    custom_field_3: row.customField3 || null,
    custom_field_4: row.customField4 || null,
    product_locations: row.productLocations,
    import_metadata: {
      file_name: fileName,
      row_number: prepared.rowNum,
      source_headers: Object.keys(prepared.sourceRow),
      unit_raw: row.unitRaw,
      main_unit: row.mainUnit,
      sub_unit: row.subUnit,
      unit_factor: row.unitFactor,
      secondary_unit: row.secondaryUnit,
      secondary_unit_factor: row.secondaryUnitFactor,
      unit_parse_note: row.unitParseNote,
      batch_number: row.batchNumber || null,
    },
    status: "active",
  }
}

function buildBarcodeRows(row: NormalizedProductRow) {
  const barcodeValues = Array.from(new Set([
    row.primaryBarcode,
    row.legacyBarcode,
  ].map(normalizeBarcode).filter((value) => value && looksLikeBarcode(value))))

  return barcodeValues.map((barcode, barcodeIndex) => ({
    barcode,
    is_primary: barcodeIndex === 0,
  }))
}

function buildUnitRows(row: NormalizedProductRow, sellPrice: number) {
  const units = new Map<string, { unit_name: string; factor: number; is_base: boolean; sell_price: number | null }>()
  const baseUnit = row.unit || "وحدة"
  if (baseUnit) units.set(baseUnit, { unit_name: baseUnit, factor: 1, is_base: true, sell_price: sellPrice || null })
  if (row.mainUnit && row.mainUnit !== baseUnit && row.unitFactor > 1) units.set(row.mainUnit, { unit_name: row.mainUnit, factor: row.unitFactor, is_base: false, sell_price: sellPrice > 0 ? Number((sellPrice * row.unitFactor).toFixed(2)) : null })
  if (row.subUnit && row.subUnit !== baseUnit && row.subUnit !== row.mainUnit) units.set(row.subUnit, { unit_name: row.subUnit, factor: 1, is_base: false, sell_price: sellPrice || null })
  if (row.secondaryUnit && row.secondaryUnit !== row.unit && row.secondaryUnit !== row.mainUnit && row.secondaryUnitFactor > 0) {
    units.set(row.secondaryUnit, { unit_name: row.secondaryUnit, factor: row.secondaryUnitFactor, is_base: false, sell_price: sellPrice > 0 ? Number((sellPrice * row.secondaryUnitFactor).toFixed(2)) : null })
  }
  return Array.from(units.values()).map((unit, index) => ({
    ...unitPolicyService.normalizeItemUnit({
      ...unit,
      main_unit: row.mainUnit || baseUnit,
      sub_unit: row.subUnit || baseUnit,
      qty_per_main_unit: unit.unit_name === row.secondaryUnit
        ? unit.factor
        : row.unitFactor > 0 ? row.unitFactor : unit.factor,
      unit_raw: row.unitRaw || unit.unit_name,
    }, index),
  }))
}

function buildVariantRows(row: NormalizedProductRow) {
  if (row.productType !== "variable" || row.variationValues.length === 0) return []
  const purchasePrice = row.purchasePriceExcludingTax || row.purchasePriceIncludingTax || 0
  return row.variationValues.map((value, index) => ({
    name: row.variationName || "متغير",
    value,
    sku: row.variationSkus[index] || null,
    purchase_price: purchasePrice,
    sell_price: row.sellingPrice || 0,
    metadata: { source: "items_excel_import", index },
  }))
}

type AtomicImportResult = {
  row_num: number
  sku?: string | null
  name?: string | null
  status: "imported" | "skipped" | "error"
  duplicate?: boolean
  message?: string
  item?: { id?: string; name_ar?: string; sku?: string }
}

function atomicImportRowPayload(prepared: PreparedImportRow, fileDigest: string) {
  const clientRequestId = createHash("sha256")
    .update(`${fileDigest}:${prepared.rowNum}:${prepared.sku}`)
    .digest("hex")

  return {
    row_num: prepared.rowNum,
    sku: prepared.sku,
    name: prepared.row.name,
    branch_id: prepared.branchId,
    client_request_id: clientRequestId,
    item: prepared.itemPayload,
    barcodes: buildBarcodeRows(prepared.row),
    units: buildUnitRows(prepared.row, prepared.row.sellingPrice),
    variants: buildVariantRows(prepared.row),
    opening_stock: {
      quantity: prepared.row.manageStock ? prepared.row.openingStock : 0,
      expiry_date: prepared.row.expiryDate,
      batch_number: prepared.row.batchNumber || null,
    },
  }
}

function consumeAtomicImportResults(
  results: AtomicImportResult[],
  imported: Array<{ id: string; name: string; sku: string }>,
  skipped: ImportError[],
  errors: ImportError[],
) {
  for (const result of results) {
    if (result.status === "imported" && result.item?.id && result.item.name_ar && result.item.sku) {
      imported.push({ id: result.item.id, name: result.item.name_ar, sku: result.item.sku })
      continue
    }
    const issue = {
      row: Number(result.row_num) || 0,
      sku: clean(result.sku) || undefined,
      name: clean(result.name) || undefined,
      message: clean(result.message) || (result.duplicate ? "تم استيراد هذا الصف سابقًا" : "تعذر استيراد الصف"),
    }
    if (result.status === "skipped") skipped.push(issue)
    else errors.push(issue)
  }
}

async function fetchAllRows<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

export async function GET() {
  const buffer = await excelWorkbookService.createTemplate({
    sheetName: "Items_Ready",
    headers: CLIENT_TEMPLATE_HEADERS,
    requiredHeaders: ["اسم الدواء / الصنف"],
    textHeaders: ["كود الصنف (SKU)", "رقم التسجيل", "الباركود"],
    numberHeaders: CLIENT_TEMPLATE_HEADERS.filter((header) => /سعر|رصيد|مخزون|الوزن|عدد|هامش/.test(header)),
    dateHeaders: ["تاريخ الصلاحية"],
    listValidations: [
      { header: "النوع الصيدلي", values: ["دواء", "مستلزم طبي", "مكمل غذائي", "مستحضر تجميل", "عناية شخصية", "أم وطفل", "جهاز طبي", "أخرى"] },
      { header: "نوع الباركود", values: ["C128", "EAN13", "EAN8", "UPC-A"] },
      { header: "إدارة المخزون (1/0)", values: [1, 0] },
      { header: "له صلاحية (1/0)", values: [1, 0] },
      { header: "تتبع التشغيلات (1/0)", values: [1, 0] },
      { header: "دواء مراقب (1/0)", values: [1, 0] },
      { header: "يتطلب روشتة (1/0)", values: [1, 0] },
      { header: "تتبع السيريال/IMEI (1/0)", values: [1, 0] },
      { header: "غير مخصص للبيع (1/0)", values: [1, 0] },
      { header: "وحدة مدة الصلاحية (months/days)", values: ["months", "days"] },
      { header: "نوع ضريبة البيع (inclusive/exclusive)", values: ["exclusive", "inclusive"] },
      { header: "نوع المنتج (single/variable)", values: ["single", "variable"] },
    ],
    instructions: CLIENT_TEMPLATE_INSTRUCTIONS,
  })
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="pharmacy-items-import-template.xlsx"',
    },
  })
}

export async function POST(request: Request) {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة الأصناف" }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get("file")
    if (!file || !(file instanceof File)) return NextResponse.json({ error: "ارفع ملف Excel" }, { status: 400 })
    if (file.size <= 0) return NextResponse.json({ error: "ملف Excel فارغ" }, { status: 400 })
    if (file.size > MAX_IMPORT_FILE_BYTES) return NextResponse.json({ error: "حجم ملف الاستيراد أكبر من 25 ميجابايت؛ قسّمه إلى أكثر من ملف" }, { status: 413 })
    if (!/\.(xlsx|csv)$/i.test(file.name)) return NextResponse.json({ error: "صيغة الملف غير مدعومة؛ استخدم XLSX أو CSV" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileDigest = createHash("sha256").update(buffer).digest("hex")
    const rows: ExcelRow[] = await excelWorkbookService.readRows(buffer, {
      fileName: file.name,
      preferredSheetName: "Items_Ready",
    })
    if (rows.length === 0) return NextResponse.json({ error: "لا توجد بيانات في الملف" }, { status: 400 })
    if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `الملف يحتوي على ${rows.length.toLocaleString("ar-EG")} صف؛ الحد الآمن لكل عملية 50,000 صف` }, { status: 413 })
    if (!hasHeader(rows[0], ["اسم الدواء / الصنف", "NAME", "الاسم", "اسم الصنف", "name_ar"])) {
      return NextResponse.json({
        error: "رؤوس الأعمدة لا تطابق قالب استيراد الأصناف. حمّل القالب الجديد وانقل البيانات إليه دون تغيير أسماء الأعمدة.",
        supported_headers: CLIENT_TEMPLATE_HEADERS,
      }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const imported: Array<{ id: string; name: string; sku: string }> = []
    const errors: ImportError[] = []
    const skipped: ImportError[] = []

    const [groups, brands, branches, existingItems, existingBarcodes, existingUnitBarcodes] = await Promise.all([
      fetchAllRows<LookupRow>((from, to) => db.from("pharmacy_item_groups").select("id,name").eq("pharmacy_id", pharmacyId).range(from, to)),
      fetchAllRows<LookupRow>((from, to) => db.from("pharmacy_item_brands").select("id,name").eq("pharmacy_id", pharmacyId).range(from, to)),
      fetchAllRows<BranchLookupRow>((from, to) => db.from("pharmacy_branches").select("id,name,code,is_default").eq("pharmacy_id", pharmacyId).neq("status", "closed").range(from, to)),
      fetchAllRows<{ sku?: string | null; name_ar: string }>((from, to) => db.from("pharmacy_items").select("sku,name_ar").eq("pharmacy_id", pharmacyId).neq("status", "deleted").range(from, to)),
      fetchAllRows<{ barcode: string }>((from, to) => db.from("pharmacy_item_barcodes").select("barcode").eq("pharmacy_id", pharmacyId).range(from, to)),
      fetchAllRows<{ barcode?: string | null }>((from, to) => db.from("pharmacy_item_units").select("barcode").eq("pharmacy_id", pharmacyId).not("barcode", "is", null).range(from, to)),
    ])

    let groupMap = new Map(groups.map((g) => [normalizeLookupKey(g.name), g.id]))
    let brandMap = new Map(brands.map((b) => [normalizeLookupKey(b.name), b.id]))
    const usedSkus = new Set(existingItems.map((item) => clean(item.sku).toLowerCase()).filter(Boolean))
    const usedNames = new Map(existingItems.map((item) => [normalizeItemName(item.name_ar), item.name_ar]))
    const usedBarcodes = new Set([...existingBarcodes, ...existingUnitBarcodes].map((item) => normalizeBarcode(item.barcode)).filter(Boolean))

    const normalizedRows: Array<Omit<PreparedImportRow, "itemPayload">> = []

    for (let index = 0; index < rows.length; index++) {
      const rowNum = index + 2
      const sourceRow = rows[index]
      let row: NormalizedProductRow | null = null
      try {
        row = normalizeProductRow(sourceRow)
        if (!row.name) {
          errors.push({ row: rowNum, message: "NAME / اسم الصنف مطلوب" })
          continue
        }
        if (/^[\d\s.,/+-]+$/.test(row.name)) {
          errors.push({ row: rowNum, name: row.name, message: "اسم الصنف رقمي فقط ويحتاج مراجعة قبل الاستيراد" })
          continue
        }

        const nameKey = normalizeItemName(row.name)
        if (usedNames.has(nameKey)) {
          skipped.push({ row: rowNum, name: row.name, message: `اسم الصنف "${row.name}" مطابق لصنف موجود "${usedNames.get(nameKey)}"` })
          continue
        }

        const candidateBarcodes = Array.from(new Set([
          row.primaryBarcode,
          row.legacyBarcode,
        ].map(normalizeBarcode).filter((value) => value && looksLikeBarcode(value))))
        const duplicatedBarcode = candidateBarcodes.find((value) => usedBarcodes.has(value))
        if (duplicatedBarcode) {
          skipped.push({ row: rowNum, name: row.name, message: `الباركود "${duplicatedBarcode}" مستخدم بالفعل لصنف أو وحدة أخرى` })
          continue
        }
        if (row.productType === "variable" && row.variationValues.length === 0) {
          throw new Error("نوع المنتج variable يحتاج قيمًا في عمود قيم المتغير")
        }
        if (row.variationSkus.length > row.variationValues.length) {
          throw new Error("عدد أكواد المتغيرات أكبر من عدد قيم المتغير")
        }
        const variantSkuKeys = row.variationSkus.map((value) => clean(value).toLowerCase()).filter(Boolean)
        if (new Set(variantSkuKeys).size !== variantSkuKeys.length) {
          throw new Error("يوجد SKU مكرر داخل أكواد المتغيرات")
        }
        const usedVariantSku = variantSkuKeys.find((value) => usedSkus.has(value))
        if (usedVariantSku) {
          skipped.push({ row: rowNum, name: row.name, sku: usedVariantSku, message: `SKU المتغير "${usedVariantSku}" مستخدم بالفعل` })
          continue
        }

        let sku = row.sku
        if (sku) {
          const normalizedSku = sku.toLowerCase()
          if (usedSkus.has(normalizedSku)) {
            skipped.push({ row: rowNum, sku, name: row.name, message: "SKU موجود مسبقًا؛ تم تخطي الصف لتجنب تكرار الصنف" })
            continue
          }
        } else {
          sku = makeSku(rowNum, usedSkus)
        }
        if (variantSkuKeys.includes(sku.toLowerCase())) throw new Error("كود الصنف لا يمكن أن يساوي كود أحد المتغيرات")

        const branchId = findBranchId(branches, row.openingStockLocation, scope.activeBranchId)
        if (row.openingStock > 0 && !branchId) throw new Error("حدد الفرع النشط أو اكتب اسم/كود فرع الرصيد الافتتاحي بصورة صحيحة")
        if (branchId) assertBranchScope(scope, branchId)

        usedNames.set(nameKey, row.name)
        candidateBarcodes.forEach((value) => usedBarcodes.add(value))
        usedSkus.add(sku.toLowerCase())
        variantSkuKeys.forEach((value) => usedSkus.add(value))
        normalizedRows.push({ rowNum, sourceRow, row, sku, branchId })
      } catch (error) {
        errors.push({ row: rowNum, sku: row?.sku || undefined, name: row?.name || undefined, message: error instanceof Error ? error.message : "خطأ غير متوقع" })
      }
    }

    groupMap = await ensureLookupsBulk(db, "pharmacy_item_groups", pharmacyId, groupMap, normalizedRows.map((item) => item.row.category))
    brandMap = await ensureLookupsBulk(db, "pharmacy_item_brands", pharmacyId, brandMap, normalizedRows.map((item) => item.row.brand))

    const preparedRows: PreparedImportRow[] = normalizedRows.map((prepared) => ({
      ...prepared,
      itemPayload: buildItemPayload(
        pharmacyId,
        file.name,
        prepared,
        prepared.row.category ? groupMap.get(normalizeLookupKey(prepared.row.category)) ?? null : null,
        prepared.row.brand ? brandMap.get(normalizeLookupKey(prepared.row.brand)) ?? null : null,
      ),
    }))

    for (const preparedChunk of chunkArray(preparedRows, ATOMIC_IMPORT_BATCH_SIZE)) {
      const rpcRows = preparedChunk.map((prepared) => atomicImportRowPayload(prepared, fileDigest))
      const { data, error } = await db.rpc("import_pharmacy_items_batch_v1", {
        p_pharmacy_id: pharmacyId,
        p_actor_id: scope.user.id,
        p_rows: rpcRows,
      })

      if (!error) {
        const results = ((data ?? {}) as { results?: AtomicImportResult[] }).results ?? []
        consumeAtomicImportResults(results, imported, skipped, errors)
        if (results.length !== rpcRows.length) {
          const returnedRows = new Set(results.map((result) => result.row_num))
          for (const prepared of preparedChunk) {
            if (!returnedRows.has(prepared.rowNum)) errors.push({ row: prepared.rowNum, sku: prepared.sku, name: prepared.row.name, message: "لم تُرجع قاعدة البيانات نتيجة لهذا الصف" })
          }
        }
        continue
      }

      // A global/network RPC failure rolls the full batch back. Retry one row at
      // a time; the deterministic request id makes an uncertain network retry safe.
      console.warn("Atomic import batch failed, retrying rows individually:", error.message)
      for (const prepared of preparedChunk) {
        const payload = atomicImportRowPayload(prepared, fileDigest)
        const { data: rowData, error: rowError } = await db.rpc("import_pharmacy_items_batch_v1", {
          p_pharmacy_id: pharmacyId,
          p_actor_id: scope.user.id,
          p_rows: [payload],
        })
        if (rowError) {
          errors.push({ row: prepared.rowNum, sku: prepared.sku, name: prepared.row.name, message: rowError.message })
          continue
        }
        const rowResults = ((rowData ?? {}) as { results?: AtomicImportResult[] }).results ?? []
        if (rowResults.length === 0) {
          errors.push({ row: prepared.rowNum, sku: prepared.sku, name: prepared.row.name, message: "لم تُرجع قاعدة البيانات نتيجة لهذا الصف" })
          continue
        }
        consumeAtomicImportResults(rowResults, imported, skipped, errors)
      }
    }

    const logIssues = [...errors, ...skipped]
    const logText = logIssues
      .slice(0, 1000)
      .map((issue) => `صف ${issue.row}${issue.sku ? ` / ${issue.sku}` : ""}: ${issue.message}`)
      .join("\n")

    const { error: logError } = await db.from("pharmacy_import_logs").insert({
      pharmacy_id: pharmacyId,
      import_type: "items_extended",
      file_name: file.name,
      rows_total: rows.length,
      rows_inserted: imported.length,
      rows_skipped: rows.length - imported.length,
      errors: logText || null,
      error_details: logIssues.slice(0, 1000),
      created_by: scope.user.id,
      completed_at: new Date().toISOString(),
    })
    if (logError) console.warn("items import log skipped:", logError.message)

    await writeAuditLog(db, {
      pharmacyId,
      branchId: scope.activeBranchId,
      actorId: scope.user.id,
      eventType: "items.imported",
      source: "inventory",
      description: "تم استيراد ملف أصناف صيدلية مع فحص التكرار والأرصدة الافتتاحية",
      metadata: {
        file_name: file.name,
        file_size: file.size,
        total_rows: rows.length,
        imported: imported.length,
        skipped: skipped.length,
        errors: errors.length,
      },
    })

    return NextResponse.json({
      total_rows: rows.length,
      processed_rows: imported.length + skipped.length + errors.length,
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
      imported_items: imported.slice(0, RESPONSE_SAMPLE_LIMIT),
      imported_sample_size: Math.min(imported.length, RESPONSE_SAMPLE_LIMIT),
      skipped_details: skipped.slice(0, RESPONSE_ERROR_LIMIT),
      error_details: errors.slice(0, RESPONSE_ERROR_LIMIT),
      supported_headers: CLIENT_TEMPLATE_HEADERS,
    }, { status: errors.length && !imported.length ? 400 : 201 })
  } catch (error) {
    console.error("items import POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل استيراد الأصناف" }, { status: 500 })
  }
}
