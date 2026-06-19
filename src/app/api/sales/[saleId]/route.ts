import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

type SaleRouteContext = { params: Promise<{ saleId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function resolveSale(db: SupabaseClient, saleId: string, pharmacyId: string) {
  const { data, error } = await db
    .from("pharmacy_sales")
    .select("*, branch:pharmacy_branches(id,name,code)")
    .eq("id", saleId)
    .eq("pharmacy_id", pharmacyId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(_request: Request, context: SaleRouteContext) {
  try {
    const { saleId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المبيعات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const sale = await resolveSale(db, saleId, scope.activePharmacyId)
    if (!sale) return NextResponse.json({ error: "فاتورة البيع غير موجودة" }, { status: 404 })
    assertBranchScope(scope, sale.branch_id)

    const { data: lines, error: linesError } = await db
      .from("pharmacy_sale_lines")
      .select("id, sale_id, item_id, batch_id, item_name, barcode, unit, quantity, unit_price, purchase_price, discount, net_total, created_at, batch:pharmacy_item_batches(id,batch_number,expiry_date)")
      .eq("sale_id", saleId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: true })
    if (linesError) throw linesError

    return NextResponse.json({ sale, lines: lines ?? [] })
  } catch (error) {
    console.error("sale detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل فاتورة البيع"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: SaleRouteContext) {
  try {
    const { saleId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = clean(body.action)
    if (action !== "void") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })

    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:void")) return NextResponse.json({ error: "ليست لديك صلاحية إلغاء المبيعات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const sale = await resolveSale(db, saleId, scope.activePharmacyId)
    if (!sale) return NextResponse.json({ error: "فاتورة البيع غير موجودة" }, { status: 404 })
    assertBranchScope(scope, sale.branch_id)

    const { data, error } = await db.rpc("void_cashier_sale", {
      p_pharmacy_id: scope.activePharmacyId,
      p_sale_id: saleId,
      p_actor_id: scope.user.id,
      p_reason: clean(body.reason) || "إلغاء من سجل المبيعات",
    })
    if (error) throw error
    return NextResponse.json(data ?? { ok: true })
  } catch (error) {
    console.error("sale void PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إلغاء فاتورة البيع"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
