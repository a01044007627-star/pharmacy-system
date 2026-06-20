import { NextResponse } from "next/server"
import { unitPolicyService } from "@/domain/inventory/units/unit-policy"
import { Money } from "@/domain/shared/decimal-value"
import {
  isEnumValue,
  PurchaseOrderStatus,
  purchaseOrderWorkflow,
} from "@/domain/workflows/operational-workflows"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { ItemQuantityPolicyRepository } from "@/features/inventory/server/item-quantity-policy-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  [PurchaseOrderStatus.Draft]: "مسودة",
  [PurchaseOrderStatus.Sent]: "تم الإرسال",
  [PurchaseOrderStatus.Partial]: "مستلم جزئيًا",
  [PurchaseOrderStatus.Received]: "مستلم",
  [PurchaseOrderStatus.Cancelled]: "ملغي",
}

type PurchaseOrderLineInput = {
  item_id?: unknown
  item_name?: unknown
  unit?: unknown
  unit_code?: unknown
  quantity_mode?: unknown
  quantity_scale?: unknown
  quantity?: unknown
  buy_price?: unknown
  sell_price?: unknown
  unit_price?: unknown
  discount?: unknown
  notes?: unknown
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function createOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `PO-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

function normalizeLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("أضف صنفًا واحدًا على الأقل لأمر الشراء")
  const seenItems = new Set<string>()

  return value.map((raw, index) => {
    const line = (raw ?? {}) as PurchaseOrderLineInput
    const itemId = clean(line.item_id)
    const itemName = clean(line.item_name)
    const unit = clean(line.unit) || "وحدة"
    if (!itemId && !itemName) throw new Error(`بيانات الصنف في السطر ${index + 1} غير مكتملة`)
    const duplicateKey = itemId || itemName.toLocaleLowerCase("ar-EG")
    if (seenItems.has(duplicateKey)) throw new Error(`الصنف في السطر ${index + 1} مكرر داخل أمر الشراء`)
    seenItems.add(duplicateKey)

    const policy = unitPolicyService.policyFor({
      unit_name: unit,
      unit_code: line.unit_code,
      quantity_mode: line.quantity_mode,
      quantity_scale: line.quantity_scale,
    })
    const quantity = policy.assertValid(line.quantity, `كمية السطر ${index + 1}`)
    if (quantity <= 0) throw new Error(`كمية السطر ${index + 1} يجب أن تكون أكبر من صفر`)

    const buyPrice = Money.nonNegative((line.buy_price ?? line.unit_price) as number | string)
    const sellPrice = Money.nonNegative(line.sell_price as number | string)
    const gross = buyPrice.multiply(quantity)
    const discount = Money.nonNegative(line.discount as number | string).min(gross)
    const total = gross.subtract(discount).max(0)

    return {
      item_id: itemId || null,
      item_name: itemName || null,
      unit,
      unit_code: clean(line.unit_code) || null,
      quantity_mode: policy.mode,
      quantity_scale: policy.scale,
      quantity,
      buy_price: buyPrice.toNumber(),
      sell_price: sellPrice.toNumber(),
      discount: discount.toNumber(),
      total: total.toNumber(),
      notes: clean(line.notes) || null,
    }
  })
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
      .select("id,pharmacy_id,branch_id,order_number,supplier_id,supplier_name,expected_date,lines,status,total,paid_amount,due_amount,order_date,notes,created_at,updated_at", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .order("order_date", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (context.branchId) ordersQuery = ordersQuery.eq("branch_id", context.branchId)
    if (query) ordersQuery = ordersQuery.or(`order_number.ilike.%${query}%,supplier_name.ilike.%${query}%`)
    if (status && status !== "all") {
      if (!isEnumValue(PurchaseOrderStatus, status)) throw new Error("حالة أمر الشراء غير صالحة")
      ordersQuery = ordersQuery.eq("status", status)
    }

    const { data, error, count } = await ordersQuery
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const withBranches = await relations.attachBranches(data ?? [])
    const itemIds = Array.from(new Set(withBranches.flatMap((order) => (
      Array.isArray(order.lines)
        ? order.lines.map((line) => clean((line as Record<string, unknown>).item_id)).filter(Boolean)
        : []
    ))))
    const itemMetadata = new Map<string, { sell_price: number; track_batch: boolean; has_expiry: boolean }>()
    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await context.db
        .from("pharmacy_items")
        .select("id,sell_price,track_batch,has_expiry")
        .eq("pharmacy_id", context.pharmacyId)
        .in("id", itemIds)
      if (itemsError) throw itemsError
      for (const item of items ?? []) {
        itemMetadata.set(String(item.id), {
          sell_price: Money.nonNegative(item.sell_price).toNumber(),
          track_batch: item.track_batch === true,
          has_expiry: item.has_expiry === true,
        })
      }
    }
    const orders = withBranches.map((order) => ({
      ...order,
      lines: Array.isArray(order.lines) ? order.lines.map((rawLine) => {
        const line = rawLine as Record<string, unknown>
        const metadata = itemMetadata.get(clean(line.item_id))
        return {
          ...line,
          sell_price: Money.nonNegative((line.sell_price ?? metadata?.sell_price) as number).toNumber(),
          track_batch: metadata?.track_batch ?? false,
          has_expiry: metadata?.has_expiry ?? false,
        }
      }) : [],
      allowed_statuses: isEnumValue(PurchaseOrderStatus, order.status)
        ? purchaseOrderWorkflow.selectableFrom(order.status).filter((value) => (
          value === order.status || ![PurchaseOrderStatus.Partial, PurchaseOrderStatus.Received].includes(value)
        ))
        : [],
    }))

    return NextResponse.json({
      orders,
      statuses: purchaseOrderWorkflow.values().map((value) => ({ value, label: STATUS_LABELS[value] })),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "purchase orders GET failed", "فشل تحميل أوامر الشراء")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "purchases:write",
      forbiddenMessage: "ليست لديك صلاحية إنشاء أوامر الشراء",
    })
    const rawLines = Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []
    const quantityPolicies = new ItemQuantityPolicyRepository(context.db, context.pharmacyId)
    const policyLines = await quantityPolicies.normalizeTransactionLines(rawLines, { label: "كمية أمر الشراء" })
    const lines = normalizeLines(policyLines).map((line) => ({ ...line, received_quantity: 0 }))
    const total = lines.reduce((sum, line) => sum.add(line.total), Money.zero())
    const status = body.send_immediately === true ? PurchaseOrderStatus.Sent : PurchaseOrderStatus.Draft
    const branchId = clean(body.branch_id) || context.branchId

    const { data, error } = await context.db
      .from("pharmacy_purchase_orders")
      .insert({
        pharmacy_id: context.pharmacyId,
        branch_id: branchId,
        order_number: clean(body.order_number) || createOrderNumber(),
        supplier_id: clean(body.supplier_id) || null,
        supplier_name: clean(body.supplier_name) || "مورد غير محدد",
        expected_date: clean(body.expected_date) || null,
        lines,
        total: total.toNumber(),
        paid_amount: 0,
        due_amount: total.toNumber(),
        status,
        notes: clean(body.notes) || null,
        created_by: context.actorId,
        order_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id,pharmacy_id,branch_id,order_number,supplier_id,supplier_name,expected_date,lines,status,total,paid_amount,due_amount,order_date,notes,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error("تعذر إنشاء أمر الشراء")
    return NextResponse.json({ order: data }, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "purchase orders POST failed", "فشل إنشاء أمر الشراء", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "purchases:write",
      forbiddenMessage: "ليست لديك صلاحية تحديث أوامر الشراء",
    })
    const id = clean(body.id)
    if (!id) throw new Error("معرف أمر الشراء مطلوب")
    if (!isEnumValue(PurchaseOrderStatus, body.status)) throw new Error("حالة أمر الشراء غير صالحة")
    if ([PurchaseOrderStatus.Partial, PurchaseOrderStatus.Received].includes(body.status)) {
      throw new Error("حالات الاستلام تُحدّث تلقائيًا من عملية استلام أمر الشراء")
    }

    const { data: existing, error: existingError } = await context.db
      .from("pharmacy_purchase_orders")
      .select("id,branch_id,status")
      .eq("id", id)
      .eq("pharmacy_id", context.pharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "أمر الشراء غير موجود" }, { status: 404 })
    if (!isEnumValue(PurchaseOrderStatus, existing.status)) throw new Error("حالة أمر الشراء الحالية غير معروفة")

    const status = purchaseOrderWorkflow.assertTransition(existing.status, body.status)
    const { data, error } = await context.db
      .from("pharmacy_purchase_orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("pharmacy_id", context.pharmacyId)
      .select("id,order_number,status,updated_at")
      .maybeSingle()
    if (error) throw error

    return NextResponse.json({ order: data })
  } catch (error) {
    return operationalErrorResponse(error, "purchase orders PATCH failed", "فشل تحديث أمر الشراء", 400)
  }
}
