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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db
      .from("pharmacy_cash_registers")
      .select("*,branch:pharmacy_branches(id,name,code)")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) throw error
    return NextResponse.json({ registers: data ?? [] })
  } catch (error) {
    console.error("cash-registers GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الخزائن" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const name = clean(body.name)
    if (!name) return NextResponse.json({ error: "اسم الخزنة مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()

    const { data, error } = await db.from("pharmacy_cash_registers").insert({
      pharmacy_id: pharmacyId,
      branch_id: clean(body.branch_id) || scope.activeBranchId,
      name,
      opening_balance: Number(body.opening_balance) || 0,
      closing_balance: Number(body.opening_balance) || 0,
      status: "open",
      created_at: now,
      updated_at: now,
    }).select("*,branch:pharmacy_branches(id,name,code)").maybeSingle()

    if (error) throw error
    return NextResponse.json({ register: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة الخزنة" }, { status: 400 })
  }
}
