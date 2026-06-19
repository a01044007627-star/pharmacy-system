import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function n(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

async function resolveScope(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url)
  const requestedPharmacyId = clean(body?.pharmacy_id) || url.searchParams.get("pharmacy_id")
  const requestedBranchId = clean(body?.branch_id) || url.searchParams.get("branch_id")
  const scope = await getServerAuthScope({
    requestedPharmacyId,
    requestedBranchId: requestedBranchId === "all" ? null : requestedBranchId,
  })
  if (!scope.user) return { scope, error: NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 }) }
  if (!scope.activePharmacyId) return { scope, error: NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 }) }
  if (!scopeCan(scope, "sales:read") && !scopeCan(scope, "sales:write")) {
    return { scope, error: NextResponse.json({ error: "ليست لديك صلاحية الكاشير" }, { status: 403 }) }
  }
  const branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : scope.activeBranchId
  if (!branchId) return { scope, error: NextResponse.json({ error: "اختر فرعًا قبل تشغيل الكاشير" }, { status: 400 }) }
  assertBranchScope(scope, branchId)
  return { scope, branchId, error: null }
}

async function getOpenShift(db: SupabaseClient, pharmacyId: string, branchId: string, userId: string) {
  const { data, error } = await db
    .from("pharmacy_shifts")
    .select("id, pharmacy_id, branch_id, user_id, opened_at, closed_at, opening_balance, closing_balance, expected_balance, difference, cash_sales, card_sales, credit_sales, total_collected, total_expenses, status, notes")
    .eq("pharmacy_id", pharmacyId)
    .eq("branch_id", branchId)
    .eq("user_id", userId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(request: Request) {
  try {
    const { scope, branchId, error } = await resolveScope(request)
    if (error) return error

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const openShift = await getOpenShift(db, scope.activePharmacyId!, branchId!, scope.user!.id)

    return NextResponse.json({
      openShift: openShift ?? null,
      pharmacyId: scope.activePharmacyId,
      branchId,
    })
  } catch (error) {
    console.error("cashier shift GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل جلسة الكاشير"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const { scope, branchId, error } = await resolveScope(request, body)
    if (error) return error
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية فتح الكاشير" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId!
    const existing = await getOpenShift(db, pharmacyId, branchId!, scope.user!.id)
    if (existing) return NextResponse.json({ shift: existing, alreadyOpen: true })

    const openingBalance = Math.max(0, n(body.opening_balance))
    const { data: shift, error: insertError } = await db
      .from("pharmacy_shifts")
      .insert({
        pharmacy_id: pharmacyId,
        branch_id: branchId,
        user_id: scope.user!.id,
        opening_balance: Number(openingBalance.toFixed(2)),
        expected_balance: Number(openingBalance.toFixed(2)),
        notes: clean(body.notes) || null,
        status: "open",
      })
      .select("id, pharmacy_id, branch_id, user_id, opened_at, closed_at, opening_balance, closing_balance, expected_balance, difference, cash_sales, card_sales, credit_sales, total_collected, total_expenses, status, notes")
      .single()
    if (insertError) {
      if ((insertError as { code?: string }).code === "23505") {
        const reopened = await getOpenShift(db, pharmacyId, branchId!, scope.user!.id)
        if (reopened) return NextResponse.json({ shift: reopened, alreadyOpen: true })
      }
      throw insertError
    }

    return NextResponse.json({ shift }, { status: 201 })
  } catch (error) {
    console.error("cashier shift POST failed", error)
    const message = error instanceof Error ? error.message : "فشل فتح جلسة الكاشير"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const { scope, branchId, error } = await resolveScope(request, body)
    if (error) return error
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية إغلاق الكاشير" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId!
    const shiftId = clean(body.shift_id)
    const openShift = shiftId
      ? (await db
        .from("pharmacy_shifts")
        .select("id, expected_balance")
        .eq("id", shiftId)
        .eq("pharmacy_id", pharmacyId)
        .eq("branch_id", branchId!)
        .eq("user_id", scope.user!.id)
        .eq("status", "open")
        .maybeSingle()).data
      : await getOpenShift(db, pharmacyId, branchId!, scope.user!.id)

    if (!openShift) return NextResponse.json({ error: "لا توجد جلسة كاشير مفتوحة" }, { status: 400 })

    const closingBalance = Math.max(0, n(body.closing_balance))
    const expected = n((openShift as any).expected_balance)
    const { data: shift, error: updateError } = await db
      .from("pharmacy_shifts")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_balance: Number(closingBalance.toFixed(2)),
        difference: Number((closingBalance - expected).toFixed(2)),
        notes: clean(body.notes) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (openShift as any).id)
      .select("id, pharmacy_id, branch_id, user_id, opened_at, closed_at, opening_balance, closing_balance, expected_balance, difference, cash_sales, card_sales, credit_sales, total_collected, total_expenses, status, notes")
      .single()
    if (updateError) throw updateError

    return NextResponse.json({ shift })
  } catch (error) {
    console.error("cashier shift PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إغلاق جلسة الكاشير"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
