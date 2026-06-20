import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import type { BranchOption, ItemBalanceRow, ItemBarcodeRow, ItemBatchRow, ItemSubUnitRow, LookupOption, PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { addOpeningStock } from "@/lib/inventory/opening-stock"
import { allSearchText, expiryState, isLowStock, isOutOfStock, numberValue, primaryBarcode, quantity } from "@/features/inventory/lib/items-helpers"
import { normalizeBarcodeInputs, normalizeItemName, postgresErrorMessage } from "@/features/inventory/lib/item-input"

function clean(s: unknown) { return String(s ?? "").trim() }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}


function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "ar"))
}

async function readLookup<T = Record<string, unknown>>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) {
    console.warn(`[api/items] ${label} skipped:`, error.message)
    return [] as T[]
  }
  return data ?? []
}

type OrFilterQuery<TQuery> = { or(filters: string): TQuery }

function applyBranchScope<T extends OrFilterQuery<T>>(query: T, branchId: string | null): T {
  if (!branchId) return query
  // الأصناف العامة branch_id = null تظهر مع أي فرع، والأصناف الخاصة تظهر في فرعها فقط.
  return query.or(`branch_id.is.null,branch_id.eq.${branchId}`)
}

function mapByItemId<T extends { item_id?: string | null }>(rows: T[]) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    if (!row.item_id) continue
    const list = map.get(row.item_id) ?? []
    list.push(row)
    map.set(row.item_id, list)
  }
  return map
}

function chunkArray<T>(rows: T[], size = 500) {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

function asPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function paramValue(url: URL, key: string, fallback = "all") {
  return clean(url.searchParams.get(key)) || fallback
}

function sanitizeSearch(value: string) {
  return value.replace(/[%_,()\-.]/g, " ").replace(/\s+/g, " ").trim()
}

const SQL_SORT_MAP: Record<string, string> = {
  name: "name_ar",
  manufacturer: "manufacturer_name",
  pharmacyType: "pharmacy_type",
  activeIngredient: "active_ingredient",
  dosage: "dosage_form",
  group: "group_id",
  brand: "brand_id",
  subCategory: "sub_category",
  productType: "product_type",
  tax: "tax_percent",
  weight: "weight",
  branch: "branch_id",
  unit: "unit",
  sku: "sku",
  status: "status",
  sellPrice: "sell_price",
  buyPrice: "buy_price",
  oldSellPrice: "old_sell_price",
}

function hasComplexFilter(filters: Record<string, string | boolean>) {
  return filters.expiry !== "all" || filters.price !== "all" || filters.stock !== "all" || filters.subUnit !== "all"
}

function priceChanged(item: PharmacyItemListRow) {
  const oldPrice = numberValue(item.old_sell_price)
  const currentPrice = numberValue(item.sell_price)
  return oldPrice > 0 && currentPrice !== oldPrice
}

function applyListFilters(items: PharmacyItemListRow[], url: URL, branchId: string | null) {
  const search = clean(url.searchParams.get("search")).toLowerCase()
  const filters = {
    pharmacyType: paramValue(url, "pharmacy_type"),
    groupId: paramValue(url, "group_id"),
    brandId: paramValue(url, "brand_id"),
    manufacturer: paramValue(url, "manufacturer"),
    unit: paramValue(url, "unit"),
    subUnit: paramValue(url, "sub_unit"),
    expiry: paramValue(url, "expiry"),
    price: paramValue(url, "price"),
    stock: paramValue(url, "stock"),
    notForSale: url.searchParams.get("not_for_sale") === "true",
  }

  return items.filter((item) => {
    if (filters.pharmacyType !== "all" && item.pharmacy_type !== filters.pharmacyType) return false
    if (filters.groupId !== "all" && item.group_id !== filters.groupId) return false
    if (filters.brandId !== "all" && item.brand_id !== filters.brandId) return false
    if (filters.manufacturer !== "all" && (item.manufacturer_name ?? "") !== filters.manufacturer) return false
    if (filters.unit !== "all" && (item.unit ?? "") !== filters.unit) return false
    if (filters.subUnit !== "all" && !(item.sub_units ?? []).some((unit) => unit.unit_name === filters.subUnit)) return false
    if (filters.notForSale && !item.not_for_sale) return false

    const currentExpiryState = expiryState(item)
    if (filters.expiry !== "all" && currentExpiryState !== filters.expiry) return false

    if (filters.price === "changed" && !priceChanged(item)) return false
    if (filters.price === "has-old" && numberValue(item.old_sell_price) <= 0) return false
    if (filters.price === "new-only" && numberValue(item.old_sell_price) > 0) return false

    if (filters.stock === "low" && !isLowStock(item, branchId)) return false
    if (filters.stock === "out" && !isOutOfStock(item, branchId)) return false
    if (filters.stock === "available" && quantity(item, branchId) <= 0) return false

    if (search && !allSearchText(item).includes(search)) return false
    return true
  })
}

function sortItems(items: PharmacyItemListRow[], sortKey: string, sortDir: string, branchId: string | null) {
  const dir = sortDir === "desc" ? -1 : 1
  const valueFor = (item: PharmacyItemListRow) => {
    switch (sortKey) {
      case "stock": return quantity(item, branchId)
      case "sellPrice": return numberValue(item.sell_price)
      case "oldSellPrice": return numberValue(item.old_sell_price)
      case "buyPrice": return numberValue(item.buy_price)
      case "manufacturer": return item.manufacturer_name ?? ""
      case "pharmacyType": return item.pharmacy_type ?? ""
      case "activeIngredient": return item.active_ingredient ?? item.generic_name ?? ""
      case "dosage": return [item.dosage_form, item.strength, item.package_size].filter(Boolean).join(" ")
      case "group": return item.group?.name ?? ""
      case "brand": return item.brand?.name ?? ""
      case "subCategory": return item.sub_category ?? ""
      case "productType": return item.product_type ?? ""
      case "tax": return numberValue(item.tax_percent)
      case "storage": return [item.rack, item.shelf_row, item.position].filter(Boolean).join("-")
      case "weight": return numberValue(item.weight)
      case "branch": return item.branch?.name ?? ""
      case "unit": return item.unit ?? ""
      case "expiry": {
        const expiry = item.expiry_date ?? item.batches?.find((batch) => batch.expiry_date)?.expiry_date
        return expiry ? new Date(expiry).getTime() : Number.MAX_SAFE_INTEGER
      }
      case "sku": return primaryBarcode(item)
      case "status": return item.status ?? ""
      default: return item.name_ar ?? ""
    }
  }
  return [...items].sort((a, b) => {
    const av = valueFor(a)
    const bv = valueFor(b)
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
    return String(av).localeCompare(String(bv), "ar") * dir
  })
}

async function fetchItemPage(
  db: SupabaseClient,
  pharmacyId: string,
  branchId: string | null,
  mode: "active" | "deleted",
  options: {
    search?: string
    pharmacyType?: string
    groupId?: string
    brandId?: string
    manufacturer?: string
    unit?: string
    notForSale?: boolean
    sortSql?: string
    sortDir?: string
    rangeFrom: number
    rangeTo: number
  },
) {
  let query = db
    .from("pharmacy_items")
    .select("*", { count: "exact", head: false })
    .eq("pharmacy_id", pharmacyId)

  query = applyBranchScope(query, branchId)
  query = mode === "deleted" ? query.eq("status", "deleted") : query.neq("status", "deleted")

  if (options.search) {
    const q = sanitizeSearch(options.search)
    if (q) {
      query = query.or(
        `name_ar.ilike.%${q}%,name_en.ilike.%${q}%,sku.ilike.%${q}%,search_text.ilike.%${q}%`,
      )
    }
  }
  if (options.pharmacyType && options.pharmacyType !== "all") query = query.eq("pharmacy_type", options.pharmacyType)
  if (options.groupId && options.groupId !== "all") query = query.eq("group_id", options.groupId)
  if (options.brandId && options.brandId !== "all") query = query.eq("brand_id", options.brandId)
  if (options.manufacturer && options.manufacturer !== "all") query = query.eq("manufacturer_name", options.manufacturer)
  if (options.unit && options.unit !== "all") query = query.eq("unit", options.unit)
  if (options.notForSale) query = query.eq("not_for_sale", true)

  const sortCol = (options.sortSql && SQL_SORT_MAP[options.sortSql]) ? SQL_SORT_MAP[options.sortSql] : "name_ar"
  query = query.order(sortCol, { ascending: options.sortDir !== "desc" })
  query = query.range(options.rangeFrom, options.rangeTo)

  const { data, error, count } = await query
  if (error) throw error

  return {
    items: (data ?? []) as PharmacyItemListRow[],
    count: count ?? 0,
  }
}

async function fetchRelatedByItemIds<T = Record<string, unknown>>(
  label: string,
  itemIds: string[],
  buildQuery: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = []
  for (const ids of chunkArray(itemIds, 500)) {
    rows.push(...await readLookup<T>(buildQuery(ids), `${label}:${ids.length}`))
  }
  return rows
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const requestedPharmacyId = url.searchParams.get("pharmacy_id")
    const requestedBranchParam = url.searchParams.get("branch_id")
    const mode = url.searchParams.get("mode") === "deleted" ? "deleted" : "active"

    const scope = await getServerAuthScope({
      requestedPharmacyId,
      requestedBranchId: requestedBranchParam && requestedBranchParam !== "all" ? requestedBranchParam : null,
    })

    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })

    if (requestedPharmacyId && requestedPharmacyId !== scope.activePharmacyId && !scope.isDeveloper) {
      return NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 })
    }

    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية قراءة الأصناف" }, { status: 403 })
    if (mode === "deleted" && !scopeCan(scope, "deleted-records:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المحذوفات" }, { status: 403 })

    let branchId = requestedBranchParam && requestedBranchParam !== "all" ? requestedBranchParam : null
    if (branchId) assertBranchScope(scope, branchId)
    if (!branchId && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const [branches, groups, brands] = await Promise.all([
      readLookup<BranchOption>(
        db
          .from("pharmacy_branches")
          .select("id, pharmacy_id, code, name, is_default, status")
          .eq("pharmacy_id", pharmacyId)
          .neq("status", "closed")
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true }),
        "branches",
      ),
      readLookup<LookupOption>(
        db.from("pharmacy_item_groups").select("id, name").eq("pharmacy_id", pharmacyId).order("name"),
        "groups",
      ),
      readLookup<LookupOption>(
        db.from("pharmacy_item_brands").select("id, name").eq("pharmacy_id", pharmacyId).order("name"),
        "brands",
      ),
    ])

    const page = asPositiveInt(url.searchParams.get("page"), 1, 100000)
    const pageSize = asPositiveInt(url.searchParams.get("page_size"), 25, 1000)
    const sortKey = paramValue(url, "sort_key", "name")
    const sortDir = paramValue(url, "sort_dir", "asc")
    const search = clean(url.searchParams.get("search"))
    const filters = {
      pharmacyType: paramValue(url, "pharmacy_type"),
      groupId: paramValue(url, "group_id"),
      brandId: paramValue(url, "brand_id"),
      manufacturer: paramValue(url, "manufacturer"),
      unit: paramValue(url, "unit"),
      subUnit: paramValue(url, "sub_unit"),
      expiry: paramValue(url, "expiry"),
      price: paramValue(url, "price"),
      stock: paramValue(url, "stock"),
      notForSale: url.searchParams.get("not_for_sale") === "true",
    }

    const [{ data: catalogData, error: catalogError }, { data: optionData, error: optionError }] = await Promise.all([
      db.rpc("pharmacy_items_catalog", {
        p_pharmacy_id: pharmacyId,
        p_branch_id: branchId,
        p_mode: mode,
        p_search: search,
        p_item_type: filters.pharmacyType,
        p_group_id: filters.groupId,
        p_brand_id: filters.brandId,
        p_manufacturer: filters.manufacturer,
        p_unit: filters.unit,
        p_sub_unit: filters.subUnit,
        p_expiry: filters.expiry,
        p_price: filters.price,
        p_stock: filters.stock,
        p_not_for_sale: filters.notForSale,
        p_sort_key: sortKey,
        p_sort_dir: sortDir,
        p_page: page,
        p_page_size: pageSize,
      }),
      db.rpc("pharmacy_item_filter_options", {
        p_pharmacy_id: pharmacyId,
        p_branch_id: branchId,
        p_mode: mode,
      }),
    ])

    if (!catalogError && catalogData && typeof catalogData === "object") {
      const catalog = catalogData as Record<string, unknown>
      const options = !optionError && optionData && typeof optionData === "object"
        ? optionData as Record<string, unknown>
        : {}
      return NextResponse.json({
        ...catalog,
        itemsLoaded: Array.isArray(catalog.items) ? catalog.items.length : 0,
        groups,
        brands,
        branches,
        manufacturers: Array.isArray(options.manufacturers) ? options.manufacturers : [],
        activeIngredients: Array.isArray(options.activeIngredients) ? options.activeIngredients : [],
        dosageForms: Array.isArray(options.dosageForms) ? options.dosageForms : [],
        pharmacyTypes: Array.isArray(options.pharmacyTypes) ? options.pharmacyTypes : [],
        units: Array.isArray(options.units) ? options.units : [],
        subUnits: Array.isArray(options.subUnits) ? options.subUnits : [],
        pharmacyId,
        branchId,
      })
    }
    if (catalogError && !/function .* does not exist|schema cache/i.test(catalogError.message)) {
      console.warn("[api/items] catalogue RPC failed; using compatibility path:", catalogError.message)
    }

    const hasComplex = hasComplexFilter(filters)
    const buffer = hasComplex ? Math.max(pageSize * 5, 500) : pageSize
    const rangeFrom = (page - 1) * pageSize
    const rangeTo = rangeFrom + buffer - 1

    const { items: rawItems, count: sqlCount } = await fetchItemPage(db, pharmacyId, branchId, mode, {
      search: search.toLowerCase(),
      pharmacyType: filters.pharmacyType,
      groupId: filters.groupId,
      brandId: filters.brandId,
      manufacturer: filters.manufacturer,
      unit: filters.unit,
      notForSale: filters.notForSale,
      sortSql: SQL_SORT_MAP[sortKey] ? sortKey : undefined,
      sortDir,
      rangeFrom,
      rangeTo,
    })

    const itemIds = rawItems.map((item) => item.id)
    const [barcodes, subUnits, batches, balances] = itemIds.length > 0
      ? await Promise.all([
          fetchRelatedByItemIds<(ItemBarcodeRow & { item_id: string })>(
            "barcodes",
            itemIds,
            (ids) => db.from("pharmacy_item_barcodes").select("id, item_id, barcode, is_primary").eq("pharmacy_id", pharmacyId).in("item_id", ids),
          ),
          fetchRelatedByItemIds<(ItemSubUnitRow & { item_id: string })>(
            "sub-units",
            itemIds,
            (ids) => db.from("pharmacy_item_units").select("id, item_id, unit_name, factor, barcode, sell_price, is_base, main_unit, sub_unit, qty_per_main_unit, unit_raw, unit_id, unit_code, category, quantity_mode, quantity_scale, allows_fraction, purchase_enabled, sale_enabled").eq("pharmacy_id", pharmacyId).in("item_id", ids),
          ),
          fetchRelatedByItemIds<(ItemBatchRow & { item_id: string })>(
            "batches",
            itemIds,
            (ids) => applyBranchScope(
              db.from("pharmacy_item_batches").select("id, item_id, branch_id, batch_number, expiry_date, quantity, remaining_quantity").eq("pharmacy_id", pharmacyId).in("item_id", ids),
              branchId,
            ),
          ),
          fetchRelatedByItemIds<(ItemBalanceRow & { item_id: string })>(
            "stock-balances",
            itemIds,
            (ids) => applyBranchScope(
              db.from("pharmacy_stock_balances").select("item_id, branch_id, quantity").eq("pharmacy_id", pharmacyId).in("item_id", ids),
              branchId,
            ),
          ),
        ])
      : [[], [], [], []]

    const groupMap = new Map(groups.map((group) => [group.id, group]))
    const brandMap = new Map(brands.map((brand) => [brand.id, brand]))
    const branchMap = new Map(branches.map((branch) => [branch.id, branch]))
    const barcodesByItem = mapByItemId(barcodes)
    const subUnitsByItem = mapByItemId(subUnits)
    const batchesByItem = mapByItemId(batches)
    const balancesByItem = mapByItemId(balances)

    const items = rawItems.map((item) => ({
      ...item,
      group: item.group_id ? groupMap.get(item.group_id) ?? null : null,
      brand: item.brand_id ? brandMap.get(item.brand_id) ?? null : null,
      branch: item.branch_id ? branchMap.get(item.branch_id) ?? null : null,
      barcodes: barcodesByItem.get(item.id) ?? [],
      sub_units: subUnitsByItem.get(item.id) ?? [],
      batches: batchesByItem.get(item.id) ?? [],
      balances: balancesByItem.get(item.id) ?? [],
    })) satisfies PharmacyItemListRow[]

    const filteredItems = hasComplex
      ? applyListFilters(items, url, branchId)
      : items

    const sortedItems = sortItems(filteredItems, sortKey, sortDir, branchId)
    const itemsTotal = hasComplex
      ? sortedItems.length
      : sqlCount
    const totalPages = Math.max(1, Math.ceil(itemsTotal / pageSize))
    const currentPage = Math.min(page, totalPages)
    const pageItems = sortedItems.slice(0, pageSize)
    const summary = {
      lowStock: filteredItems.filter((item) => isLowStock(item, branchId)).length,
      outOfStock: filteredItems.filter((item) => isOutOfStock(item, branchId)).length,
      expirySoon: filteredItems.filter((item) => expiryState(item) === "soon").length,
      expired: filteredItems.filter((item) => expiryState(item) === "expired").length,
    }

    return NextResponse.json({
      items: pageItems,
      itemsTotal,
      itemsLoaded: rawItems.length,
      page: currentPage,
      pageSize,
      totalPages,
      summary,
      groups,
      brands,
      branches,
      manufacturers: uniqueStrings(rawItems.map((item) => item.manufacturer_name)),
      activeIngredients: uniqueStrings(rawItems.map((item) => item.active_ingredient)),
      dosageForms: uniqueStrings(rawItems.map((item) => item.dosage_form)),
      pharmacyTypes: uniqueStrings(rawItems.map((item) => item.pharmacy_type)),
      units: uniqueStrings(rawItems.map((item) => item.unit)),
      subUnits: uniqueStrings(subUnits.map((unit) => unit.unit_name)),
      pharmacyId,
      branchId,
    })
  } catch (error) {
    console.error("items GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الأصناف"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let createdItemId: string | null = null
  let cleanupDb: SupabaseClient | null = null
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة الأصناف" }, { status: 403 })

    const itemBranchId = clean(body.branch_id) || null
    if (itemBranchId) assertBranchScope(scope, itemBranchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    cleanupDb = db
    const pharmacyId = scope.activePharmacyId
    const nameAr = clean(body.name_ar)
    if (!nameAr) return NextResponse.json({ error: "اسم الصنف مطلوب" }, { status: 400 })

    const { data: existingName } = await db
      .from("pharmacy_items")
      .select("id, name_ar")
      .eq("pharmacy_id", pharmacyId)
      .eq("name_ar", nameAr)
      .neq("status", "deleted")
      .maybeSingle()
    if (existingName && normalizeItemName(existingName.name_ar) === normalizeItemName(nameAr)) return NextResponse.json({ error: `يوجد صنف بنفس الاسم: ${existingName.name_ar}` }, { status: 409 })

    const rawBarcodes = Array.isArray(body.barcodes) ? body.barcodes as Array<{ barcode?: unknown; is_primary?: boolean }> : []
    const rawUnits = Array.isArray(body.units) ? body.units as Array<Record<string, unknown>> : []
    const normalizedRelations = normalizeBarcodeInputs(rawBarcodes, rawUnits)
    if (normalizedRelations.duplicates.length > 0) {
      return NextResponse.json({ error: `الباركود مكرر داخل الصنف: ${normalizedRelations.duplicates.join("، ")}` }, { status: 409 })
    }
    if (normalizedRelations.all.length > 0) {
      const [{ data: existingBarcodes }, { data: existingUnitBarcodes }] = await Promise.all([
        db.from("pharmacy_item_barcodes").select("barcode,item_id").eq("pharmacy_id", pharmacyId).in("barcode", normalizedRelations.all),
        db.from("pharmacy_item_units").select("barcode,item_id").eq("pharmacy_id", pharmacyId).in("barcode", normalizedRelations.all),
      ])
      const used = [...(existingBarcodes ?? []), ...(existingUnitBarcodes ?? [])].map((row) => row.barcode).filter(Boolean)
      if (used.length > 0) {
        return NextResponse.json({ error: `الباركودات التالية مستخدمة بالفعل: ${used.join("، ")}` }, { status: 409 })
      }
    }

    const baseUnit = clean(body.unit) || clean(body.sub_unit) || "وحدة"

    const itemData: Record<string, unknown> = {
      pharmacy_id: pharmacyId,
      name_ar: nameAr,
      name_en: clean(body.name_en) || null,
      sku: clean(body.sku) || null,
      group_id: clean(body.group_id) || null,
      brand_id: clean(body.brand_id) || null,
      unit: baseUnit,
      item_type: clean(body.item_type) || "stocked",
      manufacturer_name: clean(body.manufacturer_name) || null,
      manufacturer_country: clean(body.manufacturer_country) || null,
      pharmacy_type: clean(body.pharmacy_type) || "medicine",
      generic_name: clean(body.generic_name) || null,
      active_ingredient: clean(body.active_ingredient) || null,
      therapeutic_class: clean(body.therapeutic_class) || null,
      dosage_form: clean(body.dosage_form) || null,
      strength: clean(body.strength) || null,
      package_size: clean(body.package_size) || null,
      route_of_administration: clean(body.route_of_administration) || null,
      registration_number: clean(body.registration_number) || null,
      storage_condition: clean(body.storage_condition) || null,
      buy_price: Math.max(0, Number(body.buy_price) || 0),
      sell_price: Math.max(0, Number(body.sell_price) || 0),
      old_sell_price: Math.max(0, Number(body.old_sell_price) || 0),
      manage_inventory: body.manage_inventory !== false,
      not_for_sale: Boolean(body.not_for_sale),
      min_stock: Math.max(0, Number(body.min_stock) || 0),
      max_stock: Math.max(0, Number(body.max_stock) || 0),
      opening_stock: Math.max(0, Number(body.opening_stock) || 0),
      has_expiry: Boolean(body.has_expiry),
      track_batch: Boolean(body.track_batch),
      is_controlled: Boolean(body.is_controlled),
      requires_prescription: Boolean(body.requires_prescription),
      notes: clean(body.notes) || null,
      image_url: clean(body.image_url) || null,
      expiry_date: clean(body.expiry_date) || null,
      category: clean(body.category) || null,
      sub_category: clean(body.sub_category) || null,
      barcode_type: clean(body.barcode_type) || null,
      expiry_period_value: Math.max(0, Number(body.expiry_period_value) || 0),
      expiry_period_unit: clean(body.expiry_period_unit) || null,
      tax_name: clean(body.tax_name) || null,
      tax_percent: Math.max(0, Number(body.tax_percent) || 0),
      selling_price_tax_type: clean(body.selling_price_tax_type) || null,
      product_type: clean(body.product_type) || "single",
      variation_name: clean(body.variation_name) || null,
      variation_values: Array.isArray(body.variation_values) ? body.variation_values.map(clean).filter(Boolean) : [],
      variation_skus: Array.isArray(body.variation_skus) ? body.variation_skus.map(clean).filter(Boolean) : [],
      purchase_price_including_tax: Math.max(0, Number(body.purchase_price_including_tax) || 0),
      purchase_price_excluding_tax: Math.max(0, Number(body.purchase_price_excluding_tax) || 0),
      profit_margin: Math.max(0, Number(body.profit_margin) || 0),
      opening_stock_location: clean(body.opening_stock_location) || null,
      serial_tracking_enabled: Boolean(body.serial_tracking_enabled),
      weight: Math.max(0, Number(body.weight) || 0),
      rack: clean(body.rack) || null,
      shelf_row: clean(body.shelf_row) || null,
      position: clean(body.position) || null,
      product_description: clean(body.product_description) || clean(body.notes) || null,
      custom_field_1: clean(body.custom_field_1) || null,
      custom_field_2: clean(body.custom_field_2) || null,
      custom_field_3: clean(body.custom_field_3) || null,
      custom_field_4: clean(body.custom_field_4) || null,
      product_locations: Array.isArray(body.product_locations) ? body.product_locations.map(clean).filter(Boolean) : [],
      branch_id: clean(body.branch_id) || null,
      status: "active",
      created_by: scope.user?.id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const openingStock = Math.max(0, Number(body.opening_stock) || 0)
    if (openingStock > 0 && !scope.activeBranchId && !clean(body.branch_id) && !clean(body.opening_stock_branch_id)) {
      return NextResponse.json({ error: "اختر فرع المخزون الافتتاحي قبل إنشاء الصنف" }, { status: 400 })
    }

    const { data: item, error } = await db.from("pharmacy_items").insert(itemData).select("*").maybeSingle()
    if (error) throw error
    if (!item) return NextResponse.json({ error: "فشل إنشاء الصنف" }, { status: 500 })
    createdItemId = item.id as string

    const relationResult = await db.rpc("pharmacy_replace_item_relations", {
      p_pharmacy_id: pharmacyId,
      p_item_id: item.id,
      p_barcodes: normalizedRelations.barcodes,
      p_units: normalizedRelations.units,
      p_variants: null,
    })
    if (relationResult.error) {
      if (/function .* does not exist|schema cache/i.test(relationResult.error.message)) {
        if (normalizedRelations.barcodes.length > 0) {
          const { error: barcodeError } = await db.from("pharmacy_item_barcodes").insert(
            normalizedRelations.barcodes.map((row) => ({ ...row, pharmacy_id: pharmacyId, item_id: item.id })),
          )
          if (barcodeError) throw barcodeError
        }
        if (normalizedRelations.units.length > 0) {
          const { error: unitError } = await db.from("pharmacy_item_units").insert(
            normalizedRelations.units.map((row) => ({ ...row, pharmacy_id: pharmacyId, item_id: item.id })),
          )
          if (unitError) throw unitError
        }
      } else {
        throw relationResult.error
      }
    }

    const variationValues = Array.isArray(body.variation_values) ? body.variation_values.map(clean).filter(Boolean) : []
    const variationSkus = Array.isArray(body.variation_skus) ? body.variation_skus.map(clean).filter(Boolean) : []
    if ((clean(body.product_type) || "single") === "variable" && variationValues.length > 0) {
      const variantRows = variationValues.map((value, index) => ({
        pharmacy_id: pharmacyId,
        item_id: item.id,
        name: clean(body.variation_name) || "Variation",
        value,
        sku: variationSkus[index] || null,
        purchase_price: Math.max(0, Number(body.purchase_price_excluding_tax || body.buy_price) || 0),
        sell_price: Math.max(0, Number(body.sell_price) || 0),
        metadata: { source: "manual_item_form" },
      }))
      const { error: variantError } = await db.from("pharmacy_item_variants").insert(variantRows)
      if (variantError) throw variantError
    }

    if (openingStock > 0 && item.manage_inventory !== false) {
      await addOpeningStock(db, {
        pharmacyId,
        itemId: item.id,
        branchId: clean(body.opening_stock_branch_id) || clean(body.branch_id) || scope.activeBranchId,
        actorId: scope.user.id,
        quantity: openingStock,
        unitPrice: item.buy_price,
        unit: item.unit,
        batchNumber: clean(body.batch_number) || null,
        expiryDate: clean(body.expiry_date) || null,
        trackBatch: Boolean(item.track_batch),
        hasExpiry: Boolean(item.has_expiry),
      })
    }

    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    console.error("items POST failed", error)
    if (createdItemId && cleanupDb) {
      const { error: cleanupError } = await cleanupDb.from("pharmacy_items").update({ status: "deleted", deleted_at: new Date().toISOString(), delete_reason: "automatic rollback after failed item creation" }).eq("id", createdItemId)
      if (cleanupError) console.error("items POST cleanup failed", cleanupError)
    }
    const message = postgresErrorMessage(error, "فشل إنشاء الصنف")
    return NextResponse.json({ error: message }, { status: /مستخدم بالفعل|مكرر/.test(message) ? 409 : 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const itemId = String(body.item_id ?? "")
    const action = String(body.action ?? "")
    const requestedPharmacyId = body.pharmacy_id ? String(body.pharmacy_id) : null

    if (!itemId) return NextResponse.json({ error: "معرف الصنف مطلوب" }, { status: 400 })
    if (!["delete", "restore", "archive", "activate", "deactivate"].includes(action)) {
      return NextResponse.json({ error: "إجراء غير مدعوم" }, { status: 400 })
    }

    const scope = await getServerAuthScope({ requestedPharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    const permissionByAction = {
      delete: "inventory:delete",
      restore: "inventory:restore",
      archive: "inventory:archive",
      activate: "inventory:update",
      deactivate: "inventory:update",
    } as const
    if (!scopeCan(scope, permissionByAction[action as keyof typeof permissionByAction])) {
      return NextResponse.json({ error: "ليست لديك صلاحية تنفيذ هذا الإجراء على الأصناف" }, { status: 403 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const statusByAction: Record<string, string> = {
      delete: "deleted",
      restore: "active",
      archive: "archived",
      activate: "active",
      deactivate: "inactive",
    }

    const baseUpdate: Record<string, unknown> = {
      status: statusByAction[action],
      updated_at: new Date().toISOString(),
    }

    const richUpdate: Record<string, unknown> = {
      ...baseUpdate,
      ...(action === "delete"
        ? { deleted_at: new Date().toISOString(), deleted_by: scope.user.id, delete_reason: body.reason ?? null }
        : {}),
      ...(action === "restore" ? { deleted_at: null, deleted_by: null, delete_reason: null } : {}),
    }

    let result = await db
      .from("pharmacy_items")
      .update(richUpdate)
      .eq("pharmacy_id", pharmacyId)
      .eq("id", itemId)
      .select("*")
      .maybeSingle()

    if (result.error && /deleted_at|deleted_by|delete_reason/i.test(result.error.message)) {
      result = await db
        .from("pharmacy_items")
        .update(baseUpdate)
        .eq("pharmacy_id", pharmacyId)
        .eq("id", itemId)
        .select("*")
        .maybeSingle()
    }

    if (result.error) throw result.error
    if (!result.data) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    return NextResponse.json({ item: result.data })
  } catch (error) {
    console.error("items PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل الصنف"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
