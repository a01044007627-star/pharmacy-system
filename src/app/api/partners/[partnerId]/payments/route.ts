import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ partnerId: string }> }
function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) { return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }

export async function POST(request: Request, context: Context) {
  try {
    const { partnerId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: clean(body.branch_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:write") && !scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل المدفوعات" }, { status: 403 })
    const amount = Math.round(Math.max(0, Number(body.amount) || 0) * 100) / 100
    if (amount <= 0) return NextResponse.json({ error: "المبلغ يجب أن يكون أكبر من صفر" }, { status: 400 })
    const branchId = clean(body.branch_id) || scope.activeBranchId || null
    if (branchId) assertBranchScope(scope, branchId)
    const db = getDbClient(await createClient()) as SupabaseClient
    const { data, error } = await db.rpc("record_partner_payment_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_branch_id: branchId,
      p_partner_id: partnerId,
      p_actor_id: scope.user.id,
      p_amount: amount,
      p_payment_method: clean(body.payment_method) || "cash",
      p_payment_date: clean(body.payment_date) || new Date().toISOString(),
      p_reference: clean(body.reference) || null,
      p_notes: clean(body.notes) || null,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
      p_kind: clean(body.kind) || null,
    })
    if (error) throw error
    const result = (data ?? {}) as Record<string, unknown>
    await writeAuditLog(db, { pharmacyId: scope.activePharmacyId, branchId, actorId: scope.user.id, eventType: "partner.payment_recorded", source: "partners", description: "تم تسجيل حركة سداد وربطها بالرصيد والقيد المحاسبي", metadata: { partner_id: partnerId, amount, result } })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("partner payment POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تسجيل الدفعة" }, { status: 400 })
  }
}
