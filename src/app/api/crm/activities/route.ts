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
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض النشاطات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const partnerId = clean(url.searchParams.get("partner_id"))

    let query = db
      .from("pharmacy_payments")
      .select("id,source_table,source_id,partner_id,type,direction,payment_method,amount,reference,notes,payment_date,created_at,partner:pharmacy_partners!inner(name,type)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .not("partner_id", "is", null)
      .order("payment_date", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (partnerId) query = query.eq("partner_id", partnerId)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      activities: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("crm activities GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل النشاطات"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
