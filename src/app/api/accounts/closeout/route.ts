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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const period = clean(body.period)
    if (!period) return NextResponse.json({ error: "الفترة مطلوبة (مثال: 2026-06)" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()

    const entryNumber = `CLS-${period.replace("-", "")}-${Date.now().toString(36).toUpperCase()}`

    const { data: incomeAccounts } = await db.from("pharmacy_chart_of_accounts").select("id,name,code").eq("pharmacy_id", pharmacyId).eq("type", "income").eq("is_active", true)
    const { data: expenseAccounts } = await db.from("pharmacy_chart_of_accounts").select("id,name,code").eq("pharmacy_id", pharmacyId).eq("type", "expense").eq("is_active", true)

    const { data: incomeBalances } = await db.from("pharmacy_account_balances")
      .select("account_id,closing_credit")
      .eq("pharmacy_id", pharmacyId)
      .eq("period", period)
      .in("account_id", incomeAccounts?.map((a) => a.id) ?? [])

    const { data: expenseBalances } = await db.from("pharmacy_account_balances")
      .select("account_id,closing_debit")
      .eq("pharmacy_id", pharmacyId)
      .eq("period", period)
      .in("account_id", expenseAccounts?.map((a) => a.id) ?? [])

    const totalIncome = (incomeBalances ?? []).reduce((sum, r) => sum + Number(r.closing_credit ?? 0), 0)
    const totalExpenses = (expenseBalances ?? []).reduce((sum, r) => sum + Number(r.closing_debit ?? 0), 0)
    const netProfit = totalIncome - totalExpenses

    const lines = []

    if (totalIncome > 0) {
      lines.push({
        account_id: incomeAccounts?.[0]?.id ?? null,
        debit: 0,
        credit: totalIncome,
        description: "إقفال إيرادات الفترة",
      })
    }

    if (totalExpenses > 0) {
      lines.push({
        account_id: expenseAccounts?.[0]?.id ?? null,
        debit: totalExpenses,
        credit: 0,
        description: "إقفال مصروفات الفترة",
      })
    }

    if (netProfit !== 0) {
      lines.push({
        account_id: null,
        debit: netProfit > 0 ? netProfit : 0,
        credit: netProfit < 0 ? Math.abs(netProfit) : 0,
        description: netProfit > 0 ? "صافي الربح" : "صافي الخسارة",
      })
    }

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0)
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0)

    const { data: entry, error: entryError } = await db.from("pharmacy_journal_entries").insert({
      pharmacy_id: pharmacyId,
      entry_number: entryNumber,
      entry_date: now.slice(0, 10),
      description: `إقفال حسابي للفترة ${period}`,
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: scope.user.id,
      created_at: now,
    }).select("*").maybeSingle()

    if (entryError) throw entryError

    if (lines.length > 0 && entry) {
      const { error: linesError } = await db.from("pharmacy_journal_lines").insert(
        lines.map((line) => ({ ...line, entry_id: entry.id })),
      )
      if (linesError) throw linesError
    }

    return NextResponse.json({
      entry: entry ?? null,
      summary: {
        period,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        lines_count: lines.length,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("closeout POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل الإقفال الحسابي" }, { status: 500 })
  }
}
