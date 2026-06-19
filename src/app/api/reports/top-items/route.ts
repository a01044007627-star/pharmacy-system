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

    let lineQuery = db
      .from("pharmacy_sale_lines")
      .select(`
        item_id,
        item_name,
        quantity,
        unit_price,
        total_price,
        cost_price,
        sale:pharmacy_sales!inner(id, sale_date, branch_id, pharmacy_id, voided_at)
      `)
      .eq("sale.pharmacy_id", scope.activePharmacyId)
      .is("sale.voided_at", null)
      .gte("sale.sale_date", `${dateFrom}T00:00:00`)
      .lte("sale.sale_date", `${dateTo}T23:59:59.999`)

    if (branchId && branchId !== "all") lineQuery = lineQuery.eq("sale.branch_id", branchId)

    const { data: lines, error } = await lineQuery
    if (error) throw error

    const itemMap = new Map<string, { name: string; quantity: number; revenue: number; cost: number; count: number }>()
    for (const line of lines ?? []) {
      const itemId = String(line.item_id ?? "unknown")
      const itemName = String(line.item_name ?? "غير معروف")
      const qty = Number(line.quantity ?? 0)
      const revenue = Number(line.total_price ?? 0)
      const cost = Number(line.cost_price ?? 0) * qty
      const entry = itemMap.get(itemId) ?? { name: itemName, quantity: 0, revenue: 0, cost: 0, count: 0 }
      entry.quantity += qty
      entry.revenue += revenue
      entry.cost += cost
      entry.count++
      itemMap.set(itemId, entry)
    }

    const items = Array.from(itemMap.entries())
      .map(([id, data]) => ({
        item_id: id,
        item_name: data.name,
        quantity_sold: data.quantity,
        total_revenue: data.revenue,
        total_cost: data.cost,
        total_profit: data.revenue - data.cost,
        transaction_count: data.count,
        margin: data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, limit)
      .map((item, index) => ({ rank: index + 1, ...item }))

    return NextResponse.json({
      items,
      total_items: items.length,
      date_from: dateFrom,
      date_to: dateTo,
    })
  } catch (error) {
    console.error("reports/top-items GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تقرير أفضل الأصناف"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
