import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) { return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }
function safeNumber(value: unknown, fallback: number, min: number, max: number) { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback }
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
    const { data, error } = await db.rpc("get_customer_activity_summary", { p_pharmacy_id: scope.activePharmacyId, p_from_date: dateFrom, p_to_date: dateTo, p_branch_id: branchId })
    if (error) throw error
    const all = (data ?? []) as Array<Record<string, unknown>>
    const customers = all.slice(0, limit).map((row, index) => ({ rank: index + 1, customer_id: row.customer_id, customer_name: row.customer_name, customer_phone: row.customer_phone, total_sales: Number(row.total_spent ?? 0), transaction_count: Number(row.invoice_count ?? 0), total_paid: Number(row.total_paid ?? 0), total_due: Number(row.total_due ?? 0), total_discounts: Number(row.total_discounts ?? 0), last_visit_date: row.last_visit_date, average_invoice: Number(row.average_invoice ?? 0) }))
    return NextResponse.json({ customers, summary: { total_customers: all.length, total_sales: all.reduce((s, r) => s + Number(r.total_spent ?? 0), 0), total_transactions: all.reduce((s, r) => s + Number(r.invoice_count ?? 0), 0), total_due: all.reduce((s, r) => s + Number(r.total_due ?? 0), 0) }, date_from: dateFrom, date_to: dateTo })
  } catch (error) {
    console.error("reports/customer-activity GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل تقرير نشاط العملاء" }, { status: 500 })
  }
}
