import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

type Context = { params: Promise<{ partnerId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: Request, context: Context) {
  try {
    const { partnerId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تسجيل مدفوعات الموردين والعملاء" }, { status: 403 })

    const amount = Math.max(0, Number(body.amount) || 0)
    if (amount <= 0) return NextResponse.json({ error: "المبلغ يجب أن يكون أكبر من صفر" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { data: partner, error: partnerError } = await db
      .from("pharmacy_partners")
      .select("id,type,name,balance")
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (partnerError) throw partnerError
    if (!partner) return NextResponse.json({ error: "جهة الاتصال غير موجودة" }, { status: 404 })

    const isSupplier = ["supplier", "both"].includes(String(partner.type))
    const direction = clean(body.direction) || (isSupplier ? "out" : "in")
    if (!["in", "out"].includes(direction)) return NextResponse.json({ error: "اتجاه الدفع غير صالح" }, { status: 400 })

    const sourceType = isSupplier ? "purchase" : "sale"
    const paymentMethod = clean(body.payment_method) || "cash"
    const paymentDate = clean(body.payment_date) || new Date().toISOString()
    const reference = clean(body.reference) || null
    const notes = clean(body.notes) || null

    const { data: payment, error: paymentError } = await db
      .from("pharmacy_payments")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        branch_id: clean(body.branch_id) || scope.activeBranchId || null,
        source_table: "pharmacy_partners",
        source_id: partnerId,
        partner_id: partnerId,
        type: sourceType,
        direction,
        payment_method: paymentMethod,
        amount,
        reference,
        notes,
        payment_date: paymentDate,
        created_by: scope.user.id,
      })
      .select()
      .maybeSingle()
    if (paymentError) throw paymentError

    const balanceDelta = direction === "in" || direction === "out" ? -amount : 0
    const newBalance = Math.max(0, Number(partner.balance ?? 0) + balanceDelta)
    const { error: balanceError } = await db
      .from("pharmacy_partners")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)
    if (balanceError) throw balanceError

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: clean(body.branch_id) || scope.activeBranchId || null,
      actorId: scope.user.id,
      eventType: isSupplier ? "supplier.payment_recorded" : "customer.payment_recorded",
      source: "partners",
      description: isSupplier ? "تم تسجيل دفعة لمورد" : "تم تسجيل تحصيل من عميل",
      metadata: { partner_id: partnerId, amount, direction, payment_method: paymentMethod, new_balance: newBalance, payment_id: payment?.id },
    })

    return NextResponse.json({ payment, partner: { ...partner, balance: newBalance } }, { status: 201 })
  } catch (error) {
    console.error("partner payment POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تسجيل الدفعة"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
