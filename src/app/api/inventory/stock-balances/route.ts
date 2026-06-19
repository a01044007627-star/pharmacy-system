import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
      requestedBranchId: clean(url.searchParams.get("branch_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    let branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)
    if (!branchId || branchId === "all") {
      if (isBranchScoped(scope)) {
        branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id ?? scope.activeBranchId ?? ""
      } else { branchId = "" }
    }

    const query = safeSearch(clean(url.searchParams.get("query")))
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500)

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    let dbQuery = db
      .from("pharmacy_stock_balances")
      .select("*,item:pharmacy_items(id,name_ar,sku,unit),branch:pharmacy_branches(id,name,code)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("quantity", { ascending: false })
      .limit(limit)

    if (branchId) dbQuery = dbQuery.eq("branch_id", branchId)
    if (query) dbQuery = dbQuery.textSearch("item_id", query, { type: "plain" })

    const { data, error, count } = await dbQuery
    if (error) throw error

    const rows = data ?? []
    const summary = {
      total_items: count ?? rows.length,
      total_quantity: rows.reduce((acc, row) => acc + Number(row.quantity ?? 0), 0),
      out_of_stock: rows.filter((row) => Number(row.quantity) <= 0).length,
    }

    return NextResponse.json({ records: rows, summary })
  } catch (error) {
    console.error("stock-balances GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الأرصدة" }, { status: 500 })
  }
}
