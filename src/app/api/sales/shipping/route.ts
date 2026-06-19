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

function resolveBranchId(scope: Awaited<ReturnType<typeof getServerAuthScope>>, requested: string | null) {
  let branchId = requested && requested !== "all" ? requested : null
  if (branchId) assertBranchScope(scope, branchId)
  if (!branchId && isBranchScoped(scope)) {
    branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
  }
  return branchId
}

const SHIPPING_STATUSES = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "returned"] as const

function shippingStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    preparing: "قيد التحضير",
    shipped: "تم الشحن",
    delivered: "تم التوصيل",
    cancelled: "ملغي",
    returned: "مرتجع",
  }
  return labels[value] ?? value
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض الشحن" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = resolveBranchId(scope, url.searchParams.get("branch_id"))
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = safeSearch(clean(url.searchParams.get("query")))
    const status = clean(url.searchParams.get("status"))

    let ordersQuery = db
      .from("pharmacy_orders")
      .select("id,pharmacy_id,branch_id,order_number,customer_id,customer_name,shipping_address_id,shipping_fee,status,created_at,updated_at,branch:pharmacy_branches(id,name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId) ordersQuery = ordersQuery.eq("branch_id", branchId)
    if (query) ordersQuery = ordersQuery.or(`order_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
    if (status && status !== "all") ordersQuery = ordersQuery.eq("status", status)

    const { data, error, count } = await ordersQuery
    if (error) throw error

    const orderIds = (data ?? []).map((order) => order.id)
    let totals: Array<{ order_id: string; _total: number }> = []
    if (orderIds.length > 0) {
      const { data: linesData } = await db
        .from("pharmacy_order_lines")
        .select("order_id,net_total")
        .in("order_id", orderIds)
      totals = (linesData ?? []).reduce<Array<{ order_id: string; _total: number }>>((acc, line) => {
        const existing = acc.find((a) => a.order_id === line.order_id)
        if (existing) existing._total += Number(line.net_total ?? 0)
        else acc.push({ order_id: line.order_id, _total: Number(line.net_total ?? 0) })
        return acc
      }, [])
    }

    const totalMap = new Map(totals.map((t) => [t.order_id, t._total]))
    const orders = (data ?? []).map((order) => ({
      ...order,
      total: Number(order.shipping_fee ?? 0) + (totalMap.get(order.id) ?? 0),
      line_total: totalMap.get(order.id) ?? 0,
    }))

    return NextResponse.json({
      orders,
      statuses: SHIPPING_STATUSES.map((s) => ({ value: s, label: shippingStatusLabel(s) })),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("shipping GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل طلبات الشحن"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: clean(body.branch_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تحديث حالة الشحن" }, { status: 403 })

    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: "معرف الطلب مطلوب" }, { status: 400 })
    const newStatus = clean(body.status)
    if (!newStatus || !SHIPPING_STATUSES.includes(newStatus as typeof SHIPPING_STATUSES[number])) {
      return NextResponse.json({ error: "حالة غير صالحة" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing } = await db
      .from("pharmacy_orders")
      .select("id,branch_id,status")
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 })
    assertBranchScope(scope, existing.branch_id)

    const { data, error } = await db
      .from("pharmacy_orders")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select("id,order_number,status")
      .maybeSingle()
    if (error) throw error

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("shipping PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث حالة الطلب"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
