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

export async function GET() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db.from("pharmacy_item_groups").select("*").eq("pharmacy_id", scope.activePharmacyId).order("name")
    if (error) throw error
    return NextResponse.json({ groups: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل المجموعات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db.from("pharmacy_item_groups").insert({ pharmacy_id: scope.activePharmacyId, name: clean(body.name), color: clean(body.color) || null }).select("*").maybeSingle()
    if (error) throw error
    return NextResponse.json({ group: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إنشاء المجموعة" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (!body.id) return NextResponse.json({ error: "معرف المجموعة مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const updates: Record<string, unknown> = {}
    if ("name" in body) updates.name = clean(body.name)
    if ("color" in body) updates.color = clean(body.color) || null
    const { data, error } = await db.from("pharmacy_item_groups").update(updates).eq("id", body.id).eq("pharmacy_id", scope.activePharmacyId).select("*").maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "المجموعة غير موجودة" }, { status: 404 })
    return NextResponse.json({ group: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل المجموعة" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "معرف المجموعة مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:delete")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { error } = await db.from("pharmacy_item_groups").delete().eq("id", id).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف المجموعة" }, { status: 400 })
  }
}
