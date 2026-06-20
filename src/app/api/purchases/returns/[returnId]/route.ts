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

export async function GET(_request: Request, context: Context) {
  try {
    const { returnId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: ret, error } = await db
      .from("pharmacy_purchase_returns")
      .select("*,branch:pharmacy_branches(id,name),purchase:pharmacy_purchases(purchase_number)")
      .eq("id", returnId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!ret) return NextResponse.json({ error: "مرتجع الشراء غير موجود" }, { status: 404 })
    assertBranchScope(scope, ret.branch_id)

    const { data: lines, error: linesError } = await db
      .from("pharmacy_purchase_return_lines")
      .select("*,item:pharmacy_items(name_ar,sku)")
      .eq("return_id", returnId)
      .order("created_at")
    if (linesError) throw linesError

    return NextResponse.json({ return: ret, lines: lines ?? [] })
  } catch (error) {
    console.error("purchase return detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل مرتجع الشراء"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { returnId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== "void") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:void")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: ret, error: retError } = await db
      .from("pharmacy_purchase_returns")
      .select("branch_id")
      .eq("id", returnId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (retError) throw retError
    if (!ret) return NextResponse.json({ error: "مرتجع الشراء غير موجود" }, { status: 404 })
    assertBranchScope(scope, ret.branch_id)

    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "إلغاء مرتجع مشتريات"
    const { data, error } = await db.rpc("void_purchase_return_complete_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_return_id: returnId,
      p_actor_id: scope.user.id,
      p_reason: reason,
    })
    if (error) throw error
    const result = (data ?? {}) as { operation?: Record<string, unknown>; finalization?: Record<string, unknown> }

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: ret.branch_id,
      actorId: scope.user.id,
      eventType: "purchase_return.voided",
      source: "purchases",
      description: "تم إلغاء مرتجع المشتريات وعكس المخزون وحساب المورد والقيد المحاسبي",
      severity: "warning",
      metadata: { return_id: returnId, reason, operation: result.operation ?? null, finalization: result.finalization ?? null },
    })
    return NextResponse.json({ operation: result.operation ?? { ok: true }, finalization: result.finalization ?? null })
  } catch (error) {
    console.error("purchase return void PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إلغاء مرتجع الشراء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
