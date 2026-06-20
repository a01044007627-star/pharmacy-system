import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}


export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "purchases:read",
      forbiddenMessage: "ليست لديك صلاحية عرض المشتريات",
    })

    if (context.url.searchParams.get("bootstrap") === "1") {
      const [itemsResult, suppliersResult] = await Promise.all([
        context.db
          .from("pharmacy_items")
          .select("id,name_ar,sku,unit,buy_price,sell_price,manage_inventory,track_batch,has_expiry,branch_id,status")
          .eq("pharmacy_id", context.pharmacyId)
          .eq("status", "active")
          .order("name_ar")
          .limit(500),
        context.db
          .from("pharmacy_partners")
          .select("id,name,phone,balance,credit_limit,type")
          .eq("pharmacy_id", context.pharmacyId)
          .in("type", ["supplier", "both"])
          .eq("status", "active")
          .order("name")
          .limit(500),
      ])
      if (itemsResult.error) throw itemsResult.error
      if (suppliersResult.error) throw suppliersResult.error
      const items = (itemsResult.data ?? []).filter((item) => !context.branchId || !item.branch_id || item.branch_id === context.branchId)
      return NextResponse.json({ items, suppliers: suppliersResult.data ?? [], branchId: context.branchId })
    }

    const { page, pageSize, offset } = context.pagination()
    const search = context.search()
    const paymentStatus = context.text("payment_status")

    let query = context.db
      .from("pharmacy_purchases")
      .select("id,branch_id,purchase_number,supplier_id,supplier_name,status,payment_status,payment_method,subtotal,discount_total,tax_total,total,paid_amount,due_amount,shipping_fee,purchase_date,created_at", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .is("voided_at", null)
      .order("purchase_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (context.branchId) query = query.eq("branch_id", context.branchId)
    if (search) query = query.or(`purchase_number.ilike.%${search}%,supplier_name.ilike.%${search}%`)
    if (paymentStatus && paymentStatus !== "all") query = query.eq("payment_status", paymentStatus)

    const { data, error, count } = await query
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const rows = await relations.attachBranches(data ?? [])
    const summary = rows.reduce((acc, row) => ({
      total: acc.total + Number(row.total ?? 0),
      paid: acc.paid + Number(row.paid_amount ?? 0),
      due: acc.due + Number(row.due_amount ?? 0),
    }), { total: 0, paid: 0, due: 0 })

    return NextResponse.json({
      purchases: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "purchases GET failed", "فشل تحميل المشتريات")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: clean(body.branch_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل المشتريات" }, { status: 403 })

    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (!branchId) return NextResponse.json({ error: "اختر الفرع المستلم" }, { status: 400 })
    assertBranchScope(scope, branchId)
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (lines.length === 0) return NextResponse.json({ error: "أضف صنفاً واحداً على الأقل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db.rpc("create_received_purchase_complete_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_branch_id: branchId,
      p_actor_id: scope.user.id,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
      p_supplier_id: clean(body.supplier_id) || null,
      p_supplier_name: clean(body.supplier_name) || "مورد نقدي",
      p_payment_method: clean(body.payment_method) || "cash",
      p_paid_amount: Math.max(0, Number(body.paid_amount) || 0),
      p_header_discount: Math.max(0, Number(body.header_discount) || 0),
      p_tax_total: Math.max(0, Number(body.tax_total) || 0),
      p_shipping_fee: Math.max(0, Number(body.shipping_fee) || 0),
      p_notes: clean(body.notes) || null,
      p_purchase_date: clean(body.purchase_date) || new Date().toISOString(),
      p_lines: lines,
    })
    if (error) throw error
    const result = (data ?? {}) as { duplicate?: boolean; purchase?: Record<string, unknown>; journal_entry_id?: string | null; partner_ledger?: Record<string, unknown> | null }
    const journalEntryId = typeof result.journal_entry_id === "string" ? result.journal_entry_id : null

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId,
      actorId: scope.user.id,
      eventType: result.duplicate ? "purchase.duplicate_ignored" : "purchase.received",
      source: "purchases",
      description: result.duplicate ? "تم تجاهل فاتورة شراء مكررة بنفس رقم الطلب" : "تم استلام فاتورة شراء وتحديث المخزون",
      metadata: {
        purchase_id: result.purchase?.id,
        purchase_number: result.purchase?.purchase_number,
        supplier_id: clean(body.supplier_id) || null,
        supplier_name: clean(body.supplier_name) || "مورد نقدي",
        total: result.purchase?.total,
        paid_amount: result.purchase?.paid_amount,
        lines_count: lines.length,
        journal_entry_id: journalEntryId,
      },
    })
    return NextResponse.json({ ...result, journal_entry_id: journalEntryId }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("purchases POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ فاتورة الشراء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
