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
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المرتجعات الحرة" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const branchId = resolveBranchId(scope, url.searchParams.get("branch_id"))
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize

    let returnsQuery = db
      .from("pharmacy_invoice_drafts")
      .select("id,pharmacy_id,branch_id,draft_type,title,payload,status,created_by,created_at,updated_at,branch:pharmacy_branches(id,name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("draft_type", "free_return")
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId) returnsQuery = returnsQuery.eq("branch_id", branchId)

    const { data, error, count } = await returnsQuery
    if (error) throw error

    return NextResponse.json({
      returns: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("free returns GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المرتجعات الحرة"
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
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل مرتجع حر" }, { status: 403 })

    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (!branchId) return NextResponse.json({ error: "اختر الفرع" }, { status: 400 })
    assertBranchScope(scope, branchId)

    const lines = Array.isArray(body.lines) ? body.lines : []
    if (lines.length === 0) return NextResponse.json({ error: "أضف صنفًا واحدًا على الأقل" }, { status: 400 })

    const title = clean(body.title) || `مرتجع حر - ${new Date().toLocaleDateString("ar-EG")}`
    const reason = clean(body.reason) || ""

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data, error } = await db
      .from("pharmacy_invoice_drafts")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        branch_id: branchId,
        draft_type: "free_return",
        title,
        payload: { lines, reason, total: Number(body.total) || 0 },
        status: "completed",
        created_by: scope.user.id,
      })
      .select("id,title,status,created_at")
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "فشل تسجيل المرتجع الحر" }, { status: 400 })

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("free returns POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تسجيل المرتجع الحر"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
