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
    if (!scopeCan(scope, "purchases:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض مرتجعات المشتريات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = await resolveBranchId(scope, url.searchParams.get("branch_id"))
    const purchaseId = clean(url.searchParams.get("purchase_id"))

    if (purchaseId) {
      const { data: purchase, error: purchaseError } = await db
        .from("pharmacy_purchases")
        .select("id,branch_id,purchase_number,supplier_name,total,paid_amount,due_amount,payment_method,purchase_date,voided_at,status")
        .eq("id", purchaseId)
        .eq("pharmacy_id", scope.activePharmacyId)
        .maybeSingle()
      if (purchaseError) throw purchaseError
      if (!purchase) return NextResponse.json({ error: "فاتورة الشراء غير موجودة" }, { status: 404 })
      assertBranchScope(scope, purchase.branch_id)
      if (purchase.voided_at || ["void", "cancelled"].includes(purchase.status)) {
        return NextResponse.json({ error: "لا يمكن إنشاء مرتجع لفاتورة ملغاة" }, { status: 400 })
      }

      const { data: lines, error: linesError } = await db
        .from("pharmacy_purchase_lines")
        .select("id,item_id,batch_id,item_name,unit,batch_number,expiry_date,quantity,buy_price,net_total")
        .eq("pharmacy_id", scope.activePharmacyId)
        .eq("purchase_id", purchaseId)
        .order("created_at", { ascending: true })
      if (linesError) throw linesError

      const lineIds = (lines ?? []).map((line) => line.id)
      let returnedRows: Array<{ purchase_line_id: string | null; quantity: number }> = []
      if (lineIds.length > 0) {
        const { data, error } = await db
          .from("pharmacy_purchase_return_lines")
          .select("purchase_line_id,quantity,return:pharmacy_purchase_returns!inner(voided_at)")
          .eq("pharmacy_id", scope.activePharmacyId)
          .in("purchase_line_id", lineIds)
          .is("return.voided_at", null)
        if (error) throw error
        returnedRows = (data ?? []) as unknown as Array<{ purchase_line_id: string | null; quantity: number }>
      }

      const returnedByLine = new Map<string, number>()
      for (const row of returnedRows) {
        if (!row.purchase_line_id) continue
        returnedByLine.set(row.purchase_line_id, (returnedByLine.get(row.purchase_line_id) ?? 0) + Number(row.quantity ?? 0))
      }

      return NextResponse.json({
        purchase,
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
    const search = clean(url.searchParams.get("query"))
    const supplierFilter = clean(url.searchParams.get("supplier_name"))

    let query = db
      .from("pharmacy_purchase_returns")
      .select("id,branch_id,purchase_id,return_number,supplier_name,total,refund_amount,stock_mode,reason,created_at,branch:pharmacy_branches(name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)
    if (search) query = query.or(`return_number.ilike.%${search}%,supplier_name.ilike.%${search}%`)
    if (supplierFilter) query = query.eq("supplier_name", supplierFilter)

    const { data, error, count } = await query
    if (error) throw error
    return NextResponse.json({
      returns: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("purchase returns GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل مرتجعات المشتريات"
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
