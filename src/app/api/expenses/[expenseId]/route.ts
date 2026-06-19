import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"

type Context = { params: Promise<{ expenseId: string }> }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function GET(_request: Request, context: Context) {
  try {
    const { expenseId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض المصروفات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: expense, error } = await db
      .from("pharmacy_expenses")
      .select("*,branch:pharmacy_branches(id,name,code)")
      .eq("id", expenseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (error) throw error
    if (!expense) return NextResponse.json({ error: "المصروف غير موجود" }, { status: 404 })
    assertBranchScope(scope, expense.branch_id)
    return NextResponse.json({ expense })
  } catch (error) {
    console.error("expense detail GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل المصروف"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { expenseId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== "void") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية إلغاء مصروفات" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: expense, error: expenseError } = await db
      .from("pharmacy_expenses")
      .select("branch_id")
      .eq("id", expenseId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .maybeSingle()
    if (expenseError) throw expenseError
    if (!expense) return NextResponse.json({ error: "المصروف غير موجود" }, { status: 404 })
    assertBranchScope(scope, expense.branch_id)

    const { error } = await db
      .from("pharmacy_expenses")
      .update({ voided_at: new Date().toISOString() })
      .eq("id", expenseId)
      .eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("expense void PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل إلغاء المصروف"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
