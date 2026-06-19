import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

type Context = { params: Promise<{ purchaseId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function GET(_request: Request, context: Context) {
  try {
    const { purchaseId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المشتريات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: purchase, error } = await db
      .from("pharmacy_purchases")
      .select("*,branch:pharmacy_branches(id,name,code),supplier:pharmacy_partners(id,name,phone,balance)")
      .eq("id", purchaseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!purchase) return NextResponse.json({ error: "فاتورة الشراء غير موجودة" }, { status: 404 })
    assertBranchScope(scope, purchase.branch_id)

    const { data: lines, error: linesError } = await db
      .from("pharmacy_purchase_lines")
      .select("id,item_id,batch_id,item_name,unit,batch_number,expiry_date,quantity,buy_price,sell_price,discount,net_total,created_at")
      .eq("purchase_id", purchaseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at")
    if (linesError) throw linesError
    return NextResponse.json({ purchase, lines: lines ?? [] })
  } catch (error) {
    console.error("purchase detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل فاتورة الشراء"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { purchaseId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== "void") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "purchases:void")) return NextResponse.json({ error: "ليست لديك صلاحية إلغاء المشتريات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: purchase, error: purchaseError } = await db
      .from("pharmacy_purchases")
      .select("branch_id")
      .eq("id", purchaseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (purchaseError) throw purchaseError
    if (!purchase) return NextResponse.json({ error: "فاتورة الشراء غير موجودة" }, { status: 404 })
    assertBranchScope(scope, purchase.branch_id)

    const { data, error } = await db.rpc("void_received_purchase", {
      p_pharmacy_id: scope.activePharmacyId,
      p_purchase_id: purchaseId,
      p_actor_id: scope.user.id,
      p_reason: typeof body.reason === "string" ? body.reason.trim() : null,
    })
    if (error) throw error
    return NextResponse.json(data ?? { ok: true })
  } catch (error) {
    console.error("purchase void PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إلغاء فاتورة الشراء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
