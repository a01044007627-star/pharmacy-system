import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ patientId: string }> }

function dbClient(fallback: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallback
}
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }

export async function GET(request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: url.searchParams.get("branch_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض زيارات المرضى" }, { status: 403 })
    const db = dbClient(await createClient()) as SupabaseClient
    let query = db.from("pharmacy_patient_visits")
      .select("id,pharmacy_id,branch_id,patient_id,visit_type,reference_table,reference_id,visit_date,total_amount,notes,created_by,created_at,updated_at")
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("patient_id", patientId)
      .order("visit_date", { ascending: false })
      .limit(250)
    if (isBranchScoped(scope) && scope.activeBranchId) query = query.eq("branch_id", scope.activeBranchId)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ visits: data ?? [] })
  } catch (error) {
    console.error("patient visits GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الزيارات" }, { status: 500 })
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: clean(body.branch_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل زيارة" }, { status: 403 })
    const branchId = clean(body.branch_id) || scope.activeBranchId || null
    if (branchId) assertBranchScope(scope, branchId)
    const type = clean(body.visit_type) || "manual"
    if (!["consultation", "medication_review", "manual", "other"].includes(type)) {
      return NextResponse.json({ error: "نوع الزيارة غير صالح" }, { status: 400 })
    }
    const visitDate = clean(body.visit_date)
    const db = dbClient(await createClient()) as SupabaseClient
    const { data, error } = await db.rpc("record_patient_visit_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_branch_id: branchId,
      p_patient_id: patientId,
      p_visit_type: type,
      p_notes: clean(body.notes) || null,
      p_visit_date: visitDate || new Date().toISOString(),
      p_actor_id: scope.user.id,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
    })
    if (error) throw error
    const result = (data ?? {}) as Record<string, unknown>
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId,
      actorId: scope.user.id,
      eventType: result.duplicate ? "patient.visit_duplicate_ignored" : "patient.visit_recorded",
      source: "patients",
      description: "تم تسجيل زيارة أو مراجعة دوائية للمريض",
      metadata: { patient_id: patientId, visit_type: type, ...result },
    })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("patient visits POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تسجيل الزيارة" }, { status: 400 })
  }
}
