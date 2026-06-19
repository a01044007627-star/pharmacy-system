import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { requireActivePharmacy, scopeCan } from "@/lib/auth/server-permissions"

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
    if (!scopeCan(scope, "hr:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const date = clean(url.searchParams.get("date"))
    const employeeId = clean(url.searchParams.get("employee_id"))

    let query = db
      .from("pharmacy_shifts")
      .select("*, employee:pharmacy_employees(id,name,position)")
      .eq("pharmacy_id", pharmacyId)
      .order("date", { ascending: false })
      .limit(100)

    if (date) query = query.eq("date", date)
    if (employeeId) query = query.eq("employee_id", employeeId)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ records: data ?? [] })
  } catch (error) {
    console.error("hr/attendance GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الحضور"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "hr:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)
    const employeeId = clean(body.employee_id)
    if (!employeeId) return NextResponse.json({ error: "اختر الموظف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const today = new Date().toISOString().split("T")[0]
    const action = clean(body.action)

    if (action === "check-out") {
      const { data: existing } = await db
        .from("pharmacy_shifts")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("date", today)
        .is("clock_out", null)
        .maybeSingle()

      if (!existing) return NextResponse.json({ error: "لا يوجد تسجيل دخول اليوم" }, { status: 400 })

      const { data, error } = await db
        .from("pharmacy_shifts")
        .update({ clock_out: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle()

      if (error) throw error
      return NextResponse.json(data)
    }

    const { data, error } = await db
      .from("pharmacy_shifts")
      .insert({
        pharmacy_id: pharmacyId,
        employee_id: employeeId,
        date: today,
        clock_in: new Date().toISOString(),
        type: clean(body.type) || "regular",
      })
      .select("*")
      .maybeSingle()

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "تم تسجيل الدخول مسبقاً" }, { status: 409 })
      throw error
    }
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("hr/attendance POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تسجيل الحضور"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
