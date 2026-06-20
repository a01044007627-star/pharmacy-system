import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
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

function filterStatus(value: string) {
  return ["active", "inactive", "archived"].includes(value) ? value : ""
}

function filterGender(value: string) {
  return ["male", "female"].includes(value) ? value : ""
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean)
  return clean(value).split(/[,،\n]/).map((item) => item.trim()).filter(Boolean)
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = safeSearch(clean(url.searchParams.get("search") || url.searchParams.get("query")))
    const status = filterStatus(clean(url.searchParams.get("status")))
    const gender = filterGender(clean(url.searchParams.get("gender")))
    const requestedSort = clean(url.searchParams.get("sort"))
    const allowedSorts = new Set(["created_at", "updated_at", "name", "last_visit_date", "visit_count", "total_purchases"])
    const sort = allowedSorts.has(requestedSort) ? requestedSort : "created_at"
    const ascending = url.searchParams.get("sort_dir") === "asc"

    let query = db
      .from("pharmacy_patients")
      .select("id,pharmacy_id,partner_id,code,name,phone,email,address,gender,date_of_birth,age,status,visit_count,last_visit_date,total_purchases,notes,created_at,updated_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order(sort, { ascending })
      .range(offset, offset + pageSize - 1)

    if (status) query = query.eq("status", status)
    if (gender) query = query.eq("gender", gender)
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,email.ilike.%${search}%,id_number.ilike.%${search}%`)

    const [listResult, totalResult, activeResult, inactiveResult, archivedResult] = await Promise.all([
      query,
      db.from("pharmacy_patients").select("id", { count: "exact", head: true }).eq("pharmacy_id", scope.activePharmacyId),
      db.from("pharmacy_patients").select("id", { count: "exact", head: true }).eq("pharmacy_id", scope.activePharmacyId).eq("status", "active"),
      db.from("pharmacy_patients").select("id", { count: "exact", head: true }).eq("pharmacy_id", scope.activePharmacyId).eq("status", "inactive"),
      db.from("pharmacy_patients").select("id", { count: "exact", head: true }).eq("pharmacy_id", scope.activePharmacyId).eq("status", "archived"),
    ])
    if (listResult.error) throw listResult.error

    const patients = (listResult.data ?? []).map((row) => ({
      ...row,
      birth_date: row.date_of_birth,
      last_visit: row.last_visit_date,
    }))
    const total = listResult.count ?? 0

    return NextResponse.json({
      patients,
      summary: {
        count: totalResult.count ?? 0,
        active: activeResult.count ?? 0,
        inactive: inactiveResult.count ?? 0,
        archived: archivedResult.count ?? 0,
      },
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error("patients GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المرضى"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة مرضى" }, { status: 403 })
    if (!clean(body.name)) return NextResponse.json({ error: "اسم المريض مطلوب" }, { status: 400 })

    const payload = {
      ...body,
      name: clean(body.name),
      phone: clean(body.phone) || null,
      email: clean(body.email) || null,
      address: clean(body.address) || null,
      date_of_birth: clean(body.date_of_birth || body.birth_date) || null,
      allergies: normalizeStringArray(body.allergies),
      chronic_diseases: normalizeStringArray(body.chronic_diseases),
      current_medications: normalizeStringArray(body.current_medications),
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db.rpc("create_pharmacy_patient_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_actor_id: scope.user.id,
      p_payload: payload,
    })
    if (error) throw error
    const result = (data ?? {}) as { patient?: Record<string, unknown>; partner?: Record<string, unknown> }
    if (!result.patient?.id) throw new Error("تعذر إنشاء سجل المريض")

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "patient.created",
      source: "patients",
      description: "تم إنشاء ملف مريض وربطه بحساب عميل",
      metadata: { patient_id: result.patient.id, partner_id: result.partner?.id, code: result.patient.code, name: result.patient.name },
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("patients POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
