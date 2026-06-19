import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

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

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

function resolveBranchId(scope: Awaited<ReturnType<typeof getServerAuthScope>>, requested: string | null) {
  let branchId = requested && requested !== "all" ? requested : null
  if (branchId) assertBranchScope(scope, branchId)
  if (!branchId && isBranchScoped(scope)) {
    branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId
  }
  return branchId
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المصروفات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = resolveBranchId(scope, url.searchParams.get("branch_id"))
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const search = safeSearch(clean(url.searchParams.get("query")))
    const categoryId = clean(url.searchParams.get("category_id"))
    const dateFrom = clean(url.searchParams.get("date_from"))
    const dateTo = clean(url.searchParams.get("date_to"))

    if (url.searchParams.get("bootstrap") === "1") {
      const { data: categories, error: catError } = await db
        .from("pharmacy_expense_categories")
        .select("id,pharmacy_id,name,parent_id,sort_order")
        .eq("pharmacy_id", scope.activePharmacyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .limit(200)
      if (catError) throw catError
      const { data: branches, error: brError } = await db
        .from("pharmacy_branches")
        .select("id,name,code")
        .eq("pharmacy_id", scope.activePharmacyId)
        .order("name")
        .limit(200)
      if (brError) throw brError
      return NextResponse.json({ categories: categories ?? [], branches: branches ?? [] })
    }

    let query = db
      .from("pharmacy_expenses")
      .select("id,branch_id,category_id,category_name,title,amount,tax_amount,total,payment_method,paid_to,notes,expense_date,voided_at,created_at,branch:pharmacy_branches(id,name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .is("voided_at", null)
      .order("expense_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (branchId) query = query.eq("branch_id", branchId)
    if (search) query = query.or(`title.ilike.%${search}%,paid_to.ilike.%${search}%`)
    if (categoryId) query = query.eq("category_id", categoryId)
    if (dateFrom) query = query.gte("expense_date", dateFrom)
    if (dateTo) query = query.lte("expense_date", dateTo)

    const { data, error, count } = await query
    if (error) throw error
    const rows = data ?? []
    const summary = rows.reduce((acc, row) => ({
      total: acc.total + Number(row.total ?? 0),
      tax: acc.tax + Number(row.tax_amount ?? 0),
    }), { total: 0, tax: 0 })

    return NextResponse.json({
      expenses: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("expenses GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المصروفات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: clean(body.branch_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل مصروفات" }, { status: 403 })

    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (!branchId) return NextResponse.json({ error: "اختر الفرع" }, { status: 400 })
    assertBranchScope(scope, branchId)
    const title = clean(body.title)
    if (!title) return NextResponse.json({ error: "أدخل اسم المصروف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: category } = await db
      .from("pharmacy_expense_categories")
      .select("name")
      .eq("id", clean(body.category_id))
      .maybeSingle()

    const { data, error } = await db
      .from("pharmacy_expenses")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        branch_id: branchId,
        category_id: clean(body.category_id) || null,
        category_name: (category?.name ?? clean(body.category_name)) || null,
        title,
        amount: Math.max(0, Number(body.amount) || 0),
        tax_amount: Math.max(0, Number(body.tax_amount) || 0),
        total: Math.max(0, Number(body.amount) || 0) + Math.max(0, Number(body.tax_amount) || 0),
        payment_method: clean(body.payment_method) || "cash",
        paid_to: clean(body.paid_to) || null,
        notes: clean(body.notes) || null,
        expense_date: clean(body.expense_date) || new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) throw error
    return NextResponse.json({ expense: data }, { status: 201 })
  } catch (error) {
    console.error("expenses POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ المصروف"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
