import { NextResponse } from "next/server"
import {
  DeliveryStatus,
  deliveryWorkflow,
  isEnumValue,
} from "@/domain/workflows/operational-workflows"
import { deliveryLifecycleService } from "@/domain/delivery/delivery-lifecycle-service"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  [DeliveryStatus.Pending]: "قيد الانتظار",
  [DeliveryStatus.Confirmed]: "مؤكد",
  [DeliveryStatus.Preparing]: "قيد التحضير",
  [DeliveryStatus.Shipped]: "قيد التوصيل",
  [DeliveryStatus.Delivered]: "تم التوصيل",
  [DeliveryStatus.Cancelled]: "ملغي",
  [DeliveryStatus.Returned]: "مرتجع",
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function isMissingDeliveryColumn(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "")
  return /assigned_employee_id|delivery_agent_name|dispatched_at|delivered_at|returned_at|cancelled_at|delivery_notes|failure_reason|proof_of_delivery_url|collected_amount|schema cache|column .* does not exist/i.test(message)
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
        "id,pharmacy_id,branch_id,order_number,customer_id,customer_name,shipping_address_id,shipping_fee,subtotal,discount_total,tax_total,total,paid_amount,due_amount,payment_method,payment_status,status,notes,assigned_employee_id,delivery_agent_name,dispatched_at,delivered_at,returned_at,cancelled_at,delivery_notes,failure_reason,proof_of_delivery_url,collected_amount,created_at,updated_at",
        { count: "exact" },
      )
      .eq("pharmacy_id", context.pharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (context.branchId) ordersQuery = ordersQuery.eq("branch_id", context.branchId)
    if (query) ordersQuery = ordersQuery.or(`order_number.ilike.%${query}%,customer_name.ilike.%${query}%,delivery_agent_name.ilike.%${query}%`)
    if (status && status !== "all") {
      if (!isEnumValue(DeliveryStatus, status)) throw new Error("حالة التوصيل غير صالحة")
      ordersQuery = ordersQuery.eq("status", status)
    }

    let result: any = await ordersQuery
    if (result.error && isMissingDeliveryColumn(result.error)) {
      let legacyQuery = context.db
        .from("pharmacy_orders")
        .select(
          "id,pharmacy_id,branch_id,order_number,customer_id,customer_name,shipping_address_id,shipping_fee,subtotal,discount_total,tax_total,total,paid_amount,due_amount,payment_method,payment_status,status,notes,created_at,updated_at",
          { count: "exact" },
        )
        .eq("pharmacy_id", context.pharmacyId)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1)
      if (context.branchId) legacyQuery = legacyQuery.eq("branch_id", context.branchId)
      if (query) legacyQuery = legacyQuery.or(`order_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
      if (status && status !== "all") legacyQuery = legacyQuery.eq("status", status)
      result = await legacyQuery
    }
    if (result.error) throw result.error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const withBranches = await relations.attachBranches(result.data ?? []) as any
    const withCustomers = await relations.attachCustomers(withBranches) as any
    const withAddresses = await relations.attachShippingAddresses(withCustomers) as any
    const orders = withAddresses.map((order: any) => ({
      ...order,
      customer_phone: order.shipping_address?.phone ?? order.customer?.phone ?? null,
      shipping_address_text: order.shipping_address?.address ?? order.customer?.address ?? null,
      shipping_status: order.status,
      allowed_statuses: isEnumValue(DeliveryStatus, order.status)
        ? deliveryWorkflow.selectableFrom(order.status)
        : [],
    }))

    return NextResponse.json({
      orders,
      statuses: deliveryWorkflow.values().map((value) => ({ value, label: STATUS_LABELS[value] })),
      pagination: {
        page,
        pageSize,
        total: result.count ?? orders.length,
        totalPages: Math.max(1, Math.ceil((result.count ?? orders.length) / pageSize)),
      },
    })
  } catch (error) {
    return operationalErrorResponse(error, "shipping GET failed", "فشل تحميل طلبات التوصيل")
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      anyPermissions: ["sales:write", "delivery:write"],
      forbiddenMessage: "ليست لديك صلاحية تحديث حالة الشحن",
    })
    const id = clean(body.id)
    if (!id) throw new Error("معرف الطلب مطلوب")
    if (!isEnumValue(DeliveryStatus, body.status)) throw new Error("حالة التوصيل غير صالحة")

    const { data: existing, error: existingError } = await context.db
      .from("pharmacy_orders")
      .select("id,branch_id,status,total,paid_amount,due_amount,payment_method,delivery_agent_name")
      .eq("id", id)
      .eq("pharmacy_id", context.pharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 })
    const updates = deliveryLifecycleService.prepareUpdate(existing, body)
    const status = updates.status as DeliveryStatus

    let result: any = await context.db
      .from("pharmacy_orders")
      .update(updates)
      .eq("id", id)
      .eq("pharmacy_id", context.pharmacyId)
      .select("id,order_number,status,assigned_employee_id,delivery_agent_name,dispatched_at,delivered_at,returned_at,cancelled_at,delivery_notes,failure_reason,proof_of_delivery_url,collected_amount,updated_at")
      .maybeSingle()

    if (result.error && isMissingDeliveryColumn(result.error)) {
      result = await context.db
        .from("pharmacy_orders")
        .update({ status, updated_at: updates.updated_at })
        .eq("id", id)
        .eq("pharmacy_id", context.pharmacyId)
        .select("id,order_number,status,updated_at")
        .maybeSingle()
    }
    if (result.error) throw result.error

    return NextResponse.json({ order: result.data })
  } catch (error) {
    return operationalErrorResponse(error, "shipping PATCH failed", "فشل تحديث حالة الطلب", 400)
  }
}
