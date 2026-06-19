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

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
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

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const dateFrom = clean(url.searchParams.get("date_from"))
    const dateTo = clean(url.searchParams.get("date_to"))
    const expandLines = url.searchParams.get("expand_lines") === "true"

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    let dbQuery = db
      .from("pharmacy_journal_entries")
      .select(expandLines ? "*,lines:pharmacy_journal_lines(*,account:pharmacy_chart_of_accounts(*))" : "*", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (dateFrom) dbQuery = dbQuery.gte("entry_date", dateFrom)
    if (dateTo) dbQuery = dbQuery.lte("entry_date", dateTo)

    const { data, error, count } = await dbQuery
    if (error) throw error

    return NextResponse.json({
      entries: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    })
  } catch (error) {
    console.error("journal GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل قيود اليومية" }, { status: 500 })
  }
}
