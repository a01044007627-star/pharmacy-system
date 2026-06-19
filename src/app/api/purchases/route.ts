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

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

function resolveBranchId(scope: Awaited<ReturnType<typeof getServerAuthScope>>, requested: string | null) {
  let branchId = requested && requested !== "all" ? requested : null
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
    if (!scopeCan(scope, "purchases:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المشتريات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = resolveBranchId(scope, url.searchParams.get("branch_id"))

    if (url.searchParams.get("bootstrap") === "1") {
      const [itemsResult, suppliersResult] = await Promise.all([
        db
          .from("pharmacy_items")
          .select("id,name_ar,sku,unit,buy_price,sell_price,manage_inventory,track_batch,has_expiry,branch_id,status")
          .eq("pharmacy_id", scope.activePharmacyId)
          .eq("status", "active")
          .order("name_ar")
          .limit(500),
        db
          .from("pharmacy_partners")
          .select("id,name,phone,balance,credit_limit,type")
          .eq("pharmacy_id", scope.activePharmacyId)
          .in("type", ["supplier", "both"])
          .eq("status", "active")
          .order("name")
          .limit(500),
      ])
      if (itemsResult.error) throw itemsResult.error
      if (suppliersResult.error) throw suppliersResult.error
      const items = (itemsResult.data ?? []).filter((item) => !branchId || !item.branch_id || item.branch_id === branchId)
      return NextResponse.json({ items, suppliers: suppliersResult.data ?? [], branchId })
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = safeSearch(clean(url.searchParams.get("query")))
    const paymentStatus = clean(url.searchParams.get("payment_status"))

    let query = db
      .from("pharmacy_purchases")
      .select("id,branch_id,purchase_number,supplier_id,supplier_name,status,payment_status,payment_method,subtotal,discount_total,tax_total,total,paid_amount,due_amount,shipping_fee,purchase_date,created_at,branch:pharmacy_branches(id,name,code)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .order("purchase_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)
    if (search) query = query.or(`purchase_number.ilike.%${search}%,supplier_name.ilike.%${search}%`)
    if (paymentStatus && paymentStatus !== "all") query = query.eq("payment_status", paymentStatus)

    const { data, error, count } = await query
    if (error) throw error
    const rows = data ?? []
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
    console.error("purchases GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المشتريات"
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
    if (!scopeCan(scope, "purchases:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل المشتريات" }, { status: 403 })

    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (!branchId) return NextResponse.json({ error: "اختر الفرع المستلم" }, { status: 400 })
    assertBranchScope(scope, branchId)
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (lines.length === 0) return NextResponse.json({ error: "أضف صنفاً واحداً على الأقل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db.rpc("create_received_purchase", {
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
    const result = (data ?? {}) as { duplicate?: boolean; purchase?: Record<string, unknown> }
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
      },
    })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("purchases POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ فاتورة الشراء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
