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

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
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
    if (!scopeCan(scope, "reports:read") && !scopeCan(scope, "sales:read"))
      return NextResponse.json({ error: "ليست لديك صلاحية عرض التقارير" }, { status: 403 })

    let branchId = url.searchParams.get("branch_id")
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if ((!branchId || branchId === "all") && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    }

    const dateFrom = clean(url.searchParams.get("date_from")) || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10)
    const dateTo = clean(url.searchParams.get("date_to")) || new Date().toISOString().slice(0, 10)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    let salesQuery = db
      .from("pharmacy_sales")
      .select("id, total, paid_amount, due_amount, sale_date, branch_id")
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .gte("sale_date", `${dateFrom}T00:00:00`)
      .lte("sale_date", `${dateTo}T23:59:59.999`)
      .order("sale_date", { ascending: true })

    if (branchId && branchId !== "all") salesQuery = salesQuery.eq("branch_id", branchId)

    const { data: sales, error } = await salesQuery
    if (error) throw error

    const rows = sales ?? []
    const total = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
    const count = rows.length
    const paid = rows.reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0)

    const dailyMap = new Map<string, { count: number; total: number }>()
    for (const row of rows) {
      const day = (row.sale_date as string).slice(0, 10)
      const entry = dailyMap.get(day) ?? { count: 0, total: 0 }
      entry.count++
      entry.total += Number(row.total ?? 0)
      dailyMap.set(day, entry)
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, count: data.count, total: data.total }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      summary: {
        total_sales: total,
        sales_count: count,
        average_sale: count > 0 ? total / count : 0,
        paid_amount: paid,
        due_amount: total - paid,
      },
      daily,
      date_from: dateFrom,
      date_to: dateTo,
    })
  } catch (error) {
    console.error("reports/sales GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تقرير المبيعات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
