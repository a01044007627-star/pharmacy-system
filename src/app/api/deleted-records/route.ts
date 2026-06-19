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

const TABLES = ["pharmacy_items", "pharmacy_purchases", "pharmacy_sales", "pharmacy_partners", "pharmacy_employees"]

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "deleted-records:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })
    const pharmacyId = requireActivePharmacy(scope)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const table = clean(url.searchParams.get("table"))

    const results: Record<string, unknown[]> = {}

    if (table && TABLES.includes(table)) {
      const { data } = await db.from(table).select("*").eq("pharmacy_id", pharmacyId).is("voided_at", null).limit(0)
      results[table] = []
      return NextResponse.json({ records: results, tables: [table] })
    }

    for (const t of TABLES) {
      try {
        const hasDeleted = await db.from(t).select("id").eq("pharmacy_id", pharmacyId).not("deleted_at", "is", null).limit(5)
        if (hasDeleted.data && hasDeleted.data.length > 0) {
          const { data } = await db.from(t).select("*").eq("pharmacy_id", pharmacyId).not("deleted_at", "is", null).limit(50)
          results[t] = data ?? []
        }
      } catch {
        results[t] = []
      }
    }

    return NextResponse.json({ records: results, tables: TABLES })
  } catch (error) {
    console.error("deleted-records GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل السجلات المحذوفة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
