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


const PURCHASE_ORDER_STATUSES = ["draft", "sent", "partial", "received", "cancelled"] as const

function purchaseOrderStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "مسودة",
    sent: "تم الإرسال",
    partial: "مستلم جزئيًا",
    received: "مستلم",
    cancelled: "ملغي",
  }
  return labels[value] ?? value
}

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "purchases:read",
      forbiddenMessage: "ليست لديك صلاحية عرض أوامر الشراء",
    })
    const { page, pageSize, offset } = context.pagination()
    const query = context.search()
    const status = context.text("status")

    let ordersQuery = context.db
      .from("pharmacy_purchase_orders")
      .select("id,pharmacy_id,branch_id,order_number,supplier_name,status,total,paid_amount,due_amount,order_date,notes,created_at", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .order("order_date", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (context.branchId) ordersQuery = ordersQuery.eq("branch_id", context.branchId)
    if (query) ordersQuery = ordersQuery.or(`order_number.ilike.%${query}%,supplier_name.ilike.%${query}%`)
    if (status && status !== "all") ordersQuery = ordersQuery.eq("status", status)

    const { data, error, count } = await ordersQuery
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const orders = await relations.attachBranches(data ?? [])

    return NextResponse.json({
      orders,
      statuses: PURCHASE_ORDER_STATUSES.map((value) => ({ value, label: purchaseOrderStatusLabel(value) })),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "purchase orders GET failed", "فشل تحميل أوامر الشراء")
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
    if (!scopeCan(scope, "purchases:write")) return NextResponse.json({ error: "ليست لديك صلاحية تحديث أوامر الشراء" }, { status: 403 })

    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: "معرف أمر الشراء مطلوب" }, { status: 400 })
    const newStatus = clean(body.status)
    if (!newStatus || !PURCHASE_ORDER_STATUSES.includes(newStatus as typeof PURCHASE_ORDER_STATUSES[number])) {
      return NextResponse.json({ error: "حالة غير صالحة" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing } = await db
      .from("pharmacy_purchase_orders")
      .select("id,branch_id,status")
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "أمر الشراء غير موجود" }, { status: 404 })
    assertBranchScope(scope, existing.branch_id)

    const { data, error } = await db
      .from("pharmacy_purchase_orders")
      .update({ status: newStatus })
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select("id,order_number,status")
      .maybeSingle()
    if (error) throw error

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("purchase orders PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث أمر الشراء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
