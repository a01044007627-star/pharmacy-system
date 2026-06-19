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
    const { data: rpcCount, error: rpcError } = await db.rpc("pharmacy_bulk_update_item_price", {
      p_pharmacy_id: pharmacyId,
      p_item_ids: itemIds,
      p_mode: "fixed",
      p_value: newSellPrice,
      p_actor_id: scope.user.id,
    })

    if (!rpcError) {
      updated = Number(rpcCount ?? 0)
    } else if (/function .* does not exist|schema cache/i.test(rpcError.message)) {
      const { data: currentItems, error: fetchError } = await db
        .from("pharmacy_items")
        .select("id,sell_price")
        .in("id", itemIds)
        .eq("pharmacy_id", pharmacyId)
        .neq("status", "deleted")
      if (fetchError) throw fetchError
      const results = await Promise.all((currentItems ?? []).map(async (item) => {
        const { error } = await db.from("pharmacy_items").update({
          sell_price: newSellPrice,
          ...(keepOldPrice ? { old_sell_price: Number(item.sell_price ?? 0) } : {}),
          updated_at: now,
        }).eq("id", item.id).eq("pharmacy_id", pharmacyId)
        return !error
      }))
      updated = results.filter(Boolean).length
    } else {
      throw rpcError
    }

    return NextResponse.json({ ok: true, updated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحديث الأسعار" }, { status: 400 })
  }
}
