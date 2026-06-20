import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ patientId: string }> }

type PatientVisitRow = {
  id: string
  visit_type: string
  reference_table?: string | null
  reference_id?: string | null
  visit_date: string
  total_amount?: number | string | null
  notes?: string | null
}

type PrescriptionRow = {
  id: string
  doctor_name?: string | null
  diagnosis?: string | null
  created_at: string
  [key: string]: unknown
}

type PatientSaleRow = {
  id: string
  invoice_number?: string | null
  total?: number | string | null
  sale_date: string
  [key: string]: unknown
}

type SaleLineRow = { sale_id: string }

type PatientTimelineEntry = {
  id: string
  type: string
  reference: string
  date: string
  total: number
  items_count: number
  doctor: string | null
  diagnosis: string | null
  notes?: string | null
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean)
  return clean(value).split(/[,،\n]/).map((part) => part.trim()).filter(Boolean)
}

function ageFromBirth(value: unknown) {
  const birth = clean(value)
  if (!birth) return null
  const date = new Date(`${birth}T00:00:00`)
  if (Number.isNaN(date.getTime()) || date > new Date()) throw new Error("تاريخ الميلاد غير صالح")
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const month = today.getMonth() - date.getMonth()
  if (month < 0 || (month === 0 && today.getDate() < date.getDate())) age -= 1
  return Math.max(0, age)
}

async function readRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) {
    console.warn(`[patient detail] ${label}:`, error.message)
    return [] as T[]
  }
  return data ?? []
}

export async function GET(request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: row, error } = await db
      .from("pharmacy_patients")
      .select("*,partner:pharmacy_partners(id,name,phone,email,address,type,status,balance,credit_limit)")
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!row) return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 })

    const [visits, prescriptions, sales] = await Promise.all([
      readRows<PatientVisitRow>(db.from("pharmacy_patient_visits")
        .select("id,visit_type,reference_table,reference_id,visit_date,total_amount,notes")
        .eq("pharmacy_id", scope.activePharmacyId)
        .eq("patient_id", patientId)
        .order("visit_date", { ascending: false }).limit(100), "visits"),
      readRows<PrescriptionRow>(db.from("pharmacy_prescriptions")
        .select("id,patient_record_id,patient_id,patient_name,doctor_name,diagnosis,status,notes,created_at,updated_at,sale_id")
        .eq("pharmacy_id", scope.activePharmacyId)
        .or(`patient_record_id.eq.${patientId}${row.partner_id ? `,patient_id.eq.${row.partner_id}` : ""}`)
        .order("created_at", { ascending: false }).limit(50), "prescriptions"),
      readRows<PatientSaleRow>(db.from("pharmacy_sales")
        .select("id,invoice_number,total,paid_amount,due_amount,payment_method,status,sale_date,patient_id,customer_id")
        .eq("pharmacy_id", scope.activePharmacyId)
        .or(`patient_id.eq.${patientId}${row.partner_id ? `,customer_id.eq.${row.partner_id}` : ""}`)
        .is("voided_at", null)
        .order("sale_date", { ascending: false }).limit(50), "sales"),
    ])

    const saleIds = sales.map((sale) => sale.id)
    const lineCounts = new Map<string, number>()
    if (saleIds.length) {
      const lines = await readRows<SaleLineRow>(db.from("pharmacy_sale_lines").select("sale_id").eq("pharmacy_id", scope.activePharmacyId).in("sale_id", saleIds), "sale lines")
      for (const line of lines) lineCounts.set(line.sale_id, (lineCounts.get(line.sale_id) ?? 0) + 1)
    }

    const visitMap = new Map<string, PatientTimelineEntry>()
    for (const visit of visits) {
      visitMap.set(visit.id, {
        id: visit.id,
        type: visit.visit_type,
        reference: visit.reference_id ?? (visit.visit_type === "medication_review" ? "مراجعة دوائية" : visit.visit_type === "consultation" ? "استشارة صيدلية" : visit.visit_type === "sale_return" ? "مرتجع بيع" : visit.reference_table ?? "زيارة"),
        date: visit.visit_date,
        total: Number(visit.total_amount ?? 0),
        items_count: 0,
        doctor: null,
        diagnosis: null,
        notes: visit.notes,
      })
    }
    for (const sale of sales) {
      const key = `sale-${sale.id}`
      visitMap.set(key, {
        id: key,
        type: "sale",
        reference: sale.invoice_number ?? "—",
        date: sale.sale_date,
        total: Number(sale.total ?? 0),
        items_count: lineCounts.get(sale.id) ?? 0,
        doctor: null,
        diagnosis: null,
      })
    }
    for (const prescription of prescriptions) {
      const key = `prescription-${prescription.id}`
      visitMap.set(key, {
        id: key,
        type: "prescription",
        reference: `RX-${String(prescription.id).slice(0, 8).toUpperCase()}`,
        date: prescription.created_at,
        total: 0,
        items_count: 0,
        doctor: prescription.doctor_name ?? null,
        diagnosis: prescription.diagnosis ?? null,
      })
    }
    const shapedVisits = Array.from(visitMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const patient = {
      ...row,
      birth_date: row.date_of_birth,
      last_visit: row.last_visit_date,
      medical: {
        allergies: Array.isArray(row.allergies) ? row.allergies : [],
        chronic_diseases: Array.isArray(row.chronic_diseases) ? row.chronic_diseases : [],
        medications: Array.isArray(row.current_medications) ? row.current_medications : [],
        blood_type: row.blood_type,
        medical_history: row.medical_history,
        surgical_history: row.surgical_history,
        family_history: row.family_history,
        notes: row.medical_history || row.notes,
      },
      insurance: {
        provider: row.insurance_company,
        policy_number: row.insurance_policy_number,
        expiry_date: row.insurance_expiry_date,
        coverage_percent: 0,
      },
      emergency: { name: row.emergency_contact_name, phone: row.emergency_contact_phone },
      visits: shapedVisits,
      prescriptions,
      sales,
    }

    return NextResponse.json({ patient })
  } catch (error) {
    console.error("patient detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل بيانات المريض"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: existing, error: existingError } = await db.from("pharmacy_patients").select("*")
      .eq("id", patientId).eq("pharmacy_id", scope.activePharmacyId).maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 })

    const updates: Record<string, unknown> = {}
    const textFields = ["name","phone","email","address","id_number","medical_history","surgical_history","family_history","emergency_contact_name","emergency_contact_phone","insurance_company","insurance_policy_number","notes"]
    for (const field of textFields) if (body[field] !== undefined) updates[field] = clean(body[field]) || null
    const birthValue = body.date_of_birth !== undefined ? body.date_of_birth : body.birth_date
    if (birthValue !== undefined) {
      const birth = clean(birthValue)
      updates.date_of_birth = birth || null
      updates.age = birth ? ageFromBirth(birth) : null
    }
    if (body.insurance_expiry_date !== undefined) updates.insurance_expiry_date = clean(body.insurance_expiry_date) || null
    if (body.gender !== undefined) {
      const value = clean(body.gender)
      updates.gender = ["male", "female"].includes(value) ? value : null
    }
    if (body.blood_type !== undefined) {
      const value = clean(body.blood_type)
      updates.blood_type = ["A+","A-","B+","B-","AB+","AB-","O+","O-"].includes(value) ? value : null
    }
    for (const field of ["allergies","chronic_diseases","current_medications"]) if (body[field] !== undefined) updates[field] = stringArray(body[field])
    if (body.status !== undefined) {
      const value = clean(body.status)
      if (!["active", "inactive", "archived"].includes(value)) return NextResponse.json({ error: "حالة المريض غير صالحة" }, { status: 400 })
      updates.status = value
    }
    if (updates.name !== undefined && !updates.name) return NextResponse.json({ error: "اسم المريض مطلوب" }, { status: 400 })
    if (!Object.keys(updates).length) return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 })

    const idNumber = clean(updates.id_number ?? existing.id_number)
    if (idNumber) {
      const { data: duplicate } = await db.from("pharmacy_patients").select("id").eq("pharmacy_id", scope.activePharmacyId)
        .eq("id_number", idNumber).neq("id", patientId).neq("status", "archived").limit(1).maybeSingle()
      if (duplicate) return NextResponse.json({ error: "يوجد مريض آخر بنفس رقم الهوية" }, { status: 409 })
    }

    const { data, error } = await db.from("pharmacy_patients").update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", patientId).eq("pharmacy_id", scope.activePharmacyId).select().single()
    if (error) throw error

    if (existing.partner_id) {
      const partnerUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const field of ["name", "phone", "email", "address"] as const) {
        if (updates[field] !== undefined) partnerUpdates[field] = updates[field]
      }
      if (updates.status !== undefined) partnerUpdates.status = updates.status === "active" ? "active" : "inactive"
      if (Object.keys(partnerUpdates).length > 1) {
        const { error: partnerError } = await db.from("pharmacy_partners").update(partnerUpdates)
          .eq("id", existing.partner_id).eq("pharmacy_id", scope.activePharmacyId)
        if (partnerError) throw partnerError
      }
    }

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "patient.updated",
      source: "patients",
      description: "تم تعديل ملف المريض",
      metadata: { patient_id: patientId, fields: Object.keys(updates) },
    })
    return NextResponse.json({ patient: data })
  } catch (error) {
    console.error("patient detail PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية أرشفة المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db.from("pharmacy_patients").update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", patientId).eq("pharmacy_id", scope.activePharmacyId).neq("status", "archived").select("id,partner_id").maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "المريض غير موجود أو مؤرشف بالفعل" }, { status: 404 })
    if (data.partner_id) await db.from("pharmacy_partners").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("id", data.partner_id).eq("pharmacy_id", scope.activePharmacyId)

    await writeAuditLog(db, { pharmacyId: scope.activePharmacyId, actorId: scope.user.id, eventType: "patient.archived", source: "patients", description: "تم أرشفة المريض", metadata: { patient_id: patientId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("patient DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل أرشفة المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
