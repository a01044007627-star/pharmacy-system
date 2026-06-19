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

    const [salesResult, taxGroupsResult] = await Promise.all([
      db
        .from("pharmacy_sales")
        .select("id, total, subtotal, tax_total, discount_total, sale_date")
        .eq("pharmacy_id", scope.activePharmacyId)
        .is("voided_at", null)
        .gte("sale_date", `${dateFrom}T00:00:00`)
        .lte("sale_date", `${dateTo}T23:59:59.999`),
      db
        .from("pharmacy_tax_groups")
        .select("id, name, rate, is_active")
        .eq("pharmacy_id", scope.activePharmacyId),
    ])

    if (salesResult.error) throw salesResult.error
    if (taxGroupsResult.error) throw taxGroupsResult.error

    const sales = salesResult.data ?? []
    const taxGroups = taxGroupsResult.data ?? []

    const totalTaxCollected = sales.reduce((sum, row) => sum + Number(row.tax_total ?? 0), 0)
    const totalSalesAmount = sales.reduce((sum, row) => sum + Number(row.subtotal ?? 0), 0)
    const totalDiscount = sales.reduce((sum, row) => sum + Number(row.discount_total ?? 0), 0)

    const taxRates = taxGroups.map((group) => ({
      tax_group_id: group.id,
      tax_name: group.name,
      tax_rate: Number(group.rate ?? 0),
      is_active: group.is_active,
      estimated_tax: totalSalesAmount * (Number(group.rate ?? 0) / 100),
    }))

    return NextResponse.json({
      summary: {
        total_sales_count: sales.length,
        total_sales_amount: totalSalesAmount,
        total_discount: totalDiscount,
        total_tax_collected: totalTaxCollected,
        effective_tax_rate: totalSalesAmount > 0 ? (totalTaxCollected / totalSalesAmount) * 100 : 0,
      },
      tax_rates: taxRates,
      date_from: dateFrom,
      date_to: dateTo,
    })
  } catch (error) {
    console.error("reports/tax-summary GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل تقرير الضرائب"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
