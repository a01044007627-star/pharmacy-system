import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const itemId = url.searchParams.get("item_id")
    const requestedPharmacyId = url.searchParams.get("pharmacy_id")?.trim() || null
    const scope = await getServerAuthScope({ requestedPharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    let branchId = url.searchParams.get("branch_id")?.trim() || null
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if (!branchId || branchId === "all") {
      if (isBranchScoped(scope)) {
        branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? null
      } else { branchId = null }
    }

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const pharmacyId = scope.activePharmacyId

    if (!itemId) return NextResponse.json({ error: "معرف الصنف مطلوب" }, { status: 400 })

    let query = db
      .from("pharmacy_stock_movements")
      .select("id, direction, quantity, unit_price, total_value, movement_type, source_table, created_at, batch_id, item_id, branch_id")
      .eq("pharmacy_id", pharmacyId)
      .eq("item_id", itemId)
    if (branchId) query = query.eq("branch_id", branchId)
    query = query.order("created_at", { ascending: false }).limit(200)

    const { data, error } = await query

    if (error) throw error

    const batchIds = (data ?? []).map((m: Record<string, unknown>) => m.batch_id).filter(Boolean) as string[]
    let batchMap = new Map<string, { batch_number: string; expiry_date: string | null }>()

    if (batchIds.length > 0) {
      const { data: batches } = await db
        .from("pharmacy_item_batches")
        .select("id, batch_number, expiry_date")
        .in("id", batchIds)
      if (batches) {
        batchMap = new Map((batches as Array<{ id: string; batch_number: string; expiry_date: string | null }>).map((b) => [b.id, { batch_number: b.batch_number, expiry_date: b.expiry_date }]))
      }
    }

    const movements = (data ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      pharmacy_item_batches: m.batch_id ? batchMap.get(m.batch_id as string) ?? null : null,
    }))

    return NextResponse.json({ movements })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تحميل حركة الصنف"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
