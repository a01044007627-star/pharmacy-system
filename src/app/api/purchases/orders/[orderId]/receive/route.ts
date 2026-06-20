import { NextResponse } from "next/server"
import { Money } from "@/domain/shared/decimal-value"
import { ItemQuantityPolicyRepository } from "@/features/inventory/server/item-quantity-policy-repository"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

type Context = { params: Promise<{ orderId: string }> }

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

export async function POST(request: Request, context: Context) {
  try {
    const { orderId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "purchases:write",
      forbiddenMessage: "ليست لديك صلاحية استلام أوامر الشراء",
    })
    const rawLines = Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []
    const quantityPolicies = new ItemQuantityPolicyRepository(tenant.db, tenant.pharmacyId)
    const normalizedLines = await quantityPolicies.normalizeTransactionLines(rawLines, { label: "كمية الاستلام" })
    const itemIds = Array.from(new Set(normalizedLines.map((line) => clean(line.item_id)).filter(Boolean)))
    const { data: currentItems, error: itemsError } = await tenant.db
      .from("pharmacy_items")
      .select("id,sell_price")
      .eq("pharmacy_id", tenant.pharmacyId)
      .in("id", itemIds)
    if (itemsError) throw itemsError
    const sellPrices = new Map((currentItems ?? []).map((item) => [String(item.id), Money.nonNegative(item.sell_price).toNumber()]))
    const lines = normalizedLines.map((line) => {
      const requestedSellPrice = Money.nonNegative(line.sell_price as number).toNumber()
      return {
        ...line,
        sell_price: requestedSellPrice > 0 ? requestedSellPrice : (sellPrices.get(clean(line.item_id)) ?? 0),
      }
    })
    const clientRequestId = clean(body.client_request_id) || crypto.randomUUID()

    const { data, error } = await tenant.db.rpc("receive_purchase_order_complete_v1", {
      p_pharmacy_id: tenant.pharmacyId,
      p_order_id: orderId,
      p_actor_id: tenant.actorId,
      p_client_request_id: clientRequestId,
      p_paid_amount: Money.nonNegative(body.paid_amount as number).toNumber(),
      p_payment_method: clean(body.payment_method) || "cash",
      p_header_discount: Money.nonNegative(body.header_discount as number).toNumber(),
      p_tax_total: Money.nonNegative(body.tax_total as number).toNumber(),
      p_shipping_fee: Money.nonNegative(body.shipping_fee as number).toNumber(),
      p_notes: clean(body.notes) || null,
      p_purchase_date: clean(body.purchase_date) || new Date().toISOString(),
      p_lines: lines,
    })
    if (error) throw error

    const result = (data ?? {}) as {
      order?: { id?: string; order_number?: string; status?: string }
      purchase_result?: { purchase?: { id?: string; purchase_number?: string; total?: number } }
      complete?: boolean
      duplicate?: boolean
    }
    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: result.duplicate
        ? "purchase_order.duplicate_receipt_ignored"
        : result.complete ? "purchase_order.received" : "purchase_order.partially_received",
      source: "purchases",
      description: result.duplicate
        ? "تم تجاهل إعادة إرسال طلب استلام منفذ مسبقًا"
        : result.complete ? "تم استلام أمر الشراء بالكامل" : "تم تسجيل استلام جزئي لأمر الشراء",
      metadata: {
        order_id: orderId,
        order_number: result.order?.order_number,
        purchase_id: result.purchase_result?.purchase?.id,
        purchase_number: result.purchase_result?.purchase?.purchase_number,
        lines_count: lines.length,
        client_request_id: clientRequestId,
      },
    })

    return NextResponse.json({ result }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return operationalErrorResponse(error, "purchase order receive failed", "فشل استلام أمر الشراء", 400)
  }
}
