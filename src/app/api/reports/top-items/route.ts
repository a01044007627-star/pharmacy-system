import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }
function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value)); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "reports:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض التقارير" }, { status: 403 })
    let branchId = clean(url.searchParams.get("branch_id")) || null
    if (branchId === "all") branchId = null
    if (branchId) assertBranchScope(scope, branchId)
    if (!branchId && isBranchScoped(scope)) branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    const dateFrom = clean(url.searchParams.get("date_from")) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const dateTo = clean(url.searchParams.get("date_to")) || new Date().toISOString().slice(0, 10)
    const limit = safeNumber(url.searchParams.get("limit"), 20, 1, 100)
    const db = getDbClient(await createClient()) as SupabaseClient
    const { data, error } = await db.rpc("get_top_selling_items", { p_pharmacy_id: scope.activePharmacyId, p_from_date: dateFrom, p_to_date: dateTo, p_limit: limit, p_branch_id: branchId })
    if (error) throw error
    const items = ((data ?? []) as Array<Record<string, unknown>>).map((row, index) => {
      const revenue = Number(row.total_sales ?? 0); const cost = Number(row.total_cost ?? 0)
      return { rank: index + 1, item_id: row.item_id, item_name: row.item_name, sku: row.sku, quantity_sold: Number(row.total_quantity ?? 0), total_revenue: revenue, total_cost: cost, total_profit: Number(row.total_profit ?? revenue - cost), transaction_count: Number(row.sale_count ?? 0), margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0 }
    })
    return NextResponse.json({ items, total_items: items.length, date_from: dateFrom, date_to: dateTo })
  } catch (error) {
    console.error("reports/top-items GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل تقرير أفضل الأصناف" }, { status: 500 })
  }
}
