import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

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

async function resolveBranchId(scope: Awaited<ReturnType<typeof getServerAuthScope>>, requestedBranchId: string | null) {
  let branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null
  if (branchId) assertBranchScope(scope, branchId)
  if (!branchId && isBranchScoped(scope)) {
    branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
  }
  return branchId
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = await resolveBranchId(scope, url.searchParams.get("branch_id"))

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize

    let query = db
      .from("pharmacy_purchases")
      .select("id,purchase_number,supplier_name,total,shipping_fee,purchase_date,status,branch:pharmacy_branches(name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .gt("shipping_fee", 0)
      .is("voided_at", null)
      .order("purchase_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)

    const { data, error, count } = await query
    if (error) throw error

    const rows = data ?? []
    const summary = rows.reduce((acc, row) => ({
      total_shipping: acc.total_shipping + Number(row.shipping_fee ?? 0),
      total_purchases: acc.total_purchases + Number(row.total ?? 0),
    }), { total_shipping: 0, total_purchases: 0 })

    return NextResponse.json({
      shipping: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("purchase shipping GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تكاليف الشحن"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
