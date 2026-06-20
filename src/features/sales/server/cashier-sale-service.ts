import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { CashierStockAvailabilityError } from "@/features/sales/server/cashier-stock-repository"

export type CashierSaleRpcInput = {
  p_pharmacy_id: string
  p_branch_id: string
  p_shift_id: string
  p_actor_id: string
  p_client_request_id: string
  p_customer_name: string
  p_payment_method: string
  p_paid_amount: number
  p_invoice_discount: number
  p_tax_total: number
  p_shipping_fee: number
  p_rounding_adj: number
  p_notes: string | null
  p_coupon_code: string | null
  p_patient_name: string | null
  p_doctor_name: string | null
  p_prescription_number: string | null
  p_lines: Record<string, unknown>[]
  p_patient_id: string | null
  p_partner_id: string | null
}

export type CashierSaleResult = {
  sale?: Record<string, unknown>
  lines?: unknown[]
  duplicate?: boolean
  finalization?: Record<string, unknown>
  compatibilityMode?: boolean
  warning?: string
}

type RpcError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export class CashierDatabaseUpgradeRequiredError extends Error {
  readonly code = "CASHIER_DATABASE_UPGRADE_REQUIRED"
  constructor(message = "قاعدة البيانات غير محدثة لدورة الكاشير. شغّل supabase/final-repair.sql ثم أعد المحاولة") {
    super(message)
    this.name = "CashierDatabaseUpgradeRequiredError"
  }
}

function isMissingRpc(error: RpcError | null | undefined, functionName: string) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ")
  return error?.code === "PGRST202"
    || error?.code === "42883"
    || new RegExp(`could not find.*${functionName}|function .*${functionName}.*does not exist`, "i").test(text)
}

/**
 * Executes the strongest available cashier transaction. New databases use the
 * complete v2 document RPC. Existing installations can temporarily fall back
 * to the atomic FEFO sale RPC, while returning a visible upgrade warning.
 */
export class CashierSaleService {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: CashierSaleRpcInput): Promise<CashierSaleResult> {
    const v2 = await this.db.rpc("create_cashier_sale_complete_v2", input)
    if (!v2.error) return (v2.data ?? {}) as CashierSaleResult
    if (!isMissingRpc(v2.error, "create_cashier_sale_complete_v2")) throw v2.error

    const legacyComplete = await this.db.rpc("create_cashier_sale_complete_v1", input)
    if (!legacyComplete.error) return (legacyComplete.data ?? {}) as CashierSaleResult
    if (!isMissingRpc(legacyComplete.error, "create_cashier_sale_complete_v1")) throw legacyComplete.error

    const atomic = await this.db.rpc("create_cashier_sale_v2", {
      p_pharmacy_id: input.p_pharmacy_id,
      p_branch_id: input.p_branch_id,
      p_shift_id: input.p_shift_id,
      p_actor_id: input.p_actor_id,
      p_client_request_id: input.p_client_request_id,
      p_customer_name: input.p_customer_name,
      p_payment_method: input.p_payment_method,
      p_paid_amount: input.p_paid_amount,
      p_invoice_discount: input.p_invoice_discount,
      p_tax_total: input.p_tax_total,
      p_shipping_fee: input.p_shipping_fee,
      p_rounding_adj: input.p_rounding_adj,
      p_notes: input.p_notes,
      p_coupon_code: input.p_coupon_code,
      p_patient_name: input.p_patient_name,
      p_doctor_name: input.p_doctor_name,
      p_prescription_number: input.p_prescription_number,
      p_lines: input.p_lines,
    })
    if (atomic.error) {
      if (isMissingRpc(atomic.error, "create_cashier_sale_v2")) throw new CashierDatabaseUpgradeRequiredError()
      throw atomic.error
    }

    return {
      ...((atomic.data ?? {}) as CashierSaleResult),
      compatibilityMode: true,
      warning: "تم حفظ الفاتورة والمخزون بوضع التوافق. حدّث قاعدة البيانات لاستكمال القيود والربط المحاسبي الحديث.",
    }
  }
}

export function cashierErrorResponse(error: unknown) {
  if (error instanceof CashierStockAvailabilityError) {
    return { status: 409, code: error.code, message: error.message }
  }
  if (error instanceof CashierDatabaseUpgradeRequiredError) {
    return { status: 503, code: error.code, message: error.message }
  }

  const record = (error ?? {}) as RpcError
  const raw = String(record.message ?? error ?? "فشل حفظ فاتورة البيع")
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204"].includes(String(record.code ?? ""))) {
    return {
      status: 503,
      code: "CASHIER_DATABASE_UPGRADE_REQUIRED",
      message: "قاعدة البيانات غير مكتملة لدورة البيع. شغّل supabase/final-repair.sql ثم أعد تحميل الكاشير.",
    }
  }
  const cases: Array<[RegExp, string, string, number]> = [
    [/جلسة الكاشير غير مفتوحة|وردية.*غير مفتوحة|انتهت/i, "CASHIER_SHIFT_NOT_OPEN", "جلسة الكاشير انتهت أو لم تعد مفتوحة. حدّث حالة الجلسة ثم افتحها من جديد.", 409],
    [/الكمية غير كافية|أكبر من المتاح/i, "INSUFFICIENT_STOCK", raw, 409],
    [/تشغيلة صالحة|منتهية الصلاحية|المتاح للبيع|رصيد التشغيلات/i, "NO_VALID_BATCH", raw, 409],
    [/صلاحية تنفيذ البيع|صلاحية.*البيع/i, "SALE_PERMISSION_DENIED", raw, 403],
    [/خصم|discount/i, "DISCOUNT_NOT_ALLOWED", raw, 403],
    [/duplicate key|unique constraint|23505/i, "DUPLICATE_SALE", "تم إرسال نفس الفاتورة من قبل. حدّث العمليات الأخيرة للتأكد منها.", 409],
  ]
  for (const [pattern, code, message, status] of cases) {
    if (pattern.test(raw) || pattern.test(String(record.code ?? ""))) return { status, code, message }
  }
  return { status: 400, code: record.code || "CASHIER_SALE_FAILED", message: raw }
}
