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

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const query = safeSearch(clean(url.searchParams.get("query")))

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    let dbQuery = db
      .from("pharmacy_chart_of_accounts")
      .select("*")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("code", { ascending: true })

    if (query) dbQuery = dbQuery.or(`name.ilike.%${query}%,code.ilike.%${query}%`)

    const { data, error } = await dbQuery
    if (error) throw error

    return NextResponse.json({ accounts: data ?? [] })
  } catch (error) {
    console.error("chart-of-accounts GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الحسابات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const code = clean(body.code)
    const name = clean(body.name)
    const type = clean(body.type)
    if (!code || !name || !type) return NextResponse.json({ error: "الكود والاسم والنوع مطلوبون" }, { status: 400 })
    if (!["asset", "liability", "equity", "income", "expense"].includes(type)) {
      return NextResponse.json({ error: "نوع الحساب غير صالح" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId

    const { data: existing } = await db.from("pharmacy_chart_of_accounts").select("id").eq("pharmacy_id", pharmacyId).eq("code", code).maybeSingle()
    if (existing) return NextResponse.json({ error: "الكود موجود مسبقًا" }, { status: 409 })

    const { data, error } = await db.from("pharmacy_chart_of_accounts").insert({
      pharmacy_id: pharmacyId,
      code,
      name,
      type,
      parent_id: clean(body.parent_id) || null,
      is_active: body.is_active !== false,
    }).select("*").maybeSingle()

    if (error) throw error
    return NextResponse.json({ account: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة الحساب" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const accountId = clean(body.account_id)
    if (!accountId) return NextResponse.json({ error: "اختر الحساب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const updates: Record<string, unknown> = {}

    if (body.name) updates.name = clean(body.name)
    if (body.code) updates.code = clean(body.code)
    if (body.type) {
      if (!["asset", "liability", "equity", "income", "expense"].includes(clean(body.type))) {
        return NextResponse.json({ error: "نوع الحساب غير صالح" }, { status: 400 })
      }
      updates.type = clean(body.type)
    }
    if (body.parent_id !== undefined) updates.parent_id = clean(body.parent_id) || null
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active)

    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 })

    const { data, error } = await db.from("pharmacy_chart_of_accounts").update(updates).eq("id", accountId).eq("pharmacy_id", scope.activePharmacyId).select("*").maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "الحساب غير موجود" }, { status: 404 })

    return NextResponse.json({ account: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحديث الحساب" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const accountId = clean(url.searchParams.get("account_id"))
    if (!accountId) return NextResponse.json({ error: "اختر الحساب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId

    const { count } = await db.from("pharmacy_chart_of_accounts").select("*", { count: "exact", head: true }).eq("parent_id", accountId).eq("pharmacy_id", pharmacyId)
    if (count && count > 0) return NextResponse.json({ error: "لا يمكن حذف حساب له أبناء" }, { status: 400 })

    const { error } = await db.from("pharmacy_chart_of_accounts").delete().eq("id", accountId).eq("pharmacy_id", pharmacyId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف الحساب" }, { status: 400 })
  }
}
