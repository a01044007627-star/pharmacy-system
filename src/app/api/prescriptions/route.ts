import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) { return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : "" }
function safeInt(value: unknown, fallback: number, min: number, max: number) { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback }
function safeSearch(value: string) { return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim() }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "prescriptions:read") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية عرض الوصفات" }, { status: 403 })
    let branchId = clean(url.searchParams.get("branch_id")) || null
    if (branchId === "all") branchId = null
    if (branchId) assertBranchScope(scope, branchId)
    if (!branchId && isBranchScoped(scope)) branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
    const page = safeInt(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeInt(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = safeSearch(clean(url.searchParams.get("query")))
    const status = clean(url.searchParams.get("status"))
    const db = getDbClient(await createClient()) as SupabaseClient
    let query = db.from("pharmacy_prescriptions")
      .select("id,pharmacy_id,branch_id,patient_id,patient_record_id,sale_id,prescription_number,patient_name,doctor_name,diagnosis,image_url,status,notes,items,prescription_date,valid_until,dispensed_by,dispensed_at,created_at,updated_at,patient:pharmacy_patients(id,code,name,phone,status),branch:pharmacy_branches(id,name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("prescription_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)
    if (["open", "dispensed", "cancelled", "archived"].includes(status)) query = query.eq("status", status)
    if (search) query = query.or(`prescription_number.ilike.%${search}%,patient_name.ilike.%${search}%,doctor_name.ilike.%${search}%,diagnosis.ilike.%${search}%`)
    const { data, error, count } = await query
    if (error) throw error
    return NextResponse.json({ prescriptions: data ?? [], pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) } })
  } catch (error) {
    console.error("prescriptions GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الوصفات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: clean(body.branch_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "prescriptions:write") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية إضافة وصفة" }, { status: 403 })
    const branchId = clean(body.branch_id) || scope.activeBranchId || null
    if (branchId) assertBranchScope(scope, branchId)
    const patientRecordId = clean(body.patient_record_id || body.patient_id) || null
    const items = Array.isArray(body.items) ? body.items : []
    const db = getDbClient(await createClient()) as SupabaseClient
    const { data, error } = await db.rpc("create_prescription_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_branch_id: branchId,
      p_actor_id: scope.user.id,
      p_patient_record_id: patientRecordId,
      p_patient_name: clean(body.patient_name) || null,
      p_doctor_name: clean(body.doctor_name) || null,
      p_diagnosis: clean(body.diagnosis) || null,
      p_notes: clean(body.notes) || null,
      p_items: items,
      p_valid_until: clean(body.valid_until) || null,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
    })
    if (error) throw error
    const result = (data ?? {}) as Record<string, unknown>
    await writeAuditLog(db, { pharmacyId: scope.activePharmacyId, branchId, actorId: scope.user.id, eventType: result.duplicate ? "prescription.duplicate_ignored" : "prescription.created", source: "prescriptions", description: "تم حفظ وصفة طبية وربطها بملف المريض", metadata: result })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("prescriptions POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة الوصفة" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "prescriptions:write") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية تعديل الوصفات" }, { status: 403 })
    const id = clean(body.id)
    const status = clean(body.status)
    if (!id) return NextResponse.json({ error: "معرف الوصفة مطلوب" }, { status: 400 })
    if (!["open", "dispensed", "cancelled", "archived"].includes(status)) return NextResponse.json({ error: "حالة الوصفة غير صالحة" }, { status: 400 })
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === "dispensed") { updates.dispensed_by = scope.user.id; updates.dispensed_at = new Date().toISOString() }
    if (status === "open") { updates.dispensed_by = null; updates.dispensed_at = null }
    const db = getDbClient(await createClient()) as SupabaseClient
    const { data, error } = await db.from("pharmacy_prescriptions").update(updates).eq("id", id).eq("pharmacy_id", scope.activePharmacyId).select().maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "الوصفة غير موجودة" }, { status: 404 })
    await writeAuditLog(db, { pharmacyId: scope.activePharmacyId, branchId: data.branch_id, actorId: scope.user.id, eventType: `prescription.${status}`, source: "prescriptions", description: "تم تحديث حالة الوصفة الطبية", metadata: { prescription_id: id, status } })
    return NextResponse.json({ prescription: data })
  } catch (error) {
    console.error("prescriptions PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل الوصفة" }, { status: 400 })
  }
}
