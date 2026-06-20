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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = safeSearch(clean(url.searchParams.get("search")))
    const status = filterStatus(clean(url.searchParams.get("status")))
    const sort = clean(url.searchParams.get("sort")) || "created_at"
    const sortDir = url.searchParams.get("sort_dir") === "asc" ? "asc" as const : "desc" as const

    let query = db
      .from("pharmacy_patients")
      .select("id,pharmacy_id,partner_id,code,name,phone,email,address,gender,date_of_birth,age,status,visit_count,last_visit_date,total_purchases,notes,created_at,updated_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order(sort, { ascending: sortDir === "asc" })
      .range(offset, offset + pageSize - 1)

    if (status) query = query.eq("status", status)
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,email.ilike.%${search}%`)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      patients: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
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
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة مرضى" }, { status: 403 })

    const name = clean(body.name)
    if (!name) return NextResponse.json({ error: "اسم المريض مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { count } = await db
      .from("pharmacy_patients")
      .select("id", { count: "exact", head: true })
      .eq("pharmacy_id", scope.activePharmacyId)
    const code = `PAT-${String((count ?? 0) + 1).padStart(5, "0")}`

    const { data: partner, error: partnerError } = await db
      .from("pharmacy_partners")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        type: "customer",
        name,
        phone: clean(body.phone) || null,
        email: clean(body.email) || null,
        status: "active",
      })
      .select("id")
      .single()
    if (partnerError) throw partnerError

    const gender = clean(body.gender)
    const allergies = Array.isArray(body.allergies) ? body.allergies : []
    const chronicDiseases = Array.isArray(body.chronic_diseases) ? body.chronic_diseases : []
    const currentMedications = Array.isArray(body.current_medications) ? body.current_medications : []
    const dateOfBirth = clean(body.date_of_birth) || null

    const { data, error } = await db
      .from("pharmacy_patients")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        partner_id: partner.id,
        code,
        name,
        phone: clean(body.phone) || null,
        email: clean(body.email) || null,
        address: clean(body.address) || null,
        gender: gender && ["male", "female"].includes(gender) ? gender : null,
        date_of_birth: dateOfBirth,
        age: dateOfBirth ? Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 86400000)) : null,
        id_number: clean(body.id_number) || null,
        blood_type: clean(body.blood_type) || null,
        allergies,
        chronic_diseases: chronicDiseases,
        current_medications: currentMedications,
        medical_history: clean(body.medical_history) || null,
        surgical_history: clean(body.surgical_history) || null,
        family_history: clean(body.family_history) || null,
        emergency_contact_name: clean(body.emergency_contact_name) || null,
        emergency_contact_phone: clean(body.emergency_contact_phone) || null,
        insurance_company: clean(body.insurance_company) || null,
        insurance_policy_number: clean(body.insurance_policy_number) || null,
        insurance_expiry_date: clean(body.insurance_expiry_date) || null,
        notes: clean(body.notes) || null,
        status: "active",
        created_by: scope.user.id,
      })
      .select()
      .single()
    if (error) throw error

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "patient.created",
      source: "patients",
      description: "تم إنشاء مريض جديد",
      metadata: { patient_id: data.id, code: data.code, name: data.name },
    })

    return NextResponse.json({ patient: data }, { status: 201 })
  } catch (error) {
    console.error("patients POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
