import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { requireActivePharmacy, scopeCan } from "@/lib/auth/server-permissions"

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

    const [balancesResult, transactionsResult] = await Promise.all([
      db.from("pharmacy_loyalty_balances").select("*, customer:pharmacy_customers(id,name,phone)").eq("pharmacy_id", pharmacyId).limit(100),
      db.from("pharmacy_loyalty_points").select("*, customer:pharmacy_customers(id,name,phone)").eq("pharmacy_id", pharmacyId).order("created_at", { ascending: false }).limit(100),
    ])

    if (balancesResult.error && balancesResult.error.code === "42P01") {
      return NextResponse.json({ balances: [], transactions: [] })
    }
    if (balancesResult.error) throw balancesResult.error
    if (transactionsResult.error && transactionsResult.error.code !== "42P01") throw transactionsResult.error

    return NextResponse.json({
      balances: balancesResult.data ?? [],
      transactions: transactionsResult.data ?? [],
    })
  } catch (error) {
    console.error("loyalty GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل بيانات الولاء"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
