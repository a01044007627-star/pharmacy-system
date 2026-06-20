import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Money } from "@/domain/shared/decimal-value"
import type {
  CashierShiftMetrics,
  CashierShiftRecentSale,
  CashierShiftRecord,
  CashierShiftSnapshot,
} from "@/features/sales/types/cashier-session"

type SaleRow = {
  id: string
  invoice_number: string
  customer_name: string | null
  total: number | string | null
  paid_amount: number | string | null
  due_amount: number | string | null
  discount_total: number | string | null
  payment_method: string | null
  sale_date: string
}

type ExpenseRow = {
  id: string
  total: number | string | null
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function moneySum<T>(rows: T[], selector: (row: T) => unknown) {
  return rows.reduce((total, row) => total.add(selector(row) as number | string | null | undefined), Money.zero()).toNumber()
}

function minutesBetween(start: string, end?: string | null) {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  return Math.floor((endMs - startMs) / 60_000)
}

/**
 * Read model for the cashier shift. The persisted shift totals remain the
 * source of truth, while document rows are used to provide an auditable live
 * session view and recent invoice navigation.
 */
export class CashierShiftRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
    private readonly branchId: string,
    private readonly actorId: string,
  ) {}

  async findOpenForActor(): Promise<CashierShiftRecord | null> {
    const { data, error } = await this.db
      .from("pharmacy_shifts")
      .select("id,pharmacy_id,branch_id,user_id,opened_at,closed_at,opening_balance,closing_balance,expected_balance,difference,cash_sales,card_sales,credit_sales,total_collected,total_expenses,status,notes")
      .eq("pharmacy_id", this.pharmacyId)
      .eq("branch_id", this.branchId)
      .eq("user_id", this.actorId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data ?? null) as CashierShiftRecord | null
  }

  async findScopedById(shiftId: string): Promise<CashierShiftRecord | null> {
    const { data, error } = await this.db
      .from("pharmacy_shifts")
      .select("id,pharmacy_id,branch_id,user_id,opened_at,closed_at,opening_balance,closing_balance,expected_balance,difference,cash_sales,card_sales,credit_sales,total_collected,total_expenses,status,notes")
      .eq("id", shiftId)
      .eq("pharmacy_id", this.pharmacyId)
      .eq("branch_id", this.branchId)
      .maybeSingle()
    if (error) throw error
    return (data ?? null) as CashierShiftRecord | null
  }

  async snapshot(shift: CashierShiftRecord): Promise<CashierShiftSnapshot> {
    const salesRequest = this.db
      .from("pharmacy_sales")
      .select("id,invoice_number,customer_name,total,paid_amount,due_amount,discount_total,payment_method,sale_date")
      .eq("pharmacy_id", this.pharmacyId)
      .eq("branch_id", this.branchId)
      .eq("shift_id", shift.id)
      .is("voided_at", null)
      .order("sale_date", { ascending: false })

    const expensesRequest = this.db
      .from("pharmacy_expenses")
      .select("id,total")
      .eq("pharmacy_id", this.pharmacyId)
      .eq("branch_id", this.branchId)
      .eq("shift_id", shift.id)
      .is("voided_at", null)

    const [salesResult, expensesResult] = await Promise.all([salesRequest, expensesRequest])

    // shift_id was added to sales/expenses in repair migrations. A partially
    // upgraded database must not take down the cashier screen; persisted shift
    // totals still provide a safe operational summary until the repair runs.
    // upgraded database can still show a useful session from the durable shift
    // totals instead of failing the whole cashier screen.
    const expenseRows = expensesResult.error ? [] : ((expensesResult.data ?? []) as ExpenseRow[])
    const sales = salesResult.error ? [] : ((salesResult.data ?? []) as SaleRow[])
    const openingBalance = number(shift.opening_balance)
    const persistedExpected = number(shift.expected_balance, openingBalance)
    const persistedExpenses = number(shift.total_expenses)
    const expensesTotal = expenseRows.length > 0 ? moneySum(expenseRows, (row) => row.total) : persistedExpenses

    const byPayment = (method: string) => moneySum(
      sales.filter((sale) => String(sale.payment_method ?? "cash") === method),
      (sale) => sale.paid_amount,
    )

    const metrics: CashierShiftMetrics = {
      invoiceCount: sales.length,
      grossSales: Money.from(moneySum(sales, (sale) => sale.total)).add(moneySum(sales, (sale) => sale.discount_total)).toNumber(),
      discountTotal: moneySum(sales, (sale) => sale.discount_total),
      netSales: moneySum(sales, (sale) => sale.total),
      paidTotal: moneySum(sales, (sale) => sale.paid_amount),
      dueTotal: moneySum(sales, (sale) => sale.due_amount),
      cashCollected: byPayment("cash"),
      cardCollected: byPayment("card"),
      walletCollected: byPayment("wallet"),
      transferCollected: byPayment("bank-transfer"),
      mixedCollected: byPayment("mixed"),
      expenseCount: expenseRows.length,
      expensesTotal,
      openingBalance,
      expectedDrawer: persistedExpected,
      actualDrawer: shift.closing_balance == null ? null : number(shift.closing_balance),
      drawerDifference: shift.difference == null ? null : number(shift.difference),
      durationMinutes: minutesBetween(shift.opened_at, shift.closed_at),
      lastSaleAt: sales[0]?.sale_date ?? null,
    }

    const recentSales: CashierShiftRecentSale[] = sales.slice(0, 12).map((sale) => ({
      id: sale.id,
      invoice_number: sale.invoice_number,
      customer_name: sale.customer_name || "زبون نقدي",
      total: number(sale.total),
      paid_amount: number(sale.paid_amount),
      due_amount: number(sale.due_amount),
      payment_method: sale.payment_method || "cash",
      sale_date: sale.sale_date,
    }))

    return { shift, metrics, recentSales }
  }
}
