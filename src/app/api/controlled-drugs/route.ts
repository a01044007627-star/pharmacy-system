import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan, assertBranchScope } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
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
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const branchId = url.searchParams.get("branch_id") && url.searchParams.get("branch_id") !== "all"
      ? url.searchParams.get("branch_id") : scope.activeBranchId
    assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase)

    // Filters
    const action = url.searchParams.get("action")
    const itemId = url.searchParams.get("item_id")
    const fromDate = url.searchParams.get("from")
    const toDate = url.searchParams.get("to")
    const search = url.searchParams.get("search")
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50))
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0)

    let query = db
      .from("pharmacy_controlled_drugs_log")
      .select("*, pharmacy_items!inner(name_ar, sku, is_controlled), pharmacy_branches!left(name)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)

    if (branchId) query = query.eq("branch_id", branchId)
    if (action) query = query.eq("action", action)
    if (itemId) query = query.eq("item_id", itemId)
    if (fromDate) query = query.gte("created_at", fromDate)
    if (toDate) query = query.lte("created_at", toDate)
    if (search) {
      query = query.or(
        `patient_name.ilike.%${search}%,doctor_name.ilike.%${search}%,prescription_number.ilike.%${search}%,id_number.ilike.%${search}%,notes.ilike.%${search}%`
      )
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      entries: data ?? [],
      total: count ?? 0,
      limit,
      offset,
      hasMore: count != null && offset + limit < count,
    })
  } catch (error) {
    console.error("controlled-drugs GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل سجل الأدوية المراقبة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
