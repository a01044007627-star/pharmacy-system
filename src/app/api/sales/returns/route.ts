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
      permission: "sales:read",
      forbiddenMessage: "ليست لديك صلاحية عرض مرتجعات المبيعات",
    })
    const saleId = context.text("sale_id")
    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)

    if (saleId) {
      const { data: sale, error: saleError } = await context.db
        .from("pharmacy_sales")
        .select("id,branch_id,invoice_number,customer_name,total,paid_amount,due_amount,payment_method,sale_date,voided_at,status")
        .eq("id", saleId)
        .eq("pharmacy_id", context.pharmacyId)
        .maybeSingle()
      if (saleError) throw saleError
      if (!sale) return NextResponse.json({ error: "فاتورة البيع غير موجودة" }, { status: 404 })
      assertBranchScope(context.scope, sale.branch_id)
      if (sale.voided_at || ["void", "cancelled"].includes(sale.status)) {
        return NextResponse.json({ error: "لا يمكن إنشاء مرتجع لفاتورة ملغاة" }, { status: 400 })
      }

      const { data: rawLines, error: linesError } = await context.db
        .from("pharmacy_sale_lines")
        .select("id,item_id,batch_id,item_name,barcode,unit,quantity,unit_price,discount,net_total")
        .eq("pharmacy_id", context.pharmacyId)
        .eq("sale_id", saleId)
        .order("created_at", { ascending: true })
      if (linesError) throw linesError

      const lines = await relations.attachBatches(rawLines ?? [])
      const returnedByLine = await relations.activeSalesReturnQuantities(lines.map((line) => line.id as string))

      return NextResponse.json({
        sale,
        lines: lines.map((line) => {
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
    let query = context.db
      .from("pharmacy_sales_returns")
      .select("id,branch_id,sale_id,return_number,customer_name,total,refund_amount,reason,return_date,created_at", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .is("voided_at", null)
      .order("return_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (context.branchId) query = query.eq("branch_id", context.branchId)

    const { data, error, count } = await query
    if (error) throw error
    const withSales = await relations.attachSales(data ?? [])
    const returns = await relations.attachBranches(withSales)

    return NextResponse.json({
      returns,
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "sales returns GET failed", "فشل تحميل مرتجعات المبيعات")
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
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل مرتجع مبيعات" }, { status: 403 })

    const saleId = clean(body.sale_id)
    if (!saleId) return NextResponse.json({ error: "اختر فاتورة البيع" }, { status: 400 })
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (lines.length === 0) return NextResponse.json({ error: "حدد صنفاً واحداً على الأقل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: sale, error: saleError } = await db
      .from("pharmacy_sales")
      .select("branch_id")
      .eq("id", saleId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (saleError) throw saleError
    if (!sale) return NextResponse.json({ error: "فاتورة البيع غير موجودة" }, { status: 404 })
    assertBranchScope(scope, sale.branch_id)

    const { data, error } = await db.rpc("create_sales_return_complete_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_sale_id: saleId,
      p_actor_id: scope.user.id,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
      p_reason: clean(body.reason) || null,
      p_lines: lines,
    })
    if (error) throw error
    const result = (data ?? {}) as { duplicate?: boolean; return?: Record<string, unknown>; journal_entry_id?: string | null; operational_finalization?: Record<string, unknown> | null }
    const journalEntryId = typeof result.journal_entry_id === "string" ? result.journal_entry_id : null
    const operationalFinalization = result.operational_finalization ?? null

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: String(sale.branch_id),
      actorId: scope.user.id,
      eventType: result.duplicate ? "sales_return.duplicate_ignored" : "sales_return.created",
      source: "sales",
      description: result.duplicate ? "تم تجاهل مرتجع مبيعات مكرر بنفس رقم الطلب" : "تم تسجيل مرتجع مبيعات وتحديث المخزون والخزنة",
      metadata: {
        sale_id: saleId,
        return_id: result.return?.id,
        return_number: result.return?.return_number,
        total: result.return?.total,
        refund_amount: result.return?.refund_amount,
        lines_count: lines.length,
        journal_entry_id: journalEntryId,
        operational_finalization: operationalFinalization,
      },
    })
    return NextResponse.json({ ...result, journal_entry_id: journalEntryId, operational_finalization: operationalFinalization }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("sales returns POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ مرتجع المبيعات"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
