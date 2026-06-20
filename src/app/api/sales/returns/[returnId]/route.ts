import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ returnId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(_request: Request, context: Context) {
  try {
    const { returnId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرتجعات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: header, error } = await db
      .from("pharmacy_sales_returns")
      .select("*,branch:pharmacy_branches(id,name,code),sale:pharmacy_sales(id,invoice_number,customer_name,payment_method,paid_amount,due_amount)")
      .eq("id", returnId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!header) return NextResponse.json({ error: "مرتجع المبيعات غير موجود" }, { status: 404 })
    assertBranchScope(scope, header.branch_id)

    const { data: lines, error: linesError } = await db
      .from("pharmacy_sales_return_lines")
      .select("*,item:pharmacy_items(id,name_ar,sku),batch:pharmacy_item_batches(id,batch_number,expiry_date)")
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("return_id", returnId)
      .order("id")
    if (linesError) throw linesError
    return NextResponse.json({ return: header, lines: lines ?? [] })
  } catch (error) {
    console.error("sales return detail GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل مرتجع المبيعات" }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { returnId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (clean(body.action) !== "void") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })

    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:void")) return NextResponse.json({ error: "ليست لديك صلاحية إلغاء مرتجعات المبيعات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: existing, error: existingError } = await db
      .from("pharmacy_sales_returns")
      .select("id,branch_id,return_number,sale_id,total,refund_amount,voided_at")
      .eq("id", returnId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "مرتجع المبيعات غير موجود" }, { status: 404 })
    assertBranchScope(scope, existing.branch_id)

    const reason = clean(body.reason) || "إلغاء مرتجع مبيعات"
    const { data, error } = await db.rpc("void_sales_return_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_return_id: returnId,
      p_actor_id: scope.user.id,
      p_reason: reason,
    })
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: existing.branch_id,
      actorId: scope.user.id,
      eventType: "sales_return.voided",
      source: "sales",
      description: "تم إلغاء مرتجع المبيعات وعكس المخزون والمبلغ المسترد ومديونية العميل والنقاط والقيد المحاسبي",
      severity: "warning",
      metadata: { return_id: returnId, return_number: existing.return_number, sale_id: existing.sale_id, reason, result: data ?? null },
    })
    return NextResponse.json(data ?? { ok: true })
  } catch (error) {
    console.error("sales return void PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إلغاء مرتجع المبيعات" }, { status: 400 })
  }
}
