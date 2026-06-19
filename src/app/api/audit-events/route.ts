import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id") === "all" ? null : url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "auth:audit.read")) {
      return NextResponse.json({ error: "ليست لديك صلاحية عرض سجل المراجعة" }, { status: 403 })
    }

    let branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if ((!branchId || branchId === "all") && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? ""
    }

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 30, 10, 100)
    const offset = (page - 1) * pageSize
    const source = clean(url.searchParams.get("source"))
    const severity = clean(url.searchParams.get("severity"))
    const query = safeSearch(clean(url.searchParams.get("query")))
    const dateFrom = clean(url.searchParams.get("date_from"))
    const dateTo = clean(url.searchParams.get("date_to"))

    const supabase = await createClient()
    const db = (process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : supabase) as SupabaseClient
    let dbQuery = db
      .from("pharmacy_audit_events")
      .select("id,branch_id,actor_id,event_type,severity,source,description,metadata,created_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId && branchId !== "all") dbQuery = dbQuery.eq("branch_id", branchId)
    if (source && source !== "all") dbQuery = dbQuery.eq("source", source)
    if (severity && severity !== "all") dbQuery = dbQuery.eq("severity", severity)
    if (dateFrom) dbQuery = dbQuery.gte("created_at", `${dateFrom}T00:00:00`)
    if (dateTo) dbQuery = dbQuery.lte("created_at", `${dateTo}T23:59:59.999`)
    if (query) dbQuery = dbQuery.or(`event_type.ilike.%${query}%,source.ilike.%${query}%,description.ilike.%${query}%`)

    const { data, error, count } = await dbQuery
    if (error) throw error
    return NextResponse.json({
      events: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("audit-events GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل سجل المراجعة" }, { status: 500 })
  }
}
