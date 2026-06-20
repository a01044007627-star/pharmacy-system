export type CashierShiftRecord = {
  id: string
  pharmacy_id?: string | null
  branch_id?: string | null
  user_id?: string | null
  opened_at: string
  closed_at?: string | null
  opening_balance: number | string | null
  closing_balance?: number | string | null
  expected_balance: number | string | null
  difference?: number | string | null
  cash_sales: number | string | null
  card_sales: number | string | null
  credit_sales: number | string | null
  total_collected: number | string | null
  total_expenses: number | string | null
  status: "open" | "closed"
  notes?: string | null
}

export type CashierShiftRecentSale = {
  id: string
  invoice_number: string
  customer_name: string
  total: number
  paid_amount: number
  due_amount: number
  payment_method: string
  sale_date: string
}

export type CashierShiftMetrics = {
  invoiceCount: number
  grossSales: number
  discountTotal: number
  netSales: number
  paidTotal: number
  dueTotal: number
  cashCollected: number
  cardCollected: number
  walletCollected: number
  transferCollected: number
  mixedCollected: number
  expenseCount: number
  expensesTotal: number
  openingBalance: number
  expectedDrawer: number
  actualDrawer: number | null
  drawerDifference: number | null
  durationMinutes: number
  lastSaleAt: string | null
}

export type CashierShiftSnapshot = {
  shift: CashierShiftRecord
  metrics: CashierShiftMetrics
  recentSales: CashierShiftRecentSale[]
}
