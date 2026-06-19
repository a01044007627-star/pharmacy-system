import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

async function resolveBranchId(scope: Awaited<ReturnType<typeof getServerAuthScope>>, requestedBranchId: string | null) {
  let branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null
  if (branchId) assertBranchScope(scope, branchId)
  if (!branchId && isBranchScoped(scope)) {
    branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
  }
  return branchId
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض مرتجعات المبيعات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = await resolveBranchId(scope, url.searchParams.get("branch_id"))
    const saleId = clean(url.searchParams.get("sale_id"))

    if (saleId) {
      const { data: sale, error: saleError } = await db
        .from("pharmacy_sales")
        .select("id,branch_id,invoice_number,customer_name,total,paid_amount,due_amount,payment_method,sale_date,voided_at,status")
        .eq("id", saleId)
        .eq("pharmacy_id", scope.activePharmacyId)
        .maybeSingle()
      if (saleError) throw saleError
      if (!sale) return NextResponse.json({ error: "فاتورة البيع غير موجودة" }, { status: 404 })
      assertBranchScope(scope, sale.branch_id)
      if (sale.voided_at || ["void", "cancelled"].includes(sale.status)) {
        return NextResponse.json({ error: "لا يمكن إنشاء مرتجع لفاتورة ملغاة" }, { status: 400 })
      }

      const { data: lines, error: linesError } = await db
        .from("pharmacy_sale_lines")
        .select("id,item_id,batch_id,item_name,barcode,unit,quantity,unit_price,discount,net_total,batch:pharmacy_item_batches(id,batch_number,expiry_date)")
        .eq("pharmacy_id", scope.activePharmacyId)
        .eq("sale_id", saleId)
        .order("created_at", { ascending: true })
      if (linesError) throw linesError

      const lineIds = (lines ?? []).map((line) => line.id)
      let returnedRows: Array<{ sale_line_id: string | null; quantity: number }> = []
      if (lineIds.length > 0) {
        const { data, error } = await db
          .from("pharmacy_sales_return_lines")
          .select("sale_line_id,quantity,return:pharmacy_sales_returns!inner(voided_at)")
          .eq("pharmacy_id", scope.activePharmacyId)
          .in("sale_line_id", lineIds)
          .is("return.voided_at", null)
        if (error) throw error
        returnedRows = (data ?? []) as unknown as Array<{ sale_line_id: string | null; quantity: number }>
      }

      const returnedByLine = new Map<string, number>()
      for (const row of returnedRows) {
        if (!row.sale_line_id) continue
        returnedByLine.set(row.sale_line_id, (returnedByLine.get(row.sale_line_id) ?? 0) + Number(row.quantity ?? 0))
      }

      return NextResponse.json({
        sale,
        lines: (lines ?? []).map((line) => {
          const returnedQuantity = returnedByLine.get(line.id) ?? 0
          return {
            ...line,
            returned_quantity: returnedQuantity,
            returnable_quantity: Math.max(0, Number(line.quantity ?? 0) - returnedQuantity),
          }
        }),
      })
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    let query = db
      .from("pharmacy_sales_returns")
      .select("id,branch_id,sale_id,return_number,customer_name,total,refund_amount,reason,return_date,created_at,sale:pharmacy_sales(invoice_number),branch:pharmacy_branches(name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .order("return_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)

    const { data, error, count } = await query
    if (error) throw error
    return NextResponse.json({
      returns: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    })
  } catch (error) {
    console.error("sales returns GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل مرتجعات المبيعات"
    return NextResponse.json({ error: message }, { status: 500 })
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

    const { data, error } = await db.rpc("create_sales_return", {
      p_pharmacy_id: scope.activePharmacyId,
      p_sale_id: saleId,
      p_actor_id: scope.user.id,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
      p_reason: clean(body.reason) || null,
      p_lines: lines,
    })
    if (error) throw error
    const result = (data ?? {}) as { duplicate?: boolean; return?: Record<string, unknown> }
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
      },
    })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("sales returns POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ مرتجع المبيعات"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
