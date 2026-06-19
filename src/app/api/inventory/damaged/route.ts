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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
      requestedBranchId: clean(url.searchParams.get("branch_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    let branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if (!branchId || branchId === "all") {
      if (isBranchScoped(scope)) {
        branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? ""
      } else { branchId = "" }
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 200, 10, 500)
    const offset = (page - 1) * pageSize

    const supabase = await createClient()
    const db = getDbClient() ?? supabase

    let query = db
      .from("pharmacy_damaged_stock")
      .select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
    if (branchId) query = query.eq("branch_id", branchId)
    query = query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1)

    const { data, error, count } = await query
    if (error) throw error

    const total = count ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return NextResponse.json({
      records: data ?? [],
      pagination: { page, pageSize, total, totalPages },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل التوالف" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: clean(body.branch_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const itemId = clean(body.item_id)
    if (!itemId) return NextResponse.json({ error: "اختر الصنف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId
    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (branchId) assertBranchScope(scope, branchId)
    const now = new Date().toISOString()

    const { data, error } = await db.from("pharmacy_damaged_stock").insert({
      pharmacy_id: pharmacyId,
      branch_id: branchId,
      item_id: itemId,
      quantity: Math.max(0, Number(body.quantity) || 1),
      reason: clean(body.reason) || "تالف",
      notes: clean(body.notes) || null,
      recorded_by: scope.user.id,
      created_at: now,
      updated_at: now,
    }).select("*").maybeSingle()

    if (error) throw error
    return NextResponse.json({ record: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تسجيل التالف" }, { status: 400 })
  }
}
