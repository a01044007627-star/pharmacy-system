import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: String(body.pharmacy_id ?? "") || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const itemIds = Array.isArray(body.item_ids) ? body.item_ids.filter(Boolean).map(String) : []
    if (itemIds.length === 0) return NextResponse.json({ error: "اختر صنفاً واحداً على الأقل" }, { status: 400 })

    const newSellPrice = Math.max(0, Number(body.new_sell_price) || 0)
    if (newSellPrice <= 0) return NextResponse.json({ error: "سعر البيع الجديد مطلوب" }, { status: 400 })

    const keepOldPrice = Boolean(body.keep_old_price)

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()

    let updated = 0
    if (keepOldPrice) {
      const { data: currentItems, error: fetchError } = await db
        .from("pharmacy_items")
        .select("id, sell_price")
        .in("id", itemIds)
        .eq("pharmacy_id", pharmacyId)

      if (fetchError) throw fetchError

      if (currentItems && currentItems.length > 0) {
        const updatePromises = currentItems.map(async (item) => {
          const { error } = await db
            .from("pharmacy_items")
            .update({
              sell_price: newSellPrice,
              old_sell_price: Number(item.sell_price ?? 0),
              updated_at: now,
            })
            .eq("id", item.id)
            .eq("pharmacy_id", pharmacyId)
          return !error
        })
        const results = await Promise.all(updatePromises)
        updated = results.filter(Boolean).length
      }
    } else {
      const { data, error } = await db
        .from("pharmacy_items")
        .update({
          sell_price: newSellPrice,
          updated_at: now,
        })
        .in("id", itemIds)
        .eq("pharmacy_id", pharmacyId)
        .select("id")
      if (error) throw error
      if (data) updated = data.length
    }

    return NextResponse.json({ ok: true, updated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحديث الأسعار" }, { status: 400 })
  }
}
