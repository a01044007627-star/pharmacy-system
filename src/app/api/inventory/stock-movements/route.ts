import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
      requestedBranchId: clean(url.searchParams.get("branch_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    let branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if (!branchId || branchId === "all") {
      if (isBranchScoped(scope)) {
        branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? ""
      } else { branchId = "" }
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 50, 10, 200)
    const offset = (page - 1) * pageSize
    const movementType = clean(url.searchParams.get("movement_type"))
    const direction = clean(url.searchParams.get("direction"))
    const itemId = clean(url.searchParams.get("item_id"))
    const sourceTable = clean(url.searchParams.get("source_table"))
    const dateFrom = clean(url.searchParams.get("date_from"))
    const dateTo = clean(url.searchParams.get("date_to"))
    const search = safeSearch(clean(url.searchParams.get("query")))

    const supabase = await createClient()
    const db = getDbClient() ?? supabase

    let itemIdsFromSearch: string[] = []
    if (search) {
      const { data, error } = await db
        .from("pharmacy_items")
        .select("id")
        .eq("pharmacy_id", scope.activePharmacyId)
        .or(`name_ar.ilike.%${search}%,name_en.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`)
        .limit(200)
      if (error) throw error
      itemIdsFromSearch = (data ?? []).map((row) => row.id).filter(Boolean)
      if (itemIdsFromSearch.length === 0) {
        return NextResponse.json({
          records: [],
          summary: { total_movements: 0, total_in: 0, total_out: 0, net_quantity: 0, total_value_in: 0, total_value_out: 0 },
          pagination: { page, pageSize, total: 0, totalPages: 1 },
        })
      }
    }

    // Supabase's recursive query-builder generic becomes excessively deep
    // when the same filter pipeline is reused for data and summary selects.
    // Keep the boundary local and return the original builder shape.
    const applyFilters = (query: any) => {
      let next = query.eq("pharmacy_id", scope.activePharmacyId)
      if (branchId) next = next.eq("branch_id", branchId)
      if (movementType) next = next.eq("movement_type", movementType)
      if (direction) next = next.eq("direction", direction)
      if (itemId) next = next.eq("item_id", itemId)
      if (itemIdsFromSearch.length) next = next.in("item_id", itemIdsFromSearch)
      if (sourceTable) next = next.eq("source_table", sourceTable)
      if (dateFrom) next = next.gte("created_at", `${dateFrom}T00:00:00`)
      if (dateTo) next = next.lte("created_at", `${dateTo}T23:59:59.999`)
      return next
    }

    const dbQuery = applyFilters(db
      .from("pharmacy_stock_movements")
      .select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)", { count: "exact" }))
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    const summaryQuery = applyFilters(db
      .from("pharmacy_stock_movements")
      .select("direction,quantity,total_value"))
      .limit(10000)

    const [{ data, error, count }, summaryResult] = await Promise.all([dbQuery, summaryQuery])
    if (error) throw error
    if (summaryResult.error) throw summaryResult.error

    const summaryRows = (summaryResult.data ?? []) as Array<{ direction: string; quantity: number | null; total_value: number | null }>
    const totalIn = summaryRows.filter((row) => row.direction === "in").reduce((sum: number, row) => sum + Number(row.quantity ?? 0), 0)
    const totalOut = summaryRows.filter((row) => row.direction === "out").reduce((sum: number, row) => sum + Number(row.quantity ?? 0), 0)

    return NextResponse.json({
      records: data ?? [],
      summary: {
        total_movements: count ?? 0,
        total_in: totalIn,
        total_out: totalOut,
        net_quantity: totalIn - totalOut,
        total_value_in: summaryRows.filter((row) => row.direction === "in").reduce((sum: number, row) => sum + Number(row.total_value ?? 0), 0),
        total_value_out: summaryRows.filter((row) => row.direction === "out").reduce((sum: number, row) => sum + Number(row.total_value ?? 0), 0),
      },
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    })
  } catch (error) {
    console.error("stock-movements GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل حركة المخزون" }, { status: 500 })
  }
}
