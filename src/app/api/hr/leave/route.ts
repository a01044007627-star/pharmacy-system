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
    const status = clean(url.searchParams.get("status"))

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    let query = db
      .from("pharmacy_shifts")
      .select("*, employee:pharmacy_employees(id,name,position)")
      .eq("pharmacy_id", pharmacyId)
      .not("is_leave", "is", null)
      .order("date", { ascending: false })
      .limit(100)

    if (status === "pending") query = query.eq("leave_status", "pending")
    else if (status === "approved") query = query.eq("leave_status", "approved")
    else if (status === "rejected") query = query.eq("leave_status", "rejected")

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ records: data ?? [] })
  } catch (error) {
    console.error("hr/leave GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الإجازات"
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

    const { data, error } = await db
      .from("pharmacy_shifts")
      .insert({
        pharmacy_id: pharmacyId,
        employee_id: employeeId,
        date: clean(body.date) || new Date().toISOString().split("T")[0],
        is_leave: true,
        leave_reason: clean(body.reason) || "",
        leave_status: "pending",
        type: "leave",
      })
      .select("*")
      .maybeSingle()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("hr/leave POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تسجيل الإجازة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "hr:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)
    const recordId = clean(body.id)
    if (!recordId) return NextResponse.json({ error: "اختر السجل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data, error } = await db
      .from("pharmacy_shifts")
      .update({ leave_status: clean(body.status) || "approved" })
      .eq("id", recordId)
      .eq("pharmacy_id", pharmacyId)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "السجل غير موجود" }, { status: 404 })
    return NextResponse.json(data)
  } catch (error) {
    console.error("hr/leave PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث الإجازة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
