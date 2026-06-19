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

export async function GET() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db.from("pharmacy_damaged_stock").select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)").eq("pharmacy_id", scope.activePharmacyId).order("created_at", { ascending: false }).limit(200)
    if (error) throw error
    return NextResponse.json({ records: data ?? [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل التوالف" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null, requestedBranchId: clean(body.branch_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:create")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const itemId = clean(body.item_id)
    if (!itemId) return NextResponse.json({ error: "اختر الصنف" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId
    const branchId = clean(body.branch_id) || scope.activeBranchId
    const now = new Date().toISOString()

    const { data, error } = await db.from("pharmacy_damaged_stock").insert({
      pharmacy_id: pharmacyId,
      branch_id: branchId,
      item_id: itemId,
      quantity: Math.max(0, Number(body.quantity) || 1),
      reason: clean(body.reason) || "تالف",
      notes: clean(body.notes) || null,
      recorded_by: scope.user.id,
      created_at: now,
      updated_at: now,
    }).select("*").maybeSingle()

    if (error) throw error
    return NextResponse.json({ record: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تسجيل التالف" }, { status: 400 })
  }
}
