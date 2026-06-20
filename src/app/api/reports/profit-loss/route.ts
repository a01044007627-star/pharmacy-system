import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) { return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }
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
    const db = getDbClient(await createClient()) as SupabaseClient
    const [summaryResult, dailyResult] = await Promise.all([
      db.rpc("get_profit_loss_summary", { p_pharmacy_id: scope.activePharmacyId, p_from_date: dateFrom, p_to_date: dateTo, p_branch_id: branchId }),
      db.rpc("get_daily_sales_summary", { p_pharmacy_id: scope.activePharmacyId, p_from_date: dateFrom, p_to_date: dateTo, p_branch_id: branchId }),
    ])
    if (summaryResult.error) throw summaryResult.error
    if (dailyResult.error) throw dailyResult.error
    const row = ((summaryResult.data ?? []) as Array<Record<string, unknown>>)[0] ?? {}
    const totalRevenue = Number(row.total_revenue ?? 0); const totalCost = Number(row.total_cost ?? 0); const totalExpenses = Number(row.total_expenses ?? 0)
    const daily = ((dailyResult.data ?? []) as Array<Record<string, unknown>>).map((d) => ({ date: d.sale_date, sales_total: Number(d.total_sales ?? 0), sales_profit: Number(d.total_profit ?? 0), purchases_total: 0, expenses_total: 0, net_profit: Number(d.total_profit ?? 0) }))
    return NextResponse.json({ summary: { total_sales: totalRevenue, gross_sales: totalRevenue, returns_total: 0, net_sales: totalRevenue, cost_of_goods: totalCost, gross_profit: Number(row.gross_profit ?? totalRevenue - totalCost), profit_margin: Number(row.gross_margin_percent ?? 0), total_expenses: totalExpenses, net_profit: Number(row.net_profit ?? totalRevenue - totalCost - totalExpenses), sales_count: Number(row.invoice_count ?? 0), returns_count: 0, total_purchases: 0, purchases_count: 0, expenses_count: 0, total_discounts: Number(row.total_discounts ?? 0) }, daily_summary: daily, summary_totals: { sales_total: totalRevenue, sales_profit: Number(row.gross_profit ?? 0), purchases_total: 0, expenses_total: totalExpenses, net_profit: Number(row.net_profit ?? 0) }, date_from: dateFrom, date_to: dateTo })
  } catch (error) {
    console.error("reports/profit-loss GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل تقرير الأرباح والخسائر" }, { status: 500 })
  }
}
