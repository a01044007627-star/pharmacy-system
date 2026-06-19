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
    const requestedTable = clean(url.searchParams.get("table"))
    const selectedTables = requestedTable && TABLES.includes(requestedTable) ? [requestedTable] : TABLES
    const results: Record<string, unknown[]> = {}

    for (const table of selectedTables) {
      if (table === "pharmacy_items") {
        const { data: audits, error: auditError } = await db
          .from("pharmacy_deleted_items_audit")
          .select("id,item_id,item_snapshot,deleted_by,deleted_at,restored_by,restored_at")
          .eq("pharmacy_id", pharmacyId)
          .order("deleted_at", { ascending: false })
          .limit(200)
        if (auditError) throw auditError
        results[table] = (audits ?? []).map((audit) => ({
          ...(audit.item_snapshot && typeof audit.item_snapshot === "object" ? audit.item_snapshot as Record<string, unknown> : {}),
          audit_id: audit.id,
          item_id: audit.item_id,
          deleted_by: audit.deleted_by,
          deleted_at: audit.deleted_at,
          restored_by: audit.restored_by,
          restored_at: audit.restored_at,
          deletion_state: audit.restored_at ? "restored" : "deleted",
        }))
        continue
      }

      const { data, error } = await db
        .from(table)
        .select("*")
        .eq("pharmacy_id", pharmacyId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(100)
      if (error) {
        console.warn(`[deleted-records] ${table} skipped:`, error.message)
        results[table] = []
      } else {
        results[table] = data ?? []
      }
    }

    return NextResponse.json({ records: results, tables: selectedTables })
  } catch (error) {
    console.error("deleted-records GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل السجلات المحذوفة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
