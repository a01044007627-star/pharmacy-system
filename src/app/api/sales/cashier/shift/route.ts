import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

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
    const { data, error: rpcError } = await db.rpc("open_cashier_shift_v1", {
      p_pharmacy_id: scope.activePharmacyId!,
      p_branch_id: branchId!,
      p_actor_id: scope.user!.id,
      p_opening_balance: Math.max(0, n(body.opening_balance)),
      p_notes: clean(body.notes) || null,
      p_client_request_id: clean(body.client_request_id) || crypto.randomUUID(),
    })
    if (rpcError) throw rpcError
    const result = (data ?? {}) as { shift?: Record<string, unknown>; alreadyOpen?: boolean; duplicate?: boolean }
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId!, branchId, actorId: scope.user!.id,
      eventType: result.alreadyOpen ? "cashier.shift_restored" : "cashier.shift_opened",
      source: "cashier.shift", description: result.alreadyOpen ? "تم استرجاع وردية الكاشير المفتوحة" : "تم فتح وردية كاشير ذرية",
      metadata: { shift_id: result.shift?.id, duplicate: result.duplicate },
    })
    return NextResponse.json({ shift: result.shift ?? null, alreadyOpen: Boolean(result.alreadyOpen) }, { status: result.alreadyOpen ? 200 : 201 })
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
    const shiftId = clean(body.shift_id)
    if (!shiftId) return NextResponse.json({ error: "معرف الوردية مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data, error: rpcError } = await db.rpc("close_cashier_shift_v1", {
      p_pharmacy_id: scope.activePharmacyId!, p_branch_id: branchId!, p_shift_id: shiftId,
      p_actor_id: scope.user!.id, p_closing_balance: Math.max(0, n(body.closing_balance)), p_notes: clean(body.notes) || null,
    })
    if (rpcError) throw rpcError
    const result = (data ?? {}) as { shift?: Record<string, unknown>; duplicate?: boolean }
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId!, branchId, actorId: scope.user!.id,
      eventType: "cashier.shift_closed", source: "cashier.shift", description: "تم إغلاق وردية الكاشير وتسوية فرق الدرج",
      severity: Number(result.shift?.difference ?? 0) === 0 ? "info" : "warning",
      metadata: { shift_id: shiftId, difference: result.shift?.difference, duplicate: result.duplicate },
    })
    return NextResponse.json({ shift: result.shift ?? null, duplicate: Boolean(result.duplicate) })
  } catch (error) {
    console.error("cashier shift PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إغلاق جلسة الكاشير"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
