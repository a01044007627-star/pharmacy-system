import { Money, type DecimalInput } from "@/domain/shared/decimal-value"
import { DeliveryStatus, deliveryWorkflow, isEnumValue } from "@/domain/workflows/operational-workflows"

export type DeliveryLifecycleRecord = {
  status: unknown
  total?: DecimalInput
  due_amount?: DecimalInput
  payment_method?: unknown
  delivery_agent_name?: unknown
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key)
}

export class DeliveryLifecycleService {
  prepareUpdate(existing: DeliveryLifecycleRecord, input: Record<string, unknown>, now = new Date().toISOString()) {
    if (!isEnumValue(DeliveryStatus, existing.status)) throw new Error("حالة الطلب الحالية غير معروفة")
    if (!isEnumValue(DeliveryStatus, input.status)) throw new Error("حالة التوصيل غير صالحة")

    const status = deliveryWorkflow.assertTransition(existing.status, input.status)
    const agentName = hasOwn(input, "delivery_agent_name")
      ? clean(input.delivery_agent_name)
      : clean(existing.delivery_agent_name)
    const failureReason = clean(input.failure_reason)
    const due = Money.nonNegative(existing.due_amount)
    const collected = hasOwn(input, "collected_amount")
      ? Money.nonNegative(input.collected_amount as number)
      : Money.zero()

    if (status === DeliveryStatus.Shipped && !agentName) {
      throw new Error("حدد مندوب التوصيل قبل خروج الطلب")
    }
    if ([DeliveryStatus.Cancelled, DeliveryStatus.Returned].includes(status) && !failureReason) {
      throw new Error("سبب الإلغاء أو الارتجاع مطلوب")
    }
    if (collected.toNumber() > due.toNumber()) {
      throw new Error("المبلغ المحصل لا يمكن أن يتجاوز المبلغ المتبقي على الطلب")
    }

    const paymentMethod = clean(existing.payment_method).toLowerCase()
    const isCashOnDelivery = ["cash", "cod", "cash_on_delivery"].includes(paymentMethod)
    if (status === DeliveryStatus.Delivered && isCashOnDelivery && !due.isZero() && collected.toNumber() !== due.toNumber()) {
      throw new Error("يجب تسجيل كامل المبلغ المتبقي قبل تأكيد تسليم طلب الدفع عند الاستلام")
    }

    const updates: Record<string, unknown> = { status, updated_at: now }
    if (hasOwn(input, "assigned_employee_id")) updates.assigned_employee_id = clean(input.assigned_employee_id) || null
    if (hasOwn(input, "delivery_agent_name")) updates.delivery_agent_name = agentName || null
    if (hasOwn(input, "collected_amount")) updates.collected_amount = collected.toNumber()
    if (hasOwn(input, "delivery_notes")) updates.delivery_notes = clean(input.delivery_notes) || null
    if (hasOwn(input, "failure_reason")) updates.failure_reason = failureReason || null
    if (hasOwn(input, "proof_of_delivery_url")) updates.proof_of_delivery_url = clean(input.proof_of_delivery_url) || null

    if (status === DeliveryStatus.Shipped) updates.dispatched_at = now
    if (status === DeliveryStatus.Delivered) updates.delivered_at = now
    if (status === DeliveryStatus.Returned) updates.returned_at = now
    if (status === DeliveryStatus.Cancelled) updates.cancelled_at = now

    return updates
  }
}

export const deliveryLifecycleService = new DeliveryLifecycleService()
