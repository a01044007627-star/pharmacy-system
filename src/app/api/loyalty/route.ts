import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { requireActivePharmacy, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "loyalty:read") && !scope.isDeveloper) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)
    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const [balancesResult, transactionsResult, customersResult] = await Promise.all([
      db.from("pharmacy_loyalty_balances")
        .select("id,partner_id,total_earned,total_redeemed,total_expired,current_balance,updated_at,partner:pharmacy_partners!inner(id,name,phone,email,status,type)")
        .eq("pharmacy_id", pharmacyId).in("partner.type", ["customer", "both"]).order("current_balance", { ascending: false }).limit(500),
      db.from("pharmacy_loyalty_transactions")
        .select("id,partner_id,type,points,reference,notes,balance_after,source_table,source_id,created_at,partner:pharmacy_partners!inner(id,name,phone,type)")
        .eq("pharmacy_id", pharmacyId).in("partner.type", ["customer", "both"]).order("created_at", { ascending: false }).limit(500),
      db.from("pharmacy_partners").select("id,name,phone,email,type,status").eq("pharmacy_id", pharmacyId)
        .in("type", ["customer", "both"]).eq("status", "active").order("name").limit(1000),
    ])
    if (balancesResult.error) throw balancesResult.error
    if (transactionsResult.error) throw transactionsResult.error
    if (customersResult.error) throw customersResult.error

    return NextResponse.json({ balances: balancesResult.data ?? [], transactions: transactionsResult.data ?? [], customers: customersResult.data ?? [] })
  } catch (error) {
    console.error("loyalty GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل بيانات الولاء"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "loyalty:write") && !scopeCan(scope, "crm:write") && !scope.isDeveloper) {
      return NextResponse.json({ error: "ليست لديك صلاحية تعديل نقاط الولاء" }, { status: 403 })
    }
    const pharmacyId = requireActivePharmacy(scope)
    const partnerId = clean(body.partner_id)
    const operation = clean(body.operation)
    const points = Math.trunc(Math.abs(Number(body.points) || 0))
    if (!partnerId) return NextResponse.json({ error: "اختر العميل" }, { status: 400 })
    if (!points) return NextResponse.json({ error: "أدخل عدد نقاط صحيح" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error } = await db.rpc("adjust_loyalty_balance_v1", {
      p_pharmacy_id: pharmacyId,
      p_partner_id: partnerId,
      p_actor_id: scope.user.id,
      p_operation: operation,
      p_points: points,
      p_reference: clean(body.reference) || null,
      p_notes: clean(body.notes) || null,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
    })
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId,
      actorId: scope.user.id,
      eventType: "loyalty.adjusted",
      source: "loyalty",
      description: "تم تسجيل حركة نقاط ولاء",
      metadata: { partner_id: partnerId, operation, points, result: data },
    })
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("loyalty POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تسجيل حركة الولاء"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
