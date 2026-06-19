import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export type MoneyValue = number

export type DashboardTone = "blue" | "green" | "amber" | "red" | "purple" | "cyan" | "slate"

export type DashboardDateFilter =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "lastYear"
  | "fiscalYear"

export interface DashboardKpi {
  id: string
  label: string
  value: MoneyValue
  hint?: string
  tone: DashboardTone
  icon: LucideIcon
  info?: string
  opensDailyProfit?: boolean
}

export interface DashboardKpiPayload {
  id: string
  value: MoneyValue
  hint?: string
}

export interface DashboardChartSeries {
  id: string
  label: string
  color: string
  values: number[]
}

export interface DashboardChartData {
  title: string
  unitLabel: string
  labels: string[]
  series: DashboardChartSeries[]
}

export interface DashboardTableColumn<T> {
  key: keyof T | string
  header: string
  className?: string
  render?: (row: T, index: number) => ReactNode
}

export interface DashboardTableConfig<T> {
  id: string
  title: string
  tone: DashboardTone
  icon: LucideIcon
  info?: string
  rows: T[]
  columns: DashboardTableColumn<T>[]
  searchPlaceholder?: string
  defaultPageSize?: number
  compact?: boolean
  className?: string
}

export interface CustomerDebtRow {
  id: string
  customer: string
  invoiceNo: string
  dueAmount: number
}

export interface SupplierDebtRow {
  id: string
  supplier: string
  referenceNo: string
  dueAmount: number
}

export interface StockWarningRow {
  id: string
  item: string
  branch: string
  currentStock: string
}

export interface ExpiryAlertRow {
  id: string
  item: string
  branch: string
  remainingStock: string
  expiresAt: string
}

export interface SalesOrderRow {
  id: string
  option: string
  date: string
  orderNo: string
  customer: string
  phone: string
  branch: string
  status: string
  shippingStatus: string
  remainingQty: string
  addedBy: string
}

export interface PurchaseRequestRow {
  id: string
  option: string
  date: string
  referenceNo: string
  branch: string
  supplier: string
  status: string
  remainingQty: string
  addedBy: string
}

export interface PendingShipmentRow {
  id: string
  option: string
  date: string
  invoiceNo: string
  customer: string
  phone: string
  branch: string
  shippingStatus: string
  paymentStatus: string
}

export interface DashboardTablesPayload {
  customerDebts: CustomerDebtRow[]
  supplierDebts: SupplierDebtRow[]
  stockWarning: StockWarningRow[]
  expiryAlert: ExpiryAlertRow[]
  orders: SalesOrderRow[]
  purchaseRequests: PurchaseRequestRow[]
  pendingShipments: PendingShipmentRow[]
}

export interface DashboardHomePayload {
  generatedAt: string
  dateFilter: DashboardDateFilter
  branchFilter: string
  kpis: DashboardKpiPayload[]
  salesLast30DaysChart: DashboardChartData
  currentFinancialYearChart: DashboardChartData
  tables: DashboardTablesPayload
}
