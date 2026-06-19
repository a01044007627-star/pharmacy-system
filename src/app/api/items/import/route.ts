import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import * as XLSX from "xlsx"
import { addOpeningStock } from "@/lib/inventory/opening-stock"

export const runtime = "nodejs"
export const maxDuration = 300

const IMPORT_BATCH_SIZE = 500
const AUX_IMPORT_BATCH_SIZE = 1000
const RESPONSE_SAMPLE_LIMIT = 100
const RESPONSE_ERROR_LIMIT = 300

const CLIENT_TEMPLATE_HEADERS = [
  "NAME",
  "BRAND",
  "UNIT",
  "UNIT RAW (Original)",
  "MAIN UNIT",
  "SUB UNIT",
  "QTY PER MAIN UNIT",
  "SECONDARY UNIT",
  "SECONDARY QTY",
  "UNIT PARSE STATUS",
  "UNIT PARSE NOTE",
  "CATEGORY",
  "SUB-CATEGORY",
  "SKU (Leave blank to auto generate sku)",
  "BARCODE TYPE",
  "MANAGE STOCK (1=yes 0=No)",
  "ALERT QUANTITY",
  "EXPIRES IN",
  "EXPIRY PERIOD UNIT (months/days)",
  "APPLICABLE TAX",
  "Selling Price Tax Type (inclusive or exclusive)",
  "PRODUCT TYPE (single or variable)",
  "VARIATION NAME (Keep blank if product type is single)",
  "VARIATION VALUES (| seperated values & blank if product type if single)",
  "VARIATION SKUs (| seperated values & blank if product type if single)",
  "PURCHASE PRICE (Including tax)",
  "PURCHASE PRICE (Excluding tax)",
  "PROFIT MARGIN",
  "SELLING PRICE",
  "OPENING STOCK",
  "OPENING STOCK LOCATION",
  "EXPIRY DATE",
  "ENABLE IMEI OR SERIAL NUMBER(1=yes 0=No)",
  "WEIGHT",
  "RACK",
  "ROW",
  "POSITION",
  "IMAGE",
  "PRODUCT DESCRIPTION",
  "CUSTOM FIELD 1",
  "CUSTOM FIELD 2",
  "CUSTOM FIELD 3",
  "CUSTOM FIELD 4",
  "NOT FOR SELLING(1=yes 0=No)",
  "PRODUCT LOCATIONS",
] as const

type ExcelRow = Record<string, unknown>
type LookupRow = { id: string; name: string }
type BranchLookupRow = { id: string; name: string; code?: string | null; is_default?: boolean | null }
type ImportError = { row: number; sku?: string; name?: string; message: string }

type NormalizedProductRow = {
  name: string
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
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[\u200E\u200F]/g, "")
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

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : fallback
  const normalized = clean(value).replace(/,/g, "").replace(/%/g, "").replace(/[ججمEGP\s]/gi, "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function boolValue(value: unknown, fallback = false) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return fallback
  return ["1", "yes", "y", "true", "نعم", "اه", "أه", "صح"].includes(normalized)
}

function splitPipe(value: unknown) {
  return clean(value)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeTaxType(value: unknown) {
  const normalized = clean(value).toLowerCase()
  if (["inclusive", "شامل", "شاملة", "include", "incl"].includes(normalized)) return "inclusive"
  if (["exclusive", "غير شامل", "غير شاملة", "exclude", "excl"].includes(normalized)) return "exclusive"
  return normalized || null
}

function normalizeProductType(value: unknown): "single" | "variable" {
  const normalized = clean(value).toLowerCase()
  return normalized === "variable" || normalized === "متغير" ? "variable" : "single"
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
  const unitInput = clean(valueOf(row, ["UNIT", "وحدة", "unit", "Unit"]))
  const explicitMainUnit = clean(valueOf(row, ["MAIN UNIT", "PRIMARY UNIT", "وحدة رئيسية", "الوحدة الرئيسية"]))
  const explicitSubUnit = clean(valueOf(row, ["SUB UNIT", "SUB-UNIT", "وحدة فرعية", "الوحدة الفرعية"]))
  const explicitFactor = numberValue(valueOf(row, ["QTY PER MAIN UNIT", "UNITS PER MAIN UNIT", "COUNT PER UNIT", "عدد لكل واحدة", "عدد الوحدة الفرعية داخل الرئيسية"]), 0)
  const explicitSecondaryUnit = clean(valueOf(row, ["SECONDARY UNIT", "وحدة فرعية ثانية"]))
  const explicitSecondaryFactor = numberValue(valueOf(row, ["SECONDARY QTY", "SECONDARY UNIT COUNT", "عدد الوحدة الفرعية الثانية"]), 0)
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
    return { unit: "", unitRaw: "", mainUnit: "", subUnit: "", unitFactor: 1, secondaryUnit: "", secondaryUnitFactor: 0, unitParseNote: "الوحدة فارغة" }
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

async function insertItemUnits(db: SupabaseClient, pharmacyId: string, itemId: string, row: NormalizedProductRow, sellPrice: number) {
  const units = new Map<string, { unit_name: string; factor: number; is_base: boolean; sell_price: number | null }>()
  if (row.unit) units.set(row.unit, { unit_name: row.unit, factor: 1, is_base: true, sell_price: sellPrice || null })
  if (row.mainUnit && row.mainUnit !== row.unit && row.unitFactor > 1) units.set(row.mainUnit, { unit_name: row.mainUnit, factor: row.unitFactor, is_base: false, sell_price: null })
  if (row.subUnit && row.subUnit !== row.unit && row.subUnit !== row.mainUnit) units.set(row.subUnit, { unit_name: row.subUnit, factor: 1, is_base: false, sell_price: null })
  if (row.secondaryUnit && row.secondaryUnit !== row.unit && row.secondaryUnit !== row.mainUnit && row.secondaryUnitFactor > 0) {
    units.set(row.secondaryUnit, { unit_name: row.secondaryUnit, factor: row.secondaryUnitFactor, is_base: false, sell_price: null })
  }
  const rows = Array.from(units.values()).map((unit) => ({ pharmacy_id: pharmacyId, item_id: itemId, ...unit }))
  if (rows.length === 0) return
  const { error } = await db.from("pharmacy_item_units").insert(rows)
  if (error && !/duplicate|unique/i.test(error.message)) throw error
}

function parseDateValue(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      const month = String(parsed.m).padStart(2, "0")
      const day = String(parsed.d).padStart(2, "0")
      return `${parsed.y}-${month}-${day}`
    }
  }
  const raw = clean(value)
  if (!raw) return null
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`
  const egyptian = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (egyptian) return `${egyptian[3]}-${egyptian[2].padStart(2, "0")}-${egyptian[1].padStart(2, "0")}`
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function parseTaxPercent(value: unknown) {
  const raw = clean(value)
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
  usedSkus.add(sku.toLowerCase())
  return sku
}

function normalizeProductRow(row: ExcelRow): NormalizedProductRow {
  const normalized = normalizeRow(row)
  const productType = normalizeProductType(valueOf(normalized, ["PRODUCT TYPE (single or variable)", "PRODUCT TYPE", "نوع المنتج"]))
  const expiryDate = parseDateValue(valueOf(normalized, ["EXPIRY DATE", "تاريخ الصلاحية", "expiry_date"]))
  const expiresIn = numberValue(valueOf(normalized, ["EXPIRES IN", "تنتهي خلال", "expires_in"]))
  const applicableTax = clean(valueOf(normalized, ["APPLICABLE TAX", "الضريبة المطبقة", "tax", "tax_name"]))
  const unitInfo = parseImportedUnit(normalized)
  const legacyBarcode = clean(valueOf(normalized, ["باركود", "barcode", "Barcode", "BARCODE"]))
  const variationSkus = splitPipe(valueOf(normalized, ["VARIATION SKUs (| seperated values & blank if product type if single)", "VARIATION SKUs", "variation_skus"]))
  const skuValue = clean(valueOf(normalized, ["SKU (Leave blank to auto generate sku)", "SKU", "كود", "sku", "كود الصنف"]))
  const primaryBarcode = legacyBarcode || (productType === "single" ? variationSkus.find((value) => looksLikeBarcode(value)) || (looksLikeBarcode(skuValue) ? skuValue : "") : "")
  return {
    name: clean(valueOf(normalized, ["NAME", "الاسم", "اسم الصنف", "name_ar", "Name"])),
    brand: clean(valueOf(normalized, ["BRAND", "ماركة", "brand", "Brand", "العلامة التجارية"])),
    unit: unitInfo.unit,
    unitRaw: unitInfo.unitRaw,
    mainUnit: unitInfo.mainUnit,
    subUnit: unitInfo.subUnit,
    unitFactor: unitInfo.unitFactor,
    secondaryUnit: unitInfo.secondaryUnit,
    secondaryUnitFactor: unitInfo.secondaryUnitFactor,
    unitParseNote: unitInfo.unitParseNote,
    primaryBarcode,
    category: clean(valueOf(normalized, ["CATEGORY", "مجموعة", "group", "Group", "التصنيف"])),
    subCategory: clean(valueOf(normalized, ["SUB-CATEGORY", "SUB CATEGORY", "sub_category", "تصنيف فرعي"])),
    sku: skuValue,
    barcodeType: clean(valueOf(normalized, ["BARCODE TYPE", "نوع الباركود", "barcode_type"])),
    manageStock: boolValue(valueOf(normalized, ["MANAGE STOCK (1=yes 0=No)", "MANAGE STOCK", "إدارة المخزون", "manage_inventory"]), true),
    alertQuantity: numberValue(valueOf(normalized, ["ALERT QUANTITY", "حد أدنى", "min_stock", "Min Stock"])),
    expiresIn,
    expiryPeriodUnit: clean(valueOf(normalized, ["EXPIRY PERIOD UNIT (months/days)", "EXPIRY PERIOD UNIT", "expiry_period_unit"])).toLowerCase(),
    applicableTax,
    taxPercent: parseTaxPercent(applicableTax),
    sellingPriceTaxType: normalizeTaxType(valueOf(normalized, ["Selling Price Tax Type (inclusive or exclusive)", "SELLING PRICE TAX TYPE", "selling_price_tax_type"])) ?? "exclusive",
    productType,
    variationName: clean(valueOf(normalized, ["VARIATION NAME (Keep blank if product type is single)", "VARIATION NAME", "variation_name"])),
    variationValues: splitPipe(valueOf(normalized, ["VARIATION VALUES (| seperated values & blank if product type if single)", "VARIATION VALUES", "variation_values"])),
    variationSkus,
    purchasePriceIncludingTax: numberValue(valueOf(normalized, ["PURCHASE PRICE (Including tax)", "PURCHASE PRICE INCLUDING TAX", "purchase_price_including_tax"])),
    purchasePriceExcludingTax: numberValue(valueOf(normalized, ["PURCHASE PRICE (Excluding tax)", "PURCHASE PRICE EXCLUDING TAX", "purchase_price_excluding_tax", "سعر الشراء", "buy_price", "Buy Price"])),
    profitMargin: numberValue(valueOf(normalized, ["PROFIT MARGIN", "هامش الربح", "profit_margin"])),
    sellingPrice: numberValue(valueOf(normalized, ["SELLING PRICE", "سعر البيع", "sell_price", "Sell Price"])),
    openingStock: numberValue(valueOf(normalized, ["OPENING STOCK", "رصيد افتتاحي", "opening_stock", "Opening Stock"])),
    openingStockLocation: clean(valueOf(normalized, ["OPENING STOCK LOCATION", "فرع الرصيد الافتتاحي", "opening_stock_location"])),
    expiryDate,
    serialTrackingEnabled: boolValue(valueOf(normalized, ["ENABLE IMEI OR SERIAL NUMBER(1=yes 0=No)", "ENABLE IMEI OR SERIAL NUMBER", "serial_tracking_enabled"])),
    weight: numberValue(valueOf(normalized, ["WEIGHT", "الوزن", "weight"])),
    rack: clean(valueOf(normalized, ["RACK", "رف", "rack"])),
    shelfRow: clean(valueOf(normalized, ["ROW", "صف", "shelf_row"])),
    position: clean(valueOf(normalized, ["POSITION", "مكان", "position"])),
    imageUrl: clean(valueOf(normalized, ["IMAGE", "صورة", "image_url"])),
    productDescription: clean(valueOf(normalized, ["PRODUCT DESCRIPTION", "وصف المنتج", "PRODUCT DESC", "notes", "ملاحظات"])),
    customField1: clean(valueOf(normalized, ["CUSTOM FIELD 1", "custom_field_1"])),
    customField2: clean(valueOf(normalized, ["CUSTOM FIELD 2", "custom_field_2"])),
    customField3: clean(valueOf(normalized, ["CUSTOM FIELD 3", "custom_field_3"])),
    customField4: clean(valueOf(normalized, ["CUSTOM FIELD 4", "custom_field_4"])),
    notForSelling: boolValue(valueOf(normalized, ["NOT FOR SELLING(1=yes 0=No)", "NOT FOR SELLING", "not_for_sale"])),
    productLocations: splitPipe(valueOf(normalized, ["PRODUCT LOCATIONS", "مواقع المنتج", "product_locations"])),
    legacyBarcode,
    legacyNameEn: clean(valueOf(normalized, ["اسم إنجليزي", "name_en", "Name En"])),
    legacyManufacturer: clean(valueOf(normalized, ["الشركة المصنعة", "manufacturer", "Manufacturer"])),
    legacyMaxStock: numberValue(valueOf(normalized, ["حد أقصى", "max_stock", "Max Stock"])),
    legacyHasExpiry: boolValue(valueOf(normalized, ["صلاحية", "has_expiry", "expiry"]), Boolean(expiryDate || expiresIn)),
    legacyTrackBatch: boolValue(valueOf(normalized, ["تشغيلات", "track_batch", "batch"]), Boolean(expiryDate)),
  }
}

function findBranchId(branches: BranchLookupRow[], nameOrCode: string, fallbackId?: string | null) {
  const normalized = clean(nameOrCode).toLowerCase()
  if (normalized) {
    const branch = branches.find((item) => item.id.toLowerCase() === normalized || item.name.toLowerCase() === normalized || clean(item.code).toLowerCase() === normalized)
    if (!branch) throw new Error(`فرع المخزون غير موجود: ${nameOrCode}`)
    return branch.id
  }
  return fallbackId || branches.find((branch) => branch.is_default)?.id || branches[0]?.id || null
}

async function ensureLookup(db: SupabaseClient, table: "pharmacy_item_groups" | "pharmacy_item_brands", pharmacyId: string, map: Map<string, string>, name: string) {
  const key = name.toLowerCase()
  if (!name) return null
  const existing = map.get(key)
  if (existing) return existing
  const { data, error } = await db
    .from(table)
    .insert({ pharmacy_id: pharmacyId, name })
    .select("id,name")
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  map.set(key, id)
  return id
}

async function insertVariants(db: SupabaseClient, pharmacyId: string, itemId: string, row: NormalizedProductRow) {
  if (row.productType !== "variable" || row.variationValues.length === 0) return
  const rows = row.variationValues.map((value, index) => ({
    pharmacy_id: pharmacyId,
    item_id: itemId,
    name: row.variationName || "Variation",
    value,
    sku: row.variationSkus[index] || null,
    purchase_price: row.purchasePriceExcludingTax || row.purchasePriceIncludingTax || 0,
    sell_price: row.sellingPrice || null,
    metadata: {
      source: "excel_import",
      variation_index: index,
    },
  }))
  const { error } = await db.from("pharmacy_item_variants").insert(rows)
  if (error) throw error
}


type PreparedImportRow = {
  rowNum: number
  sourceRow: ExcelRow
  row: NormalizedProductRow
  sku: string
  branchId: string | null
  itemPayload: Record<string, unknown>
}

type InsertedImportItem = {
  id: string
  name_ar: string
  sku: string
  unit?: string | null
  buy_price?: unknown
  track_batch?: boolean | null
  has_expiry?: boolean | null
}

function chunkArray<T>(rows: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

function normalizeLookupKey(value: string) {
  return clean(value).toLowerCase()
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
    unit: row.unit || null,
    item_type: "stocked",
    manufacturer_name: row.legacyManufacturer || row.brand || null,
    buy_price: buyPrice,
    sell_price: row.sellingPrice,
    old_sell_price: 0,
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
    variation_name: row.variationName || null,
    variation_values: row.variationValues,
    variation_skus: row.variationSkus,
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
    },
    status: "active",
  }
}

function buildBarcodeRows(pharmacyId: string, itemId: string, row: NormalizedProductRow) {
  const barcodeValues = Array.from(new Set([
    row.primaryBarcode,
    row.legacyBarcode,
    ...(row.productType === "single" ? row.variationSkus : []),
  ].map(clean).filter((value) => value && looksLikeBarcode(value))))

  return barcodeValues.map((barcode, barcodeIndex) => ({
    pharmacy_id: pharmacyId,
    item_id: itemId,
    barcode,
    is_primary: barcodeIndex === 0,
  }))
}

function buildUnitRows(pharmacyId: string, itemId: string, row: NormalizedProductRow, sellPrice: number) {
  const units = new Map<string, { unit_name: string; factor: number; is_base: boolean; sell_price: number | null }>()
  if (row.unit) units.set(row.unit, { unit_name: row.unit, factor: 1, is_base: true, sell_price: sellPrice || null })
  if (row.mainUnit && row.mainUnit !== row.unit && row.unitFactor > 1) units.set(row.mainUnit, { unit_name: row.mainUnit, factor: row.unitFactor, is_base: false, sell_price: null })
  if (row.subUnit && row.subUnit !== row.unit && row.subUnit !== row.mainUnit) units.set(row.subUnit, { unit_name: row.subUnit, factor: 1, is_base: false, sell_price: null })
  if (row.secondaryUnit && row.secondaryUnit !== row.unit && row.secondaryUnit !== row.mainUnit && row.secondaryUnitFactor > 0) {
    units.set(row.secondaryUnit, { unit_name: row.secondaryUnit, factor: row.secondaryUnitFactor, is_base: false, sell_price: null })
  }
  return Array.from(units.values()).map((unit) => ({ pharmacy_id: pharmacyId, item_id: itemId, ...unit }))
}

function buildVariantRows(pharmacyId: string, itemId: string, row: NormalizedProductRow) {
  if (row.productType !== "variable" || row.variationValues.length === 0) return []
  return row.variationValues.map((value, index) => ({
    pharmacy_id: pharmacyId,
    item_id: itemId,
    name: row.variationName || "Variation",
    value,
    sku: row.variationSkus[index] || null,
    purchase_price: row.purchasePriceExcludingTax || row.purchasePriceIncludingTax || 0,
    sell_price: row.sellingPrice || null,
    metadata: {
      source: "excel_import",
      variation_index: index,
    },
  }))
}

async function insertAuxiliaryRows(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (rows.length === 0) return
  for (const chunk of chunkArray(rows, AUX_IMPORT_BATCH_SIZE)) {
    const query = onConflict
      ? db.from(table).upsert(chunk, { onConflict, ignoreDuplicates: true })
      : db.from(table).insert(chunk)
    const { error } = await query
    if (error) throw error
  }
}

export async function GET() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...CLIENT_TEMPLATE_HEADERS],
    [
      "Panadol Extra",
      "GSK",
      "شريط",
      "شريط 10",
      "علبة",
      "شريط",
      10,
      "",
      "",
      "جاهز",
      "",
      "مسكنات",
      "باراسيتامول",
      "",
      "C128",
      1,
      5,
      24,
      "months",
      "14%",
      "exclusive",
      "single",
      "",
      "",
      "",
      11.4,
      10,
      20,
      12,
      100,
      "الفرع الرئيسي",
      "2028-12-31",
      0,
      0.05,
      "A",
      "1",
      "3",
      "https://example.com/image.png",
      "وصف مختصر للصنف",
      "",
      "",
      "",
      "",
      0,
      "الفرع الرئيسي",
    ],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Items")
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
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

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellText: false, raw: true })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return NextResponse.json({ error: "ملف Excel فارغ" }, { status: 400 })

    const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], { defval: "", raw: false })
    if (rows.length === 0) return NextResponse.json({ error: "لا توجد بيانات في الملف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const imported: Array<{ id: string; name: string; sku: string }> = []
    const errors: ImportError[] = []
    const skipped: ImportError[] = []

    const [groupsResult, brandsResult, branchesResult, skuResult, nameResult, barcodeResult] = await Promise.all([
      db.from("pharmacy_item_groups").select("id,name").eq("pharmacy_id", pharmacyId),
      db.from("pharmacy_item_brands").select("id,name").eq("pharmacy_id", pharmacyId),
      db.from("pharmacy_branches").select("id,name,code,is_default").eq("pharmacy_id", pharmacyId).neq("status", "closed"),
      db.from("pharmacy_items").select("sku").eq("pharmacy_id", pharmacyId),
      db.from("pharmacy_items").select("name_ar").eq("pharmacy_id", pharmacyId).neq("status", "deleted"),
      db.from("pharmacy_item_barcodes").select("barcode").eq("pharmacy_id", pharmacyId),
    ])
    if (groupsResult.error) throw groupsResult.error
    if (brandsResult.error) throw brandsResult.error
    if (branchesResult.error) throw branchesResult.error
    if (skuResult.error) throw skuResult.error
    if (nameResult.error) throw nameResult.error
    if (barcodeResult.error) throw barcodeResult.error

    let groupMap = new Map(((groupsResult.data ?? []) as LookupRow[]).map((g) => [normalizeLookupKey(g.name), g.id]))
    let brandMap = new Map(((brandsResult.data ?? []) as LookupRow[]).map((b) => [normalizeLookupKey(b.name), b.id]))
    const branches = (branchesResult.data ?? []) as BranchLookupRow[]
    const usedSkus = new Set(((skuResult.data ?? []) as Array<{ sku?: string | null }>).map((item) => clean(item.sku).toLowerCase()).filter(Boolean))
    const usedNames = new Map(((nameResult.data ?? []) as Array<{ name_ar: string }>).map((item) => [normalizeLookupKey(item.name_ar), item.name_ar]))
    const usedBarcodes = new Set(((barcodeResult.data ?? []) as Array<{ barcode: string }>).map((item) => clean(item.barcode).toLowerCase()).filter(Boolean))

    const normalizedRows: Array<Omit<PreparedImportRow, "itemPayload">> = []

    for (let index = 0; index < rows.length; index++) {
      const rowNum = index + 2
      const sourceRow = rows[index]
      const row = normalizeProductRow(sourceRow)
      try {
        if (!row.name) {
          errors.push({ row: rowNum, message: "NAME / اسم الصنف مطلوب" })
          continue
        }

        const nameKey = normalizeLookupKey(row.name)
        if (usedNames.has(nameKey)) {
          skipped.push({ row: rowNum, name: row.name, message: `اسم الصنف "${row.name}" مطابق لصنف موجود "${usedNames.get(nameKey)}"` })
          continue
        }
        usedNames.set(nameKey, row.name)

        const primaryBarcodeValue = clean(row.primaryBarcode).toLowerCase()
        if (primaryBarcodeValue && usedBarcodes.has(primaryBarcodeValue)) {
          skipped.push({ row: rowNum, name: row.name, message: `الباركود "${row.primaryBarcode}" مستخدم بالفعل لصنف آخر` })
          continue
        }
        if (primaryBarcodeValue) usedBarcodes.add(primaryBarcodeValue)

        let sku = row.sku
        if (sku) {
          const normalizedSku = sku.toLowerCase()
          if (usedSkus.has(normalizedSku)) {
            skipped.push({ row: rowNum, sku, name: row.name, message: "SKU موجود مسبقًا؛ تم تخطي الصف لتجنب تكرار الصنف" })
            continue
          }
          usedSkus.add(normalizedSku)
        } else {
          sku = makeSku(rowNum, usedSkus)
        }

        const branchId = findBranchId(branches, row.openingStockLocation, scope.activeBranchId)
        if (row.openingStock > 0 && !branchId) throw new Error("حدد الفرع النشط أو اكتب OPENING STOCK LOCATION صحيح قبل استيراد رصيد افتتاحي")

        normalizedRows.push({ rowNum, sourceRow, row, sku, branchId })
      } catch (error) {
        errors.push({ row: rowNum, sku: row.sku || undefined, name: row.name || undefined, message: error instanceof Error ? error.message : "خطأ غير متوقع" })
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

    const insertedBySku = new Map<string, { item: InsertedImportItem; prepared: PreparedImportRow }>()

    for (const preparedChunk of chunkArray(preparedRows, IMPORT_BATCH_SIZE)) {
      const { data, error } = await db
        .from("pharmacy_items")
        .insert(preparedChunk.map((row) => row.itemPayload))
        .select("id,name_ar,sku,unit,buy_price,track_batch,has_expiry")

      if (error) {
        // Fallback row-by-row only for the failed chunk so one bad row does not stop the full file.
        for (const prepared of preparedChunk) {
          const { data: item, error: itemError } = await db
            .from("pharmacy_items")
            .insert(prepared.itemPayload)
            .select("id,name_ar,sku,unit,buy_price,track_batch,has_expiry")
            .single()
          if (itemError || !item) {
            errors.push({ row: prepared.rowNum, sku: prepared.sku, name: prepared.row.name, message: itemError?.message ?? "فشل إنشاء الصنف" })
            continue
          }
          const inserted = item as InsertedImportItem
          insertedBySku.set(inserted.sku.toLowerCase(), { item: inserted, prepared })
        }
        continue
      }

      for (const item of (data ?? []) as InsertedImportItem[]) {
        const prepared = preparedChunk.find((row) => row.sku.toLowerCase() === item.sku.toLowerCase())
        if (!prepared) continue
        insertedBySku.set(item.sku.toLowerCase(), { item, prepared })
      }
    }

    const barcodeRows: Record<string, unknown>[] = []
    const unitRows: Record<string, unknown>[] = []
    const variantRows: Record<string, unknown>[] = []

    for (const { item, prepared } of insertedBySku.values()) {
      imported.push({ id: item.id, name: item.name_ar, sku: item.sku })
      barcodeRows.push(...buildBarcodeRows(pharmacyId, item.id, prepared.row))
      unitRows.push(...buildUnitRows(pharmacyId, item.id, prepared.row, prepared.row.sellingPrice))
      variantRows.push(...buildVariantRows(pharmacyId, item.id, prepared.row))
    }

    try {
      await insertAuxiliaryRows(db, "pharmacy_item_barcodes", barcodeRows, "pharmacy_id,barcode")
    } catch (error) {
      errors.push({ row: 0, message: `تم استيراد الأصناف، لكن فشل حفظ بعض الباركودات: ${error instanceof Error ? error.message : "خطأ غير متوقع"}` })
    }

    try {
      await insertAuxiliaryRows(db, "pharmacy_item_units", unitRows, "pharmacy_id,item_id,unit_name")
    } catch (error) {
      errors.push({ row: 0, message: `تم استيراد الأصناف، لكن فشل حفظ بعض الوحدات: ${error instanceof Error ? error.message : "خطأ غير متوقع"}` })
    }

    try {
      await insertAuxiliaryRows(db, "pharmacy_item_variants", variantRows)
    } catch (error) {
      errors.push({ row: 0, message: `تم استيراد الأصناف، لكن فشل حفظ بعض المتغيرات: ${error instanceof Error ? error.message : "خطأ غير متوقع"}` })
    }

    try {
      const batchRows = []
      for (const { item, prepared } of insertedBySku.values()) {
        if (prepared.row.openingStock <= 0 || !prepared.row.manageStock) continue
        const quantity = prepared.row.openingStock
        const expiryDate = prepared.row.expiryDate
        const shouldCreateBatch = Boolean(item.track_batch || item.has_expiry || expiryDate)
        if (shouldCreateBatch) {
          batchRows.push({
            pharmacy_id: pharmacyId,
            item_id: item.id,
            branch_id: prepared.branchId,
            batch_number: "OPENING",
            expiry_date: expiryDate || null,
            quantity,
            remaining_quantity: quantity,
            unit: item.unit || null,
            cost_price: item.buy_price || 0,
            source_type: "opening_stock",
            source_id: item.id,
          })
        }
      }

      const batchMap = new Map<string, string>()
      if (batchRows.length > 0) {
        for (const chunk of chunkArray(batchRows, AUX_IMPORT_BATCH_SIZE)) {
          const { data, error } = await db
            .from("pharmacy_item_batches")
            .insert(chunk)
            .select("id, item_id")
          if (error) throw error
          if (data) {
            for (const row of data as Array<{ id: string; item_id: string }>) {
              batchMap.set(row.item_id, row.id)
            }
          }
        }
      }

      const balanceRows = []
      const movementRows = []
      const nowStr = new Date().toISOString()
      for (const { item, prepared } of insertedBySku.values()) {
        if (prepared.row.openingStock <= 0 || !prepared.row.manageStock) continue
        const quantity = prepared.row.openingStock
        const unitPrice = Number(item.buy_price) || 0

        balanceRows.push({
          pharmacy_id: pharmacyId,
          item_id: item.id,
          branch_id: prepared.branchId,
          quantity,
          updated_at: nowStr,
        })

        movementRows.push({
          pharmacy_id: pharmacyId,
          item_id: item.id,
          batch_id: batchMap.get(item.id) || null,
          branch_id: prepared.branchId,
          direction: "in",
          quantity,
          unit_price: unitPrice,
          total_value: Number((quantity * unitPrice).toFixed(2)),
          movement_type: "opening_stock",
          source_table: "pharmacy_items",
          source_id: item.id,
          created_by: scope.user.id || null,
        })
      }

      if (balanceRows.length > 0) {
        for (const chunk of chunkArray(balanceRows, AUX_IMPORT_BATCH_SIZE)) {
          const { error } = await db
            .from("pharmacy_stock_balances")
            .upsert(chunk, { onConflict: "pharmacy_id,item_id,branch_id" })
          if (error) throw error
        }
      }

      if (movementRows.length > 0) {
        for (const chunk of chunkArray(movementRows, AUX_IMPORT_BATCH_SIZE)) {
          const { error } = await db
            .from("pharmacy_stock_movements")
            .insert(chunk)
          if (error) throw error
        }
      }
    } catch (bulkError) {
      console.warn("Bulk opening stock insert failed, falling back to row-by-row:", bulkError)
      for (const { item, prepared } of insertedBySku.values()) {
        if (prepared.row.openingStock <= 0 || !prepared.row.manageStock) continue
        try {
          await addOpeningStock(db, {
            pharmacyId,
            itemId: item.id,
            branchId: prepared.branchId,
            actorId: scope.user.id,
            quantity: prepared.row.openingStock,
            unitPrice: item.buy_price,
            unit: item.unit,
            expiryDate: prepared.row.expiryDate,
            trackBatch: Boolean(item.track_batch),
            hasExpiry: Boolean(item.has_expiry),
          })
        } catch (error) {
          errors.push({ row: prepared.rowNum, sku: item.sku, name: item.name_ar, message: `تم إنشاء الصنف لكن فشل تسجيل الرصيد الافتتاحي: ${error instanceof Error ? error.message : "خطأ غير متوقع"}` })
        }
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
