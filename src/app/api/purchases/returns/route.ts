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
      forbiddenMessage: "ليست لديك صلاحية عرض مرتجعات المشتريات",
    })
    const purchaseId = context.text("purchase_id")
    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)

    if (purchaseId) {
      const { data: purchase, error: purchaseError } = await context.db
        .from("pharmacy_purchases")
        .select("id,branch_id,purchase_number,supplier_name,total,paid_amount,due_amount,payment_method,purchase_date,voided_at,status")
        .eq("id", purchaseId)
        .eq("pharmacy_id", context.pharmacyId)
        .maybeSingle()
      if (purchaseError) throw purchaseError
      if (!purchase) return NextResponse.json({ error: "فاتورة الشراء غير موجودة" }, { status: 404 })
      assertBranchScope(context.scope, purchase.branch_id)
      if (purchase.voided_at || ["void", "cancelled"].includes(purchase.status)) {
        return NextResponse.json({ error: "لا يمكن إنشاء مرتجع لفاتورة ملغاة" }, { status: 400 })
      }

      const { data: lines, error: linesError } = await context.db
        .from("pharmacy_purchase_lines")
        .select("id,item_id,batch_id,item_name,unit,batch_number,expiry_date,quantity,buy_price,net_total")
        .eq("pharmacy_id", context.pharmacyId)
        .eq("purchase_id", purchaseId)
      if (linesError) throw linesError

      const returnedByLine = await relations.activePurchaseReturnQuantities((lines ?? []).map((line) => line.id as string))
      return NextResponse.json({
        purchase,
        lines: (lines ?? []).map((line) => {
          const returnedQuantity = returnedByLine.get(line.id as string) ?? 0
          return {
            ...line,
            returned_quantity: returnedQuantity,
            returnable_quantity: Math.max(0, Number(line.quantity ?? 0) - returnedQuantity),
          }
        }),
      })
    }

    const { page, pageSize, offset } = context.pagination()
    const search = context.search()
    const supplierFilter = context.text("supplier_name")

    let query = context.db
      .from("pharmacy_purchase_returns")
      .select("id,branch_id,purchase_id,return_number,supplier_name,total,refund_amount,stock_mode,reason,created_at", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (context.branchId) query = query.eq("branch_id", context.branchId)
    if (search) query = query.or(`return_number.ilike.%${search}%,supplier_name.ilike.%${search}%`)
    if (supplierFilter) query = query.eq("supplier_name", supplierFilter)

    const { data, error, count } = await query
    if (error) throw error
    const returns = await relations.attachBranches(data ?? [])

    return NextResponse.json({
      returns,
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "purchase returns GET failed", "فشل تحميل مرتجعات المشتريات")
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
    if (!scopeCan(scope, "purchases:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل مرتجع مشتريات" }, { status: 403 })

    const purchaseId = clean(body.purchase_id)
    if (!purchaseId) return NextResponse.json({ error: "اختر فاتورة الشراء" }, { status: 400 })
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (lines.length === 0) return NextResponse.json({ error: "حدد صنفاً واحداً على الأقل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: purchase, error: purchaseError } = await db
      .from("pharmacy_purchases")
      .select("branch_id,supplier_name,total")
      .eq("id", purchaseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (purchaseError) throw purchaseError
    if (!purchase) return NextResponse.json({ error: "فاتورة الشراء غير موجودة" }, { status: 404 })
    assertBranchScope(scope, purchase.branch_id)

    const { data, error } = await db.rpc("create_purchase_return_complete_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_purchase_id: purchaseId,
      p_actor_id: scope.user.id,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
      p_stock_mode: clean(body.stock_mode) || "restock",
      p_reason: clean(body.reason) || null,
      p_lines: lines,
    })
    if (error) throw error
    const result = (data ?? {}) as { duplicate?: boolean; return?: Record<string, unknown>; journal_entry_id?: string | null; operational_finalization?: Record<string, unknown> | null }
    const journalEntryId = typeof result.journal_entry_id === "string" ? result.journal_entry_id : null
    const operationalFinalization = result.operational_finalization ?? null

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: String(purchase.branch_id),
      actorId: scope.user.id,
      eventType: result.duplicate ? "purchase_return.duplicate_ignored" : "purchase_return.created",
      source: "purchases",
      description: result.duplicate ? "تم تجاهل مرتجع مشتريات مكرر بنفس رقم الطلب" : "تم تسجيل مرتجع مشتريات وتحديث المخزون وحساب المورد",
      metadata: {
        purchase_id: purchaseId,
        supplier_name: purchase.supplier_name,
        return_id: result.return?.id,
        return_number: result.return?.return_number,
        total: result.return?.total,
        refund_amount: result.return?.refund_amount,
        stock_mode: clean(body.stock_mode) || "restock",
        lines_count: lines.length,
        journal_entry_id: journalEntryId,
        operational_finalization: operationalFinalization,
      },
    })
    return NextResponse.json({ ...result, journal_entry_id: journalEntryId, operational_finalization: operationalFinalization }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("purchase returns POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ مرتجع المشتريات"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
