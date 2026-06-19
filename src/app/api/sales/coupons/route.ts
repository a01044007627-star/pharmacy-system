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
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض الكوبونات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = clean(url.searchParams.get("query"))
    const isActive = url.searchParams.get("is_active")

    let couponsQuery = db
      .from("pharmacy_coupons")
      .select("id,pharmacy_id,code,discount_type,discount_value,min_purchase,max_uses,used_count,valid_from,valid_until,is_active,created_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (query) couponsQuery = couponsQuery.ilike("code", `%${query}%`)
    if (isActive === "true") couponsQuery = couponsQuery.eq("is_active", true)
    else if (isActive === "false") couponsQuery = couponsQuery.eq("is_active", false)

    const { data, error, count } = await couponsQuery
    if (error) throw error

    return NextResponse.json({
      coupons: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("coupons GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل الكوبونات"
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
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية إنشاء كوبون" }, { status: 403 })

    const code = clean(body.code)
    if (!code) return NextResponse.json({ error: "كود الكوبون مطلوب" }, { status: 400 })
    const discountType = clean(body.discount_type)
    if (!["percentage", "fixed"].includes(discountType)) return NextResponse.json({ error: "نوع الخصم غير صالح" }, { status: 400 })
    const discountValue = Math.max(0, Number(body.discount_value) || 0)
    if (discountValue <= 0) return NextResponse.json({ error: "قيمة الخصم يجب أن تكون أكبر من صفر" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing } = await db
      .from("pharmacy_coupons")
      .select("id")
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("code", code)
      .maybeSingle()
    if (existing) return NextResponse.json({ error: "كود الكوبون موجود مسبقًا" }, { status: 409 })

    const { data, error } = await db
      .from("pharmacy_coupons")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        code,
        discount_type: discountType,
        discount_value: discountValue,
        min_purchase: Math.max(0, Number(body.min_purchase) || 0),
        max_uses: Math.max(0, Number(body.max_uses) || 0),
        used_count: 0,
        valid_from: clean(body.valid_from) || null,
        valid_until: clean(body.valid_until) || null,
        is_active: body.is_active !== false,
      })
      .select("id,code,discount_type,discount_value,is_active")
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "فشل إنشاء الكوبون" }, { status: 400 })

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("coupons POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ الكوبون"
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
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل الكوبون" }, { status: 403 })

    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: "معرف الكوبون مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: existing } = await db
      .from("pharmacy_coupons")
      .select("id")
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: "الكوبون غير موجود" }, { status: 404 })

    const updates: Record<string, unknown> = {}
    if (body.code !== undefined) updates.code = clean(body.code)
    if (body.discount_type !== undefined) {
      const dt = clean(body.discount_type)
      if (!["percentage", "fixed"].includes(dt)) return NextResponse.json({ error: "نوع الخصم غير صالح" }, { status: 400 })
      updates.discount_type = dt
    }
    if (body.discount_value !== undefined) updates.discount_value = Math.max(0, Number(body.discount_value) || 0)
    if (body.min_purchase !== undefined) updates.min_purchase = Math.max(0, Number(body.min_purchase) || 0)
    if (body.max_uses !== undefined) updates.max_uses = Math.max(0, Number(body.max_uses) || 0)
    if (body.valid_from !== undefined) updates.valid_from = clean(body.valid_from) || null
    if (body.valid_until !== undefined) updates.valid_until = clean(body.valid_until) || null
    if (body.is_active !== undefined) updates.is_active = body.is_active === true

    const { data, error } = await db
      .from("pharmacy_coupons")
      .update(updates)
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select("id,code,discount_type,discount_value,is_active")
      .maybeSingle()
    if (error) throw error

    return NextResponse.json(data ?? {})
  } catch (error) {
    console.error("coupons PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث الكوبون"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "معرف الكوبون مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية حذف الكوبون" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { error } = await db
      .from("pharmacy_coupons")
      .delete()
      .eq("id", id)
      .eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("coupons DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل حذف الكوبون"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
