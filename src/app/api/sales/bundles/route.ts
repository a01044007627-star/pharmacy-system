import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

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
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض الباقات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = clean(url.searchParams.get("query"))

    let bundlesQuery = db
      .from("pharmacy_bundles")
      .select("id,pharmacy_id,name,price,total_original_price,is_active,created_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (query) bundlesQuery = bundlesQuery.ilike("name", `%${query}%`)

    const { data, error, count } = await bundlesQuery
    if (error) throw error

    const bundleIds = (data ?? []).map((b) => b.id)
    let items: Array<{ bundle_id: string; item_id: string; quantity: number }> = []
    if (bundleIds.length > 0) {
      const { data: itemsData } = await db
        .from("pharmacy_bundle_items")
        .select("bundle_id,item_id,quantity")
        .in("bundle_id", bundleIds)
      items = (itemsData ?? []) as Array<{ bundle_id: string; item_id: string; quantity: number }>
    }

    const itemsByBundle = new Map<string, Array<{ item_id: string; quantity: number }>>()
    for (const item of items) {
      const list = itemsByBundle.get(item.bundle_id) ?? []
      list.push({ item_id: item.item_id, quantity: item.quantity })
      itemsByBundle.set(item.bundle_id, list)
    }

    const bundles = (data ?? []).map((bundle) => ({
      ...bundle,
      items: itemsByBundle.get(bundle.id) ?? [],
    }))

    return NextResponse.json({
      bundles,
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("bundles GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الباقات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية إنشاء باقة" }, { status: 403 })

    const name = clean(body.name)
    if (!name) return NextResponse.json({ error: "اسم الباقة مطلوب" }, { status: 400 })
    const price = Math.max(0, Number(body.price) || 0)
    if (price <= 0) return NextResponse.json({ error: "سعر الباقة يجب أن يكون أكبر من صفر" }, { status: 400 })
    const bundleItems = Array.isArray(body.items) ? body.items : []
    if (bundleItems.length === 0) return NextResponse.json({ error: "أضف صنفًا واحدًا على الأقل للباقة" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: bundle, error: bundleError } = await db
      .from("pharmacy_bundles")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        name,
        price,
        total_original_price: Math.max(0, Number(body.total_original_price) || 0),
        is_active: body.is_active !== false,
      })
      .select("id,pharmacy_id,name,price,total_original_price,is_active")
      .maybeSingle()
    if (bundleError) throw bundleError
    if (!bundle) return NextResponse.json({ error: "فشل إنشاء الباقة" }, { status: 400 })

    const { error: itemsError } = await db
      .from("pharmacy_bundle_items")
      .insert(bundleItems.map((item: Record<string, unknown>) => ({
        bundle_id: bundle.id,
        item_id: clean(item.item_id),
        quantity: Math.max(0, Number(item.quantity) || 1),
      })))
    if (itemsError) throw itemsError

    return NextResponse.json({ ...bundle, items: bundleItems }, { status: 201 })
  } catch (error) {
    console.error("bundles POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ الباقة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل الباقة" }, { status: 403 })

    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: "معرف الباقة مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing } = await db
      .from("pharmacy_bundles")
      .select("id")
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 })

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = clean(body.name)
    if (body.price !== undefined) updates.price = Math.max(0, Number(body.price) || 0)
    if (body.total_original_price !== undefined) updates.total_original_price = Math.max(0, Number(body.total_original_price) || 0)
    if (body.is_active !== undefined) updates.is_active = body.is_active === true

    await db
      .from("pharmacy_bundles")
      .update(updates)
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)

    if (Array.isArray(body.items)) {
      await db.from("pharmacy_bundle_items").delete().eq("bundle_id", id)
      if (body.items.length > 0) {
        await db.from("pharmacy_bundle_items").insert(body.items.map((item: Record<string, unknown>) => ({
          bundle_id: id,
          item_id: clean(item.item_id),
          quantity: Math.max(0, Number(item.quantity) || 1),
        })))
      }
    }

    const { data: updated } = await db
      .from("pharmacy_bundles")
      .select("id,pharmacy_id,name,price,total_original_price,is_active")
      .eq("id", id)
      .maybeSingle()

    return NextResponse.json(updated ?? {})
  } catch (error) {
    console.error("bundles PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث الباقة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "معرف الباقة مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية حذف الباقة" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    await db.from("pharmacy_bundle_items").delete().eq("bundle_id", id)
    const { error } = await db.from("pharmacy_bundles").delete().eq("id", id).eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("bundles DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل حذف الباقة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
