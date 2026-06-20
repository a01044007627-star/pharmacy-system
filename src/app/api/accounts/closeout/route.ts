import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const period = clean(body.period)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return NextResponse.json({ error: "الفترة غير صالحة؛ استخدم YYYY-MM" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const { data, error } = await db.rpc("close_accounting_period_v1", {
      p_pharmacy_id: scope.activePharmacyId,
      p_period: period,
      p_actor_id: scope.user.id,
    })
    if (error) throw error

    const result = (data ?? {}) as Record<string, unknown>
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "accounting.period_closed",
      source: "accounts.closeout",
      description: `تم إقفال الفترة المحاسبية ${period} بقيد ذري متوازن`,
      severity: "warning",
      metadata: result,
    })

    return NextResponse.json({
      entry: result.entry_id ? {
        id: result.entry_id,
        entry_number: result.entry_number ?? `CLS-${period.replace("-", "")}`,
      } : null,
      summary: {
        period,
        total_income: Number(result.total_income ?? 0),
        total_expenses: Number(result.total_expenses ?? 0),
        net_profit: Number(result.net_profit ?? 0),
        total_debit: Number(result.total_debit ?? 0),
        total_credit: Number(result.total_credit ?? 0),
        lines_count: Number(result.lines_count ?? 0),
        duplicate: Boolean(result.duplicate),
      },
    }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("closeout POST failed", error)
    const message = error instanceof Error ? error.message : "فشل الإقفال الحسابي"
    const status = /صلاحية|الدخول/.test(message) ? 403 : /الفترة|حركات|حساب/.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
