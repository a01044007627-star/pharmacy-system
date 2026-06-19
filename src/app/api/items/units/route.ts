import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isMissingTable(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "")
  return message.includes("pharmacy_units") || message.includes("relation") && message.includes("does not exist")
}

export async function GET(request: Request) {
  try {
    const requestedPharmacyId = clean(new URL(request.url).searchParams.get("pharmacy_id")) || null
    const scope = await getServerAuthScope({ requestedPharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase

    const globalUnits = await db
      .from("pharmacy_units")
      .select("id,unit_name,description,is_active,created_at")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("unit_name")

    if (!globalUnits.error) {
      return NextResponse.json({ units: globalUnits.data ?? [] })
    }

    if (!isMissingTable(globalUnits.error)) throw globalUnits.error

    const { data, error } = await db
      .from("pharmacy_item_units")
      .select("id,unit_name")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("unit_name")
    if (error) throw error
    const unique = Array.from(new Map((data ?? []).map((u: { id: string; unit_name: string }) => [u.unit_name, u])).values())
    return NextResponse.json({ units: unique })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الوحدات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const unitName = clean(body.unit_name || body.name)
    if (!unitName) return NextResponse.json({ error: "اسم الوحدة مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db
      .from("pharmacy_units")
      .upsert({ pharmacy_id: scope.activePharmacyId, unit_name: unitName, description: clean(body.description) || null, is_active: body.is_active === false ? false : true, updated_at: new Date().toISOString() }, { onConflict: "pharmacy_id,unit_name" })
      .select("id,unit_name,description,is_active,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    return NextResponse.json({ unit: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إنشاء الوحدة" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (!body.id) return NextResponse.json({ error: "معرف الوحدة مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ("unit_name" in body || "name" in body) updates.unit_name = clean(body.unit_name || body.name)
    if ("description" in body) updates.description = clean(body.description) || null
    if ("is_active" in body) updates.is_active = body.is_active !== false

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db
      .from("pharmacy_units")
      .update(updates)
      .eq("id", body.id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select("id,unit_name,description,is_active,created_at,updated_at")
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "الوحدة غير موجودة" }, { status: 404 })
    return NextResponse.json({ unit: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل الوحدة" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "معرف الوحدة مطلوب" }, { status: 400 })
    const requestedPharmacyId = clean(url.searchParams.get("pharmacy_id")) || null
    const scope = await getServerAuthScope({ requestedPharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:delete")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { error } = await db.from("pharmacy_units").delete().eq("id", id).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف الوحدة" }, { status: 400 })
  }
}
