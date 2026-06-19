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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "reports:read"))
      return NextResponse.json({ error: "ليست لديك صلاحية عرض التقارير" }, { status: 403 })

    let branchId = url.searchParams.get("branch_id")
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if ((!branchId || branchId === "all") && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    }

    const dateFrom = clean(url.searchParams.get("date_from")) || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10)
    const dateTo = clean(url.searchParams.get("date_to")) || new Date().toISOString().slice(0, 10)
    const limit = safeNumber(url.searchParams.get("limit"), 20, 1, 100)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    let query = db
      .from("pharmacy_sales")
      .select("id, customer_name, customer_phone, total, paid_amount, due_amount, sale_date, branch_id")
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .gte("sale_date", `${dateFrom}T00:00:00`)
      .lte("sale_date", `${dateTo}T23:59:59.999`)

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId)

    const { data: sales, error } = await query
    if (error) throw error

    const customerMap = new Map<string, { name: string; phone: string; total: number; count: number; paid: number }>()
    for (const sale of sales ?? []) {
      const name = String(sale.customer_name ?? "عميل نقدي").trim()
      const phone = String(sale.customer_phone ?? "").trim()
      const key = name || "عميل نقدي"
      const entry = customerMap.get(key) ?? { name: key, phone, total: 0, count: 0, paid: 0 }
      entry.total += Number(sale.total ?? 0)
      entry.count++
      entry.paid += Number(sale.paid_amount ?? 0)
      customerMap.set(key, entry)
    }

    const customers = Array.from(customerMap.entries())
      .map(([_, data]) => ({
        customer_name: data.name,
        customer_phone: data.phone,
        total_sales: data.total,
        transaction_count: data.count,
        total_paid: data.paid,
        total_due: data.total - data.paid,
      }))
      .sort((a, b) => b.total_sales - a.total_sales)
      .slice(0, limit)
      .map((item, index) => ({ rank: index + 1, ...item }))

    const totalSales = customers.reduce((sum, c) => sum + c.total_sales, 0)
    const totalCount = customers.reduce((sum, c) => sum + c.transaction_count, 0)

    return NextResponse.json({
      customers,
      summary: { total_customers: customers.length, total_sales: totalSales, total_transactions: totalCount },
      date_from: dateFrom,
      date_to: dateTo,
    })
  } catch (error) {
    console.error("reports/customer-activity GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تقرير نشاط العملاء"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
