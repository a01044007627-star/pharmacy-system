import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "notifications:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pharmacy_inapp_notifications")
      .select("*")
      .eq("user_id", scope.user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) throw error
    return NextResponse.json({ notifications: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تحميل الإشعارات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "notifications:manage")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const title = typeof body.title === "string" ? body.title.trim() : ""
    if (!title) return NextResponse.json({ error: "عنوان الإشعار مطلوب" }, { status: 400 })

    const description = typeof body.description === "string" ? body.description.trim() : ""
    const notif_type = ["warning", "success", "info", "error"].includes(String(body.notif_type)) ? String(body.notif_type) : "info"
    const href = typeof body.href === "string" ? body.href : null

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pharmacy_inapp_notifications")
      .insert({ user_id: scope.user.id, title, description, notif_type, href })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ notification: data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل إنشاء الإشعار"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
