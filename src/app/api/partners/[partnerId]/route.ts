import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ partnerId: string }> }

type TotalsRow = {
  total?: number | string | null
  paid_amount?: number | string | null
  due_amount?: number | string | null
}

type ReturnTotalsRow = {
  total?: number | string | null
  refund_amount?: number | string | null
}

type PaymentTotalsRow = {
  direction?: string | null
  amount?: number | string | null
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function readMaybe<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) {
    console.warn(`[partner detail] ${label} skipped:`, error.message)
    return [] as T[]
  }
  return data ?? []
}

export async function GET(_request: Request, context: Context) {
  try {
    const { partnerId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: partner, error } = await db
      .from("pharmacy_partners")
      .select("*")
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()

    if (error) throw error
    if (!partner) return NextResponse.json({ error: "جهة الاتصال غير موجودة" }, { status: 404 })

    const [addresses, payments, purchases, returns] = await Promise.all([
      readMaybe(
        db
          .from("pharmacy_customer_addresses")
          .select("*")
          .eq("partner_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .order("is_default", { ascending: false }),
        "addresses",
      ),
      readMaybe(
        db
          .from("pharmacy_payments")
          .select("id,source_table,source_id,type,direction,payment_method,amount,reference,notes,payment_date,created_at")
          .eq("partner_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .order("payment_date", { ascending: false })
          .limit(50),
        "payments",
      ),
      readMaybe(
        db
          .from("pharmacy_purchases")
          .select("id,purchase_number,branch_id,supplier_id,supplier_name,status,payment_status,payment_method,total,paid_amount,due_amount,purchase_date,created_at,branch:pharmacy_branches(id,name)")
          .eq("supplier_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .is("voided_at", null)
          .order("purchase_date", { ascending: false })
          .limit(50),
        "purchases",
      ),
      readMaybe(
        db
          .from("pharmacy_purchase_returns")
          .select("id,return_number,purchase_id,supplier_name,total,refund_amount,stock_mode,reason,created_at")
          .eq("supplier_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .order("created_at", { ascending: false })
          .limit(50),
        "purchase_returns",
      ),
    ])

    const [sales, salesReturns, balanceLedger] = await Promise.all([
      readMaybe(
        db.from("pharmacy_sales")
          .select("id,invoice_number,branch_id,customer_id,patient_id,customer_name,status,payment_status,payment_method,total,paid_amount,due_amount,sale_date,created_at,branch:pharmacy_branches(id,name)")
          .eq("customer_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .is("voided_at", null)
          .order("sale_date", { ascending: false })
          .limit(50),
        "sales",
      ),
      readMaybe(
        db.from("pharmacy_sales_returns")
          .select("id,return_number,sale_id,customer_id,patient_id,customer_name,total,refund_amount,stock_mode,reason,return_date,created_at")
          .eq("customer_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .is("voided_at", null)
          .order("return_date", { ascending: false })
          .limit(50),
        "sales_returns",
      ),
      readMaybe(
        db.from("pharmacy_partner_balance_ledger")
          .select("id,branch_id,source_table,source_id,entry_type,amount,balance_before,balance_after,notes,created_at")
          .eq("partner_id", partnerId)
          .eq("pharmacy_id", scope.activePharmacyId)
          .order("created_at", { ascending: false })
          .limit(100),
        "balance_ledger",
      ),
    ])

    const salesSummary = sales.reduce((acc: { count: number; total: number; paid: number; due: number }, row: TotalsRow) => ({
      count: acc.count + 1,
      total: acc.total + Number(row.total ?? 0),
      paid: acc.paid + Number(row.paid_amount ?? 0),
      due: acc.due + Number(row.due_amount ?? 0),
    }), { count: 0, total: 0, paid: 0, due: 0 })
    const salesReturnsSummary = salesReturns.reduce((acc: { count: number; total: number; refunded: number }, row: ReturnTotalsRow) => ({
      count: acc.count + 1,
      total: acc.total + Number(row.total ?? 0),
      refunded: acc.refunded + Number(row.refund_amount ?? 0),
    }), { count: 0, total: 0, refunded: 0 })

    const purchaseSummary = purchases.reduce((acc: { count: number; total: number; paid: number; due: number }, row: TotalsRow) => ({
      count: acc.count + 1,
      total: acc.total + Number(row.total ?? 0),
      paid: acc.paid + Number(row.paid_amount ?? 0),
      due: acc.due + Number(row.due_amount ?? 0),
    }), { count: 0, total: 0, paid: 0, due: 0 })
    const paymentsSummary = payments.reduce((acc: { count: number; in: number; out: number }, row: PaymentTotalsRow) => ({
      count: acc.count + 1,
      in: acc.in + (row.direction === "in" ? Number(row.amount ?? 0) : 0),
      out: acc.out + (row.direction === "out" ? Number(row.amount ?? 0) : 0),
    }), { count: 0, in: 0, out: 0 })

    return NextResponse.json({
      partner,
      addresses,
      payments,
      purchases,
      purchaseReturns: returns,
      sales,
      salesReturns,
      balanceLedger,
      purchaseSummary,
      salesSummary,
      salesReturnsSummary,
      paymentsSummary,
    })
  } catch (error) {
    console.error("partner detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل بيانات جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { partnerId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const allowedFields = ["name", "type", "phone", "email", "address", "tax_id", "opening_balance", "credit_limit", "notes", "status"]
    const payload: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) payload[field] = body[field]
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 })
    }
    if (payload.name !== undefined && !clean(payload.name)) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 })
    if (payload.type !== undefined && !["customer", "supplier", "both"].includes(clean(payload.type))) return NextResponse.json({ error: "نوع جهة الاتصال غير صالح" }, { status: 400 })
    if (payload.status !== undefined && !["active", "inactive"].includes(clean(payload.status))) return NextResponse.json({ error: "حالة جهة الاتصال غير صالحة" }, { status: 400 })

    const requestId = clean(body.client_request_id) || crypto.randomUUID()
    const { data: result, error } = await db.rpc("update_partner_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_partner_id: partnerId,
      p_actor_id: scope.user.id,
      p_payload: payload,
      p_client_request_id: requestId,
    })
    if (error) throw error
    const rpcResult = (result ?? {}) as { partner?: Record<string, unknown>; opening_delta?: number; journal_entry_id?: string | null; duplicate?: boolean }
    if (!rpcResult.partner) return NextResponse.json({ error: "جهة الاتصال غير موجودة" }, { status: 404 })

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: rpcResult.duplicate ? "partner.update_duplicate_ignored" : "partner.updated",
      source: "partners",
      description: "تم تعديل جهة الاتصال وربط تعديل الرصيد الافتتاحي بالحسابات",
      metadata: {
        partner_id: partnerId,
        fields: Object.keys(payload),
        opening_delta: rpcResult.opening_delta ?? 0,
        journal_entry_id: rpcResult.journal_entry_id ?? null,
        client_request_id: requestId,
      },
    })

    return NextResponse.json(rpcResult.partner)
  } catch (error) {
    console.error("partner detail PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { partnerId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية حذف جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { error } = await db
      .from("pharmacy_partners")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)

    if (error) throw error

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "partner.deactivated",
      source: "partners",
      description: "تم تعطيل جهة اتصال",
      metadata: { partner_id: partnerId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("partner DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل حذف جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
