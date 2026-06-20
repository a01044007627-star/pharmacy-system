import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ patientId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function readMaybe<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) {
    console.warn(`[patient detail] ${label} skipped:`, error.message)
    return [] as T[]
  }
  return data ?? []
}

export async function GET(_request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: patient, error } = await db
      .from("pharmacy_patients")
      .select("*, partner:pharmacy_partners(id,name,phone,email,type,status)")
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!patient) return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 })

    const partnerId = patient.partner_id
    const [prescriptions, sales] = await Promise.all([
      readMaybe(
        db
          .from("pharmacy_prescriptions")
          .select("id,doctor_name,diagnosis,status,notes,created_at,updated_at")
          .eq(partnerId ? "patient_id" : "patient_name", partnerId || patient.name)
          .eq("pharmacy_id", scope.activePharmacyId)
          .order("created_at", { ascending: false })
          .limit(20),
        "prescriptions",
      ),
      readMaybe(
        db
          .from("pharmacy_sales")
          .select("id,invoice_number,total,paid_amount,due_amount,payment_method,status,sale_date,created_at")
          .eq(partnerId ? "customer_id" : "customer_name", partnerId || patient.name)
          .eq("pharmacy_id", scope.activePharmacyId)
          .is("voided_at", null)
          .order("sale_date", { ascending: false })
          .limit(20),
        "sales",
      ),
    ])

    return NextResponse.json({
      patient,
      prescriptions,
      sales,
      summary: {
        visit_count: patient.visit_count,
        last_visit_date: patient.last_visit_date,
        total_purchases: patient.total_purchases,
        prescription_count: prescriptions.length,
        sales_count: sales.length,
        sales_total: sales.reduce((acc: number, s: any) => acc + Number(s.total ?? 0), 0),
      },
    })
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

    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing, error: existingError } = await db
      .from("pharmacy_patients")
      .select("id,partner_id,name,phone,email,date_of_birth,gender,status,blood_type")
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 })

    const allowedFields = [
      "name", "phone", "email", "address", "gender", "date_of_birth",
      "id_number", "blood_type", "allergies", "chronic_diseases",
      "current_medications", "medical_history", "surgical_history",
      "family_history", "emergency_contact_name", "emergency_contact_phone",
      "insurance_company", "insurance_policy_number", "insurance_expiry_date",
      "notes", "status",
    ]
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (["allergies", "chronic_diseases", "current_medications"].includes(field)) {
          updates[field] = Array.isArray(body[field]) ? body[field] : []
        } else if (field === "gender") {
          const val = clean(body[field])
          updates[field] = val && ["male", "female"].includes(val) ? val : existing.gender
        } else if (field === "blood_type") {
          const val = clean(body[field])
          updates[field] = val && ["A+","A-","B+","B-","AB+","AB-","O+","O-"].includes(val) ? val : null
        } else if (field === "status") {
          const val = clean(body[field])
          updates[field] = ["active", "inactive", "archived"].includes(val) ? val : existing.status
        } else if (field === "date_of_birth") {
          const val = clean(body[field])
          updates[field] = val || null
          updates.age = val ? Math.floor((Date.now() - new Date(val).getTime()) / (365.25 * 86400000)) : null
        } else {
          updates[field] = clean(body[field]) || null
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 })
    }

    const { data, error } = await db
      .from("pharmacy_patients")
      .update(updates)
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "فشل تحديث بيانات المريض" }, { status: 500 })

    if (existing.partner_id) {
      const partnerUpdates: Record<string, unknown> = {}
      if (body.name !== undefined && clean(body.name) !== existing.name) partnerUpdates.name = clean(body.name)
      if (body.phone !== undefined && clean(body.phone) !== existing.phone) partnerUpdates.phone = clean(body.phone) || null
      if (body.email !== undefined && clean(body.email) !== existing.email) partnerUpdates.email = clean(body.email) || null
      if (Object.keys(partnerUpdates).length > 0) {
        const { error: partnerError } = await db
          .from("pharmacy_partners")
          .update({ ...partnerUpdates, updated_at: new Date().toISOString() })
          .eq("id", existing.partner_id)
          .eq("pharmacy_id", scope.activePharmacyId)
        if (partnerError) console.warn("[patient PATCH] partner update failed:", partnerError.message)
      }
    }

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "patient.updated",
      source: "patients",
      description: "تم تعديل بيانات المريض",
      metadata: { patient_id: data.id, fields: Object.keys(updates) },
    })

    return NextResponse.json({ patient: data })
  } catch (error) {
    console.error("patient detail PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { patientId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية أرشفة المرضى" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing, error: existingError } = await db
      .from("pharmacy_patients")
      .select("id,status,partner_id")
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 })
    if (existing.status === "archived") return NextResponse.json({ error: "المريض مرفوع بالفعل" }, { status: 400 })

    const { error } = await db
      .from("pharmacy_patients")
      .update({ status: "archived" })
      .eq("id", patientId)
      .eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "patient.archived",
      source: "patients",
      description: "تم أرشفة المريض",
      metadata: { patient_id: patientId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("patient DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل أرشفة المريض"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
