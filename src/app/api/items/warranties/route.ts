import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function clean(s: unknown) { return String(s ?? "").trim() }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const itemId = url.searchParams.get("item_id")
    const scope = await getServerAuthScope({})
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const pharmacyId = scope.activePharmacyId

    let query = db
      .from("pharmacy_item_warranties")
      .select("*")
      .eq("pharmacy_id", pharmacyId)

    if (itemId) query = query.eq("item_id", itemId)
    query = query.order("created_at", { ascending: true })

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ warranties: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تحميل الضمانات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const pharmacyId = scope.activePharmacyId
    const itemId = clean(body.item_id)
    if (!itemId) return NextResponse.json({ error: "معرف الصنف مطلوب" }, { status: 400 })

    const rows = Array.isArray(body.warranties) ? body.warranties as Array<{
      name?: string; duration_days?: number; description?: string
    }> : []

    if (rows.length === 0) return NextResponse.json({ error: "الضمانات مطلوبة" }, { status: 400 })

    const { error: deleteError } = await db
      .from("pharmacy_item_warranties")
      .delete()
      .eq("pharmacy_id", pharmacyId)
      .eq("item_id", itemId)
    if (deleteError) throw deleteError

    const warrantyRows = rows.map((w) => ({
      pharmacy_id: pharmacyId,
      item_id: itemId,
      name: clean(w.name) || "ضمان",
      duration_days: Math.max(0, Number(w.duration_days) || 0),
      description: clean(w.description) || null,
    })).filter((r) => r.duration_days > 0)

    if (warrantyRows.length > 0) {
      const { error: insertError } = await db.from("pharmacy_item_warranties").insert(warrantyRows)
      if (insertError) throw insertError
    }

    return NextResponse.json({ success: true, count: warrantyRows.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حفظ الضمانات"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const warrantyId = url.searchParams.get("id")
    const scope = await getServerAuthScope({})
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    if (!warrantyId) return NextResponse.json({ error: "معرف الضمان مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { error } = await db.from("pharmacy_item_warranties").delete().eq("id", warrantyId).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حذف الضمان"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
