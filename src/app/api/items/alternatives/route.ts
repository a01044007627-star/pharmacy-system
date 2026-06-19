import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

type AlternativeRow = {
  id: string
  item_id: string
  alternative_item_id: string
  priority: number
  notes: string | null
  created_at: string
  item?: { id: string; name_ar: string; sku: string | null } | null
  alternative?: { id: string; name_ar: string; sku: string | null } | null
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const query = clean(url.searchParams.get("query")).toLowerCase()
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية قراءة البدائل" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db
      .from("pharmacy_item_alternatives")
      .select("id,item_id,alternative_item_id,priority,notes,created_at")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) throw error

    const alternatives = (data ?? []) as AlternativeRow[]
    const itemIds = Array.from(new Set(alternatives.flatMap((row) => [row.item_id, row.alternative_item_id]).filter(Boolean)))
    const itemMap = new Map<string, { id: string; name_ar: string; sku: string | null }>()
    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await db
        .from("pharmacy_items")
        .select("id,name_ar,sku")
        .eq("pharmacy_id", scope.activePharmacyId)
        .in("id", itemIds)
      if (itemsError) throw itemsError
      for (const item of (items ?? []) as Array<{ id: string; name_ar: string; sku: string | null }>) {
        itemMap.set(item.id, item)
      }
    }

    const rows = alternatives.map((row) => ({
      ...row,
      item: itemMap.get(row.item_id) ?? null,
      alternative: itemMap.get(row.alternative_item_id) ?? null,
    })).filter((row) => {
      if (!query) return true
      return [row.item?.name_ar, row.item?.sku, row.alternative?.name_ar, row.alternative?.sku, row.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
    return NextResponse.json({ alternatives: rows })
  } catch (error) {
    console.error("item alternatives GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل بدائل الأصناف" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل البدائل" }, { status: 403 })

    const itemId = clean(body.item_id)
    const alternativeItemId = clean(body.alternative_item_id)
    if (!itemId || !alternativeItemId) return NextResponse.json({ error: "اختر الصنف والبديل" }, { status: 400 })
    if (itemId === alternativeItemId) return NextResponse.json({ error: "لا يمكن أن يكون الصنف بديلًا لنفسه" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db
      .from("pharmacy_item_alternatives")
      .upsert({ pharmacy_id: scope.activePharmacyId, item_id: itemId, alternative_item_id: alternativeItemId, priority: Number(body.priority) || 0, notes: clean(body.notes) || null }, { onConflict: "pharmacy_id,item_id,alternative_item_id" })
      .select("id,item_id,alternative_item_id,priority,notes,created_at")
      .maybeSingle()
    if (error) throw error

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "item.alternative_saved",
      source: "items",
      description: "تم حفظ بديل صنف",
      metadata: { item_id: itemId, alternative_item_id: alternativeItemId },
    })

    return NextResponse.json({ alternative: data }, { status: 201 })
  } catch (error) {
    console.error("item alternatives POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حفظ بديل الصنف" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = clean(url.searchParams.get("id"))
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل البدائل" }, { status: 403 })
    if (!id) return NextResponse.json({ error: "معرف البديل مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { error } = await db.from("pharmacy_item_alternatives").delete().eq("id", id).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("item alternatives DELETE failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف بديل الصنف" }, { status: 400 })
  }
}
