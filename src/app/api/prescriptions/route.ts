import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "prescriptions:read") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = url.searchParams.get("pharmacy_id") || scope.activePharmacyId

    let query = db
      .from("pharmacy_prescriptions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)

    if (pharmacyId) query = query.eq("pharmacy_id", pharmacyId)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ prescriptions: data ?? [] })
  } catch (error) {
    console.error("prescriptions GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الوصفات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId && !clean(body.pharmacy_id)) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "prescriptions:read") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data, error } = await db
      .from("pharmacy_prescriptions")
      .insert({
        pharmacy_id: clean(body.pharmacy_id) || scope.activePharmacyId,
        patient_name: clean(body.patient_name) || "مريض",
        doctor_name: clean(body.doctor_name) || null,
        diagnosis: clean(body.diagnosis) || null,
        notes: clean(body.notes) || null,
        created_by: scope.user.id,
      })
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "فشل حفظ الوصفة" }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("prescriptions POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إضافة الوصفة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
