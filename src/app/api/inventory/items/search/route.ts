import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function safeLimit(value: unknown, fallback = 20) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(80, Math.max(1, parsed)) : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

type ItemRow = {
  id: string
  branch_id: string | null
  name_ar: string
  name_en: string | null
  sku: string | null
  unit: string | null
  sell_price: number | string | null
  buy_price: number | string | null
  manage_inventory: boolean | null
  min_stock: number | string | null
  status: string | null
}

type BarcodeRow = { item_id: string; barcode: string; is_primary: boolean | null }
type BalanceRow = { item_id: string; branch_id: string | null; quantity: number | string | null }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const requestedPharmacyId = clean(url.searchParams.get("pharmacy_id")) || null
    const requestedBranchId = clean(url.searchParams.get("branch_id")) || null
    const query = clean(url.searchParams.get("query"))
    const limit = safeLimit(url.searchParams.get("limit"), query ? 20 : 30)
    const includeInactive = url.searchParams.get("include_inactive") === "1"

    const scope = await getServerAuthScope({
      requestedPharmacyId,
      requestedBranchId: requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية قراءة الأصناف" }, { status: 403 })

    const branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : scope.activeBranchId
    assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const itemFields = "id,branch_id,name_ar,name_en,sku,unit,sell_price,buy_price,manage_inventory,min_stock,status"
    let itemQuery = db
      .from("pharmacy_items")
      .select(itemFields)
      .eq("pharmacy_id", pharmacyId)
      .neq("status", "deleted")
      .limit(limit)
      .order("updated_at", { ascending: false })

    if (!includeInactive) itemQuery = itemQuery.eq("status", "active")
    if (branchId) itemQuery = itemQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)
    if (query) {
      const q = safeSearch(query)
      itemQuery = itemQuery.or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%,sku.ilike.%${q}%,search_text.ilike.%${q}%`)
    }

    const { data: directItems, error: directError } = await itemQuery
    if (directError) throw directError

    const items = [...((directItems ?? []) as ItemRow[])]

    if (query) {
      const barcodeNeedle = query.replace(/[% ,().]/g, "")
      const { data: barcodeHits, error: barcodeHitError } = barcodeNeedle ? await db
        .from("pharmacy_item_barcodes")
        .select("item_id, barcode, is_primary")
        .eq("pharmacy_id", pharmacyId)
        .ilike("barcode", `%${barcodeNeedle}%`)
        .limit(limit) : { data: [], error: null }
      if (barcodeHitError) throw barcodeHitError

      const existing = new Set(items.map((item) => item.id))
      const itemIds = Array.from(new Set((barcodeHits ?? []).map((row: BarcodeRow) => row.item_id).filter(Boolean))).filter((id) => !existing.has(id))
      if (itemIds.length > 0) {
        let barcodeItemsQuery = db
          .from("pharmacy_items")
          .select(itemFields)
          .eq("pharmacy_id", pharmacyId)
          .neq("status", "deleted")
          .in("id", itemIds)
        if (!includeInactive) barcodeItemsQuery = barcodeItemsQuery.eq("status", "active")
        if (branchId) barcodeItemsQuery = barcodeItemsQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)
        const { data: barcodeItems, error: barcodeItemsError } = await barcodeItemsQuery
        if (barcodeItemsError) throw barcodeItemsError
        items.push(...((barcodeItems ?? []) as ItemRow[]))
      }
    }

    const limited = items.slice(0, limit)
    const ids = limited.map((item) => item.id)
    let balancesQuery = db
      .from("pharmacy_stock_balances")
      .select("item_id,branch_id,quantity")
      .eq("pharmacy_id", pharmacyId)
      .in("item_id", ids)
    if (branchId) balancesQuery = balancesQuery.eq("branch_id", branchId)

    const [barcodesResult, balancesResult] = ids.length > 0 ? await Promise.all([
      db.from("pharmacy_item_barcodes").select("item_id,barcode,is_primary").eq("pharmacy_id", pharmacyId).in("item_id", ids),
      balancesQuery,
    ]) : [{ data: [], error: null }, { data: [], error: null }]

    if (barcodesResult.error) throw barcodesResult.error
    if (balancesResult.error) throw balancesResult.error

    const barcodesByItem = new Map<string, BarcodeRow[]>()
    for (const row of (barcodesResult.data ?? []) as BarcodeRow[]) {
      const list = barcodesByItem.get(row.item_id) ?? []
      list.push(row)
      barcodesByItem.set(row.item_id, list)
    }

    const qtyByItem = new Map<string, number>()
    for (const row of (balancesResult.data ?? []) as BalanceRow[]) {
      if (branchId && row.branch_id !== branchId) continue
      qtyByItem.set(row.item_id, (qtyByItem.get(row.item_id) ?? 0) + Number(row.quantity ?? 0))
    }

    const records = limited.map((item) => {
      const itemBarcodes = barcodesByItem.get(item.id) ?? []
      return {
        id: item.id,
        branch_id: item.branch_id,
        name_ar: item.name_ar,
        name_en: item.name_en,
        sku: item.sku,
        unit: item.unit,
        sell_price: Number(item.sell_price ?? 0),
        buy_price: Number(item.buy_price ?? 0),
        manage_inventory: item.manage_inventory !== false,
        min_stock: Number(item.min_stock ?? 0),
        status: item.status,
        available_qty: qtyByItem.get(item.id) ?? 0,
        barcode: itemBarcodes.find((row) => row.is_primary)?.barcode ?? itemBarcodes[0]?.barcode ?? item.sku ?? "",
        barcodes: itemBarcodes,
      }
    })

    return NextResponse.json({ records, branch_id: branchId ?? null, pharmacy_id: pharmacyId })
  } catch (error) {
    console.error("inventory/items/search GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل البحث في الأصناف" }, { status: 500 })
  }
}
