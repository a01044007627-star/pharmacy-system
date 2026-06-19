import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "reports:read"))
      return NextResponse.json({ error: "ليست لديك صلاحية عرض التقارير" }, { status: 403 })

    const dateFrom = clean(url.searchParams.get("date_from")) || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10)
    const dateTo = clean(url.searchParams.get("date_to")) || new Date().toISOString().slice(0, 10)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const [salesResult, purchasesResult, expensesResult, summaryResult] = await Promise.all([
      db
        .from("pharmacy_sales")
        .select("id, total, sale_date, subtotal, discount_total, tax_total, created_by")
        .eq("pharmacy_id", scope.activePharmacyId)
        .is("voided_at", null)
        .gte("sale_date", `${dateFrom}T00:00:00`)
        .lte("sale_date", `${dateTo}T23:59:59.999`),
      db
        .from("pharmacy_purchases")
        .select("id, total, purchase_date")
        .eq("pharmacy_id", scope.activePharmacyId)
        .is("voided_at", null)
        .gte("purchase_date", `${dateFrom}T00:00:00`)
        .lte("purchase_date", `${dateTo}T23:59:59.999`),
      db
        .from("pharmacy_expenses")
        .select("id, amount, expense_date")
        .eq("pharmacy_id", scope.activePharmacyId)
        .gte("expense_date", `${dateFrom}T00:00:00`)
        .lte("expense_date", `${dateTo}T23:59:59.999`),
      db
        .from("pharmacy_daily_summary")
        .select("sales_total, sales_profit, purchases_total, expenses_total, net_profit, summary_date")
        .eq("pharmacy_id", scope.activePharmacyId)
        .gte("summary_date", dateFrom)
        .lte("summary_date", dateTo),
    ])

    if (salesResult.error) throw salesResult.error
    if (purchasesResult.error) throw purchasesResult.error
    if (expensesResult.error) throw expensesResult.error
    if (summaryResult.error) throw summaryResult.error

    const sales = salesResult.data ?? []
    const purchases = purchasesResult.data ?? []
    const expenses = expensesResult.data ?? []
    const summaries = summaryResult.data ?? []

    const saleIds = sales.map((row) => row.id).filter(Boolean)
    const { data: saleLines, error: saleLinesError } = saleIds.length
      ? await db
          .from("pharmacy_sale_lines")
          .select("id,sale_id,item_id,quantity,purchase_price")
          .eq("pharmacy_id", scope.activePharmacyId)
          .in("sale_id", saleIds)
      : { data: [], error: null }
    if (saleLinesError) throw saleLinesError

    const { data: salesReturns, error: returnsError } = await db
      .from("pharmacy_sales_returns")
      .select("id,total,refund_amount,return_date")
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .gte("return_date", `${dateFrom}T00:00:00`)
      .lte("return_date", `${dateTo}T23:59:59.999`)
    if (returnsError) throw returnsError

    const returnIds = (salesReturns ?? []).map((row) => row.id).filter(Boolean)
    const { data: returnLines, error: returnLinesError } = returnIds.length
      ? await db
          .from("pharmacy_sales_return_lines")
          .select("return_id,sale_line_id,quantity")
          .eq("pharmacy_id", scope.activePharmacyId)
          .in("return_id", returnIds)
      : { data: [], error: null }
    if (returnLinesError) throw returnLinesError

    const saleLineById = new Map((saleLines ?? []).map((line) => [line.id, line]))
    const soldCost = (saleLines ?? []).reduce(
      (sum, line) => sum + Number(line.quantity ?? 0) * Number(line.purchase_price ?? 0),
      0,
    )
    const returnedCost = (returnLines ?? []).reduce((sum, line) => {
      const original = line.sale_line_id ? saleLineById.get(line.sale_line_id) : null
      return sum + Number(line.quantity ?? 0) * Number(original?.purchase_price ?? 0)
    }, 0)

    const totalSales = sales.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
    const totalReturns = (salesReturns ?? []).reduce((sum, row) => sum + Number(row.total ?? row.refund_amount ?? 0), 0)
    const netSales = Math.max(0, totalSales - totalReturns)
    const costOfGoods = Math.max(0, soldCost - returnedCost)
    const totalPurchases = purchases.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
    const totalExpenses = expenses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
    const grossProfit = netSales - costOfGoods
    const netProfit = grossProfit - totalExpenses

    const summaryTotals = summaries.reduce(
      (acc, row) => ({
        sales_total: acc.sales_total + Number(row.sales_total ?? 0),
        sales_profit: acc.sales_profit + Number(row.sales_profit ?? 0),
        purchases_total: acc.purchases_total + Number(row.purchases_total ?? 0),
        expenses_total: acc.expenses_total + Number(row.expenses_total ?? 0),
        net_profit: acc.net_profit + Number(row.net_profit ?? 0),
      }),
      { sales_total: 0, sales_profit: 0, purchases_total: 0, expenses_total: 0, net_profit: 0 },
    )

    const margin = netSales > 0 ? (grossProfit / netSales) * 100 : 0

    return NextResponse.json({
      summary: {
        total_sales: totalSales,
        total_purchases: totalPurchases,
        gross_sales: totalSales,
        returns_total: totalReturns,
        net_sales: netSales,
        cost_of_goods: costOfGoods,
        gross_profit: grossProfit,
        profit_margin: margin,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        sales_count: sales.length,
        returns_count: salesReturns?.length ?? 0,
        purchases_count: purchases.length,
        expenses_count: expenses.length,
      },
      daily_summary: summaries.map((row) => ({
        date: row.summary_date,
        sales_total: row.sales_total,
        sales_profit: row.sales_profit,
        purchases_total: row.purchases_total,
        expenses_total: row.expenses_total,
        net_profit: row.net_profit,
      })),
      summary_totals: summaryTotals,
      date_from: dateFrom,
      date_to: dateTo,
    })
  } catch (error) {
    console.error("reports/profit-loss GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تقرير الأرباح والخسائر"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
