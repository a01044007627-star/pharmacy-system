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

    const { data: employees, error } = await db
      .from("pharmacy_employees")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .order("name")

    if (error) throw error

    const totalSalary = (employees ?? []).reduce((sum: number, emp: { salary?: number }) => sum + Math.max(0, Number(emp.salary ?? 0)), 0)
    return NextResponse.json({ employees: employees ?? [], summary: { total: employees?.length ?? 0, total_salary: totalSalary } })
  } catch (error) {
    console.error("hr/payroll GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الرواتب"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "hr:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    return NextResponse.json({ message: "تم إنشاء كشف الرواتب", period: clean(body.period) || new Date().toISOString().slice(0, 7) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل إنشاء كشف الرواتب"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
