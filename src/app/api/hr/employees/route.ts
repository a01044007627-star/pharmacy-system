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

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
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

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = clean(url.searchParams.get("query"))
    const status = clean(url.searchParams.get("is_active"))

    let query = db
      .from("pharmacy_employees")
      .select("*", { count: "exact" })
      .eq("pharmacy_id", pharmacyId)
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (search) query = query.or(`name.ilike.%${search}%,position.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
    if (status === "active") query = query.eq("is_active", true)
    else if (status === "inactive") query = query.eq("is_active", false)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      employees: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("hr/employees GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الموظفين"
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

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data, error } = await db
      .from("pharmacy_employees")
      .insert({
        pharmacy_id: pharmacyId,
        user_id: scope.user.id,
        name: clean(body.name) || "موظف",
        phone: clean(body.phone) || null,
        email: clean(body.email) || null,
        position: clean(body.position) || null,
        salary: Math.max(0, Number(body.salary) || 0),
        salary_type: clean(body.salary_type) || "monthly",
        hire_date: clean(body.hire_date) || new Date().toISOString(),
        national_id: clean(body.national_id) || null,
        address: clean(body.address) || null,
        notes: clean(body.notes) || null,
        is_active: body.is_active !== false,
      })
      .select("*")
      .maybeSingle()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("hr/employees POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إضافة الموظف"
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
    const employeeId = clean(body.id)
    if (!employeeId) return NextResponse.json({ error: "اختر الموظف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = clean(body.name)
    if (body.phone !== undefined) updates.phone = clean(body.phone)
    if (body.email !== undefined) updates.email = clean(body.email)
    if (body.position !== undefined) updates.position = clean(body.position)
    if (body.salary !== undefined) updates.salary = Math.max(0, Number(body.salary))
    if (body.salary_type !== undefined) updates.salary_type = clean(body.salary_type)
    if (body.hire_date !== undefined) updates.hire_date = clean(body.hire_date)
    if (body.national_id !== undefined) updates.national_id = clean(body.national_id)
    if (body.address !== undefined) updates.address = clean(body.address)
    if (body.notes !== undefined) updates.notes = clean(body.notes)
    if (body.is_active !== undefined) updates.is_active = body.is_active === true

    const { data, error } = await db
      .from("pharmacy_employees")
      .update(updates)
      .eq("id", employeeId)
      .eq("pharmacy_id", pharmacyId)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 })
    return NextResponse.json(data)
  } catch (error) {
    console.error("hr/employees PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث الموظف"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "hr:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)
    const employeeId = clean(url.searchParams.get("id"))
    if (!employeeId) return NextResponse.json({ error: "اختر الموظف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { error } = await db.from("pharmacy_employees").delete().eq("id", employeeId).eq("pharmacy_id", pharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("hr/employees DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل حذف الموظف"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
