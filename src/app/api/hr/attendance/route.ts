import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { requireActivePharmacy, scopeCan } from "@/lib/auth/server-permissions"
import { HrRepository } from "@/lib/server/hr-repository"
import { operationalErrorResponse } from "@/lib/server/tenant-request-context"

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
    const repository = new HrRepository(db, pharmacyId)
    const records = await repository.listAttendance({
      dateKey: clean(url.searchParams.get("date")) || undefined,
      employeeId: clean(url.searchParams.get("employee_id")) || undefined,
      limit: 100,
    })

    return NextResponse.json({ records })
  } catch (error) {
    return operationalErrorResponse(error, "hr/attendance GET failed", "فشل تحميل الحضور")
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
    const repository = new HrRepository(db, pharmacyId)
    const action = clean(body.action)

    if (action === "check-out") {
      return NextResponse.json(await repository.checkOut(employeeId))
    }

    const record = await repository.checkIn({
      employeeId,
      notes: clean(body.notes) || null,
      status: clean(body.status) || null,
    })
    return NextResponse.json(record, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "hr/attendance POST failed", "فشل تسجيل الحضور", 400)
  }
}
