export type ExtraReportKind =
  | "inventory"
  | "inventoryCount"
  | "popularItems"
  | "itemMovement"
  | "payments"
  | "receipts"
  | "customerGroups"
  | "taxSummary"
  | "employeeActivity"

export type Primitive = string | number | boolean | null | undefined

export type ReportRow = Record<string, Primitive>

export type ReportColumn = {
  key: string
  label: string
  type?: "text" | "money" | "number" | "date" | "percent" | "badge"
  className?: string
}

export type Metric = {
  label: string
  value: number
  type?: "money" | "number" | "percent"
  tone?: "blue" | "green" | "amber" | "red" | "slate"
}

export type PreparedReport = {
  title: string
  subtitle: string
  primaryMetric?: string
  metrics: Metric[]
  columns: ReportColumn[]
  rows: ReportRow[]
  totals?: Record<string, number>
  emptyText: string
}

export type AccountingRecord = {
  id: string
  [key: string]: unknown
}

export type UserRecord = {
  id: string
  [key: string]: unknown
}

export type ExtraReportsData = {
  items: AccountingRecord[]
  sales: AccountingRecord[]
  purchases: AccountingRecord[]
  salesReturns: AccountingRecord[]
  purchaseReturns: AccountingRecord[]
  purchaseExpenses: AccountingRecord[]
  cashTransactions: AccountingRecord[]
  inventoryLedger: AccountingRecord[]
  customers: AccountingRecord[]
  suppliers: AccountingRecord[]
  customerGroups: UserRecord[]
  cashierSessions: UserRecord[]
  employees: UserRecord[]
}
