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

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const requestedPharmacyId = url.searchParams.get("pharmacy_id")
    const requestedBranchId = url.searchParams.get("branch_id")
    const scope = await getServerAuthScope({
      requestedPharmacyId,
      requestedBranchId: requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null,
    })

    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المبيعات" }, { status: 403 })

    let branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null
    if (branchId) assertBranchScope(scope, branchId)
    if (!branchId && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = safeSearch(clean(url.searchParams.get("query")))
    const paymentStatus = clean(url.searchParams.get("payment_status"))
    const paymentMethod = clean(url.searchParams.get("payment_method"))
    const dateFrom = clean(url.searchParams.get("date_from"))
    const dateTo = clean(url.searchParams.get("date_to"))

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    let salesQuery = db
      .from("pharmacy_sales")
      .select(
        "id, pharmacy_id, branch_id, invoice_number, customer_name, status, payment_status, payment_method, subtotal, discount_total, tax_total, total, paid_amount, due_amount, sale_date, created_by, voided_at, branch:pharmacy_branches(id,name,code)",
        { count: "exact" },
      )
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .order("sale_date", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId) salesQuery = salesQuery.eq("branch_id", branchId)
    if (query) salesQuery = salesQuery.or(`invoice_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
    if (paymentStatus && paymentStatus !== "all") salesQuery = salesQuery.eq("payment_status", paymentStatus)
    if (paymentMethod && paymentMethod !== "all") salesQuery = salesQuery.eq("payment_method", paymentMethod)
    if (dateFrom) salesQuery = salesQuery.gte("sale_date", `${dateFrom}T00:00:00`)
    if (dateTo) salesQuery = salesQuery.lt("sale_date", `${dateTo}T23:59:59.999`)

    const { data, error, count } = await salesQuery
    if (error) throw error

    const rows = data ?? []
    const summary = rows.reduce(
      (total, row) => ({
        total: total.total + Number(row.total ?? 0),
        paid: total.paid + Number(row.paid_amount ?? 0),
        due: total.due + Number(row.due_amount ?? 0),
      }),
      { total: 0, paid: 0, due: 0 },
    )

    return NextResponse.json({
      sales: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: {
        page,
        pageSize,
        total: count ?? rows.length,
        totalPages: Math.max(1, Math.ceil((count ?? rows.length) / pageSize)),
      },
      branchId,
      pharmacyId: scope.activePharmacyId,
    })
  } catch (error) {
    console.error("sales GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المبيعات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
