import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { CashierShiftRepository } from "@/features/sales/server/cashier-shift-repository"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

type DatabaseError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }

function missingRpc(error: unknown, functionName: string) {
  const record = (error ?? {}) as DatabaseError
  const text = [record.message, record.details, record.hint].filter(Boolean).join(" ")
  return record.code === "PGRST202" || record.code === "42883"
    || new RegExp(`could not find.*${functionName}|function .*${functionName}.*does not exist`, "i").test(text)
}

function shiftFailure(error: unknown, functionName: string, fallback: string) {
  if (missingRpc(error, functionName)) {
    return NextResponse.json({
      error: "قاعدة البيانات غير محدثة لدورة الكاشير. شغّل supabase/final-repair.sql ثم أعد المحاولة",
      code: "CASHIER_DATABASE_UPGRADE_REQUIRED",
    }, { status: 503 })
  }
  const message = error instanceof Error ? error.message : fallback
  return NextResponse.json({ error: message }, { status: 400 })
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

export async function GET(request: Request) {
  try {
    const { scope, branchId, error } = await resolveScope(request)
    if (error) return error

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const repository = new CashierShiftRepository(db, scope.activePharmacyId!, branchId!, scope.user!.id)
    const requestedShiftId = new URL(request.url).searchParams.get("shift_id")
    const openShift = requestedShiftId
      ? await repository.findScopedById(requestedShiftId)
      : await repository.findOpenForActor()
    const snapshot = openShift ? await repository.snapshot(openShift) : null

    return NextResponse.json({
      openShift: openShift ?? null,
      snapshot,
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
    const repository = new CashierShiftRepository(db, scope.activePharmacyId!, branchId!, scope.user!.id)
    const shiftRecord = result.shift?.id ? await repository.findScopedById(String(result.shift.id)) : null
    const snapshot = shiftRecord ? await repository.snapshot(shiftRecord) : null
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId!, branchId, actorId: scope.user!.id,
      eventType: result.alreadyOpen ? "cashier.shift_restored" : "cashier.shift_opened",
      source: "cashier.shift", description: result.alreadyOpen ? "تم استرجاع وردية الكاشير المفتوحة" : "تم فتح وردية كاشير ذرية",
      metadata: { shift_id: result.shift?.id, duplicate: result.duplicate },
    })
    return NextResponse.json({ shift: result.shift ?? null, snapshot, alreadyOpen: Boolean(result.alreadyOpen) }, { status: result.alreadyOpen ? 200 : 201 })
  } catch (error) {
    console.error("cashier shift POST failed", error)
    return shiftFailure(error, "open_cashier_shift_v1", "فشل فتح جلسة الكاشير")
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
    const repository = new CashierShiftRepository(db, scope.activePharmacyId!, branchId!, scope.user!.id)
    const shiftRecord = result.shift?.id ? await repository.findScopedById(String(result.shift.id)) : null
    const snapshot = shiftRecord ? await repository.snapshot(shiftRecord) : null
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId!, branchId, actorId: scope.user!.id,
      eventType: "cashier.shift_closed", source: "cashier.shift", description: "تم إغلاق وردية الكاشير وتسوية فرق الدرج",
      severity: Number(result.shift?.difference ?? 0) === 0 ? "info" : "warning",
      metadata: { shift_id: shiftId, difference: result.shift?.difference, duplicate: result.duplicate },
    })
    return NextResponse.json({ shift: result.shift ?? null, snapshot, duplicate: Boolean(result.duplicate) })
  } catch (error) {
    console.error("cashier shift PATCH failed", error)
    return shiftFailure(error, "close_cashier_shift_v1", "فشل إغلاق جلسة الكاشير")
  }
}
