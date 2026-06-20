import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

const SHIPPING_STATUSES = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "returned"] as const

function shippingStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    preparing: "قيد التحضير",
    shipped: "قيد التوصيل",
    delivered: "تم التوصيل",
    cancelled: "ملغي",
    returned: "مرتجع",
  }
  return labels[value] ?? value
}

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      anyPermissions: ["sales:read", "delivery:read"],
      forbiddenMessage: "ليست لديك صلاحية عرض طلبات التوصيل",
    })
    const { page, pageSize, offset } = context.pagination()
    const query = context.search()
    const status = context.text("status")

    let ordersQuery = context.db
      .from("pharmacy_orders")
      .select(
        "id,pharmacy_id,branch_id,order_number,customer_id,customer_name,shipping_address_id,shipping_fee,subtotal,discount_total,tax_total,total,paid_amount,due_amount,payment_method,payment_status,status,notes,created_at,updated_at",
        { count: "exact" },
      )
      .eq("pharmacy_id", context.pharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (context.branchId) ordersQuery = ordersQuery.eq("branch_id", context.branchId)
    if (query) ordersQuery = ordersQuery.or(`order_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
    if (status && status !== "all") ordersQuery = ordersQuery.eq("status", status)

    const { data, error, count } = await ordersQuery
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const withBranches = await relations.attachBranches(data ?? [])
    const withCustomers = await relations.attachCustomers(withBranches)
    const withAddresses = await relations.attachShippingAddresses(withCustomers)
    const orders = withAddresses.map((order) => ({
      ...order,
      customer_phone: order.shipping_address?.phone ?? order.customer?.phone ?? null,
      shipping_address_text: order.shipping_address?.address ?? order.customer?.address ?? null,
      shipping_status: order.status,
    }))

    return NextResponse.json({
      orders,
      statuses: SHIPPING_STATUSES.map((value) => ({ value, label: shippingStatusLabel(value) })),
      pagination: {
        page,
        pageSize,
        total: count ?? orders.length,
        totalPages: Math.max(1, Math.ceil((count ?? orders.length) / pageSize)),
      },
    })
  } catch (error) {
    return operationalErrorResponse(error, "shipping GET failed", "فشل تحميل طلبات التوصيل")
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
    const { data: existing, error: existingError } = await db
      .from("pharmacy_orders")
      .select("id,branch_id,status")
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 })
    if (existing.branch_id) assertBranchScope(scope, existing.branch_id)

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
    return operationalErrorResponse(error, "shipping PATCH failed", "فشل تحديث حالة الطلب", 400)
  }
}
