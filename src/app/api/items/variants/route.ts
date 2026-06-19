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
      .from("pharmacy_item_variants")
      .select("*")
      .eq("pharmacy_id", pharmacyId)

    if (itemId) query = query.eq("item_id", itemId)
    query = query.order("created_at", { ascending: true })

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ variants: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تحميل المتغيرات"
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

    const variants = Array.isArray(body.variants) ? body.variants as Array<{
      name?: string; value?: string; sku?: string; sell_price?: number; purchase_price?: number; barcode?: string
    }> : []

    if (variants.length === 0) return NextResponse.json({ error: "المتغيرات مطلوبة" }, { status: 400 })

    const { error: deleteError } = await db
      .from("pharmacy_item_variants")
      .delete()
      .eq("pharmacy_id", pharmacyId)
      .eq("item_id", itemId)
    if (deleteError) throw deleteError

    const rows = variants.map((v) => ({
      pharmacy_id: pharmacyId,
      item_id: itemId,
      name: clean(v.name) || "variation",
      value: clean(v.value),
      sku: clean(v.sku) || null,
      sell_price: Number.isFinite(Number(v.sell_price)) ? Number(v.sell_price) : null,
      purchase_price: Number.isFinite(Number(v.purchase_price)) ? Number(v.purchase_price) : 0,
      barcode: clean(v.barcode) || null,
      metadata: { source: "variants_manager" },
    })).filter((r) => r.value)

    if (rows.length > 0) {
      const { error: insertError } = await db.from("pharmacy_item_variants").insert(rows)
      if (insertError) throw insertError
    }

    await db.from("pharmacy_items").update({
      product_type: rows.length > 0 ? "variable" : "single",
      updated_at: new Date().toISOString(),
    }).eq("pharmacy_id", pharmacyId).eq("id", itemId)

    return NextResponse.json({ success: true, count: rows.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حفظ المتغيرات"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const variantId = url.searchParams.get("id")
    const scope = await getServerAuthScope({})
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    if (!variantId) return NextResponse.json({ error: "معرف المتغير مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { error } = await db.from("pharmacy_item_variants").delete().eq("id", variantId).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حذف المتغير"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
