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
    const { data, error } = await db.from("pharmacy_item_brands").select("*").eq("pharmacy_id", scope.activePharmacyId).order("name")
    if (error) throw error
    return NextResponse.json({ brands: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الماركات" }, { status: 500 })
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
    const { data, error } = await db.from("pharmacy_item_brands").insert({ pharmacy_id: scope.activePharmacyId, name: clean(body.name), logo_url: clean(body.logo_url) || null }).select("*").maybeSingle()
    if (error) throw error
    return NextResponse.json({ brand: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إنشاء الماركة" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (!body.id) return NextResponse.json({ error: "معرف الماركة مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const updates: Record<string, unknown> = {}
    if ("name" in body) updates.name = clean(body.name)
    if ("logo_url" in body) updates.logo_url = clean(body.logo_url) || null
    const { data, error } = await db.from("pharmacy_item_brands").update(updates).eq("id", body.id).eq("pharmacy_id", scope.activePharmacyId).select("*").maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "الماركة غير موجودة" }, { status: 404 })
    return NextResponse.json({ brand: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل الماركة" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "معرف الماركة مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:delete")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { error } = await db.from("pharmacy_item_brands").delete().eq("id", id).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف الماركة" }, { status: 400 })
  }
}
