import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function n(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

async function searchItemIds(db: SupabaseClient, pharmacyId: string, query: string) {
  const q = safeSearch(query)
  if (!q) return [] as string[]

  const [itemsResult, barcodeResult] = await Promise.all([
    db
      .from("pharmacy_items")
      .select("id")
      .eq("pharmacy_id", pharmacyId)
      .neq("status", "deleted")
      .or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%,sku.ilike.%${q}%,search_text.ilike.%${q}%`)
      .limit(120),
    db
      .from("pharmacy_item_barcodes")
      .select("item_id")
      .eq("pharmacy_id", pharmacyId)
      .ilike("barcode", `%${query.replace(/[% ,().]/g, "")}%`)
      .limit(120),
  ])

  if (itemsResult.error) throw itemsResult.error
  if (barcodeResult.error) throw barcodeResult.error

  return Array.from(new Set([
    ...((itemsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id),
    ...((barcodeResult.data ?? []) as Array<{ item_id: string }>).map((row) => row.item_id),
  ].filter(Boolean)))
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
      requestedBranchId: clean(url.searchParams.get("branch_id")) && clean(url.searchParams.get("branch_id")) !== "all" ? clean(url.searchParams.get("branch_id")) : null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    let branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if (!branchId || branchId === "all") {
      branchId = isBranchScoped(scope)
        ? scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? ""
        : ""
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = clean(url.searchParams.get("query"))
    const status = clean(url.searchParams.get("status"))

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const itemIds = query ? await searchItemIds(db, pharmacyId, query) : []

    if (query && itemIds.length === 0) {
      return NextResponse.json({
        records: [],
        summary: { total_count: 0, total_expected: 0, total_counted: 0, total_variance: 0 },
        pagination: { page, pageSize, total: 0, totalPages: 1 },
      })
    }

    let dbQuery = db
      .from("pharmacy_stock_counts")
      .select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)", { count: "exact" })
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId) dbQuery = dbQuery.eq("branch_id", branchId)
    if (status && status !== "all") dbQuery = dbQuery.eq("status", status)
    if (itemIds.length > 0) dbQuery = dbQuery.in("item_id", itemIds)

    const { data, error, count } = await dbQuery
    if (error) throw error

    const rows = data ?? []
    const summary = rows.reduce(
      (acc, row) => ({
        total_count: acc.total_count + 1,
        total_expected: acc.total_expected + Number(row.expected_qty ?? 0),
        total_counted: acc.total_counted + Number(row.counted_qty ?? 0),
        total_variance: acc.total_variance + Number(row.variance ?? 0),
      }),
      { total_count: 0, total_expected: 0, total_counted: 0, total_variance: 0 },
    )

    return NextResponse.json({
      records: rows,
      summary,
      pagination: {
        page,
        pageSize,
        total: count ?? rows.length,
        totalPages: Math.max(1, Math.ceil((count ?? rows.length) / pageSize)),
      },
    })
  } catch (error) {
    console.error("stock-counts GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الجرد" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const branchId = clean(body.branch_id)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: branchId || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:stocktake")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const itemId = clean(body.item_id)
    if (!itemId) return NextResponse.json({ error: "اختر الصنف" }, { status: 400 })
    const effectiveBranchId = branchId || scope.activeBranchId
    if (!effectiveBranchId) return NextResponse.json({ error: "اختر الفرع قبل تسجيل الجرد" }, { status: 400 })
    assertBranchScope(scope, effectiveBranchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()

    const { data: item, error: itemError } = await db
      .from("pharmacy_items")
      .select("id,name_ar,unit")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", itemId)
      .neq("status", "deleted")
      .maybeSingle()
    if (itemError) throw itemError
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    let expectedQty = n(body.expected_qty, NaN)
    if (!Number.isFinite(expectedQty) || body.auto_expected === true) {
      const { data: balance, error: balanceError } = await db
        .from("pharmacy_stock_balances")
        .select("quantity")
        .eq("pharmacy_id", pharmacyId)
        .eq("branch_id", effectiveBranchId)
        .eq("item_id", itemId)
        .maybeSingle()
      if (balanceError) throw balanceError
      expectedQty = Number(balance?.quantity ?? 0)
    }

    const countedQty = Math.max(0, n(body.counted_qty, 0))
    const variance = countedQty - expectedQty

    const { data, error } = await db.from("pharmacy_stock_counts").insert({
      pharmacy_id: pharmacyId,
      branch_id: effectiveBranchId,
      item_id: itemId,
      expected_qty: expectedQty,
      counted_qty: countedQty,
      variance,
      unit: clean(body.unit) || item.unit || null,
      notes: clean(body.notes) || null,
      status: variance === 0 ? "matched" : "variance",
      created_by: scope.user.id,
      created_at: now,
      updated_at: now,
    }).select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)").maybeSingle()

    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId,
      branchId: effectiveBranchId,
      actorId: scope.user.id,
      eventType: "stock_count.created",
      source: "inventory",
      description: "تم تسجيل جرد مخزون",
      metadata: { count_id: data?.id, item_id: itemId, expected_qty: expectedQty, counted_qty: countedQty, variance },
    })
    return NextResponse.json({ record: data }, { status: 201 })
  } catch (error) {
    console.error("stock-counts POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تسجيل الجرد" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== "approve") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })

    const countId = clean(body.count_id)
    if (!countId) return NextResponse.json({ error: "معرف الجرد مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:stocktake")) return NextResponse.json({ error: "ليست لديك صلاحية اعتماد الجرد" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const { data: existing, error: existingError } = await db
      .from("pharmacy_stock_counts")
      .select("id,branch_id,item_id,status")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", countId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "سجل الجرد غير موجود" }, { status: 404 })
    assertBranchScope(scope, String(existing.branch_id ?? ""))

    const { data, error } = await db.rpc("approve_stock_count_variance", {
      p_pharmacy_id: pharmacyId,
      p_count_id: countId,
      p_actor_id: scope.user.id,
      p_notes: clean(body.notes) || null,
    })
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId,
      branchId: String(existing.branch_id ?? ""),
      actorId: scope.user.id,
      eventType: "stock_count.approved",
      source: "inventory",
      description: "تم اعتماد جرد وتسوية المخزون",
      metadata: { count_id: countId, item_id: existing.item_id, result: data },
    })
    return NextResponse.json(data ?? { ok: true })
  } catch (error) {
    console.error("stock-counts PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل اعتماد الجرد" }, { status: 400 })
  }
}
