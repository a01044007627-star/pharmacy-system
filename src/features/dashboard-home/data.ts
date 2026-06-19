import {
  AlertTriangle,
  DollarSign,
  FileText,
  RefreshCw,
  ShoppingCart,
  Wallet,
} from "lucide-react"
import type { DashboardChartData, DashboardHomePayload, DashboardKpi, DashboardTablesPayload } from "./types"

export const dashboardKpiDefinitions: Omit<DashboardKpi, "value" | "hint">[] = [
  {
    id: "sales-total",
    label: "إجمالي المبيعات",
    tone: "blue",
    icon: ShoppingCart,
    info: "إجمالي فواتير البيع بعد الخصومات للفترة المحددة.",
  },
  {
    id: "net-income",
    label: "صافي الدخل",
    tone: "green",
    icon: DollarSign,
    info: "صافي الدخل = إجمالي المبيعات المحصلة - المصروفات خلال الفترة المحددة.",
    opensDailyProfit: true,
  },
  {
    id: "pending-sales",
    label: "المبيعات المستحقة",
    tone: "amber",
    icon: FileText,
    info: "إجمالي فواتير البيع الآجلة أو غير المحصلة بالكامل.",
  },
  {
    id: "sales-returns",
    label: "إجمالي مرجع المبيعات",
    tone: "red",
    icon: RefreshCw,
    info: "إجمالي مرتجعات البيع خلال الفترة المحددة.",
  },
  {
    id: "purchases-total",
    label: "إجمالي المشتريات",
    tone: "cyan",
    icon: FileText,
    info: "إجمالي فواتير الشراء خلال الفترة المحددة.",
  },
  {
    id: "pending-purchases",
    label: "المشتريات المستحقة",
    tone: "amber",
    icon: AlertTriangle,
    info: "إجمالي مبالغ الموردين غير المسددة بالكامل.",
  },
  {
    id: "purchase-returns",
    label: "إجمالي مرجع المشتريات",
    tone: "red",
    icon: FileText,
    info: "إجمالي مرتجعات الشراء خلال الفترة المحددة.",
  },
  {
    id: "expenses-total",
    label: "مصروف",
    tone: "red",
    icon: Wallet,
    info: "إجمالي المصروفات التشغيلية المسجلة.",
  },
]

export const emptyChart = (title: string): DashboardChartData => ({
  title,
  unitLabel: "إجمالي المبيعات (EGP)",
  labels: [],
  series: [],
})

export const emptyTables: DashboardTablesPayload = {
  customerDebts: [],
  supplierDebts: [],
  stockWarning: [],
  expiryAlert: [],
  orders: [],
  purchaseRequests: [],
  pendingShipments: [],
}

export const emptyDashboardHomePayload: DashboardHomePayload = {
  generatedAt: new Date(0).toISOString(),
  dateFilter: "today",
  branchFilter: "all",
  kpis: dashboardKpiDefinitions.map((item) => ({ id: item.id, value: 0 })),
  salesLast30DaysChart: emptyChart("المبيعات في آخر 30 يوماً"),
  currentFinancialYearChart: emptyChart("السنة المالية الحالية"),
  tables: emptyTables,
}

export function mergeKpiValues(payload: DashboardHomePayload): DashboardKpi[] {
  const valueById = new Map(payload.kpis.map((item) => [item.id, item]))
  return dashboardKpiDefinitions.map((definition) => {
    const data = valueById.get(definition.id)
    return {
      ...definition,
      value: data?.value ?? 0,
      hint: data?.hint,
    }
  })
}
