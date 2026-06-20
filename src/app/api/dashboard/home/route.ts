import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { resolveDashboardDateRange, isoDate, isoDateTime, listDays, monthStarts, formatDayLabel, formatMonthLabel } from "@/features/dashboard-home/lib/date-range"
import type {
  CustomerDebtRow,
  DashboardChartData,
  DashboardDateFilter,
  DashboardHomePayload,
  ExpiryAlertRow,
  PendingShipmentRow,
  PurchaseRequestRow,
  SalesOrderRow,
  StockWarningRow,
  SupplierDebtRow,
} from "@/features/dashboard-home/types"

const DASHBOARD_FILTERS = new Set<DashboardDateFilter>([
  "today",
  "yesterday",
  "week",
  "month",
  "thisMonth",
  "lastMonth",
  "thisYear",
  "lastYear",
  "fiscalYear",
])

const SERIES_COLORS = ["#0ea5e9", "#334155", "#22c55e", "#f59e0b"]
const SERVER_CACHE_TTL_MS = 45_000
const serverCache = new Map<string, { expiresAt: number; payload: DashboardHomePayload }>()

type DashboardRelatedRow = {
  id?: string | null
  name?: string | null
  name_ar?: string | null
  unit?: string | null
  min_stock?: number | string | null
  status?: string | null
}

type DashboardRow = Record<string, unknown> & {
  id?: string | number | null
  branch_id?: string | null
  sale_date?: string | null
  created_at?: string | null
  expected_date?: string | null
  expiry_date?: string | null
  total?: number | string | null
  due_amount?: number | string | null
  quantity?: number | string | null
  remaining_quantity?: number | string | null
  customer_name?: string | null
  supplier_name?: string | null
  invoice_number?: string | null
  purchase_number?: string | null
  order_number?: string | null
  payment_status?: string | null
  status?: string | null
  unit?: string | null
  item?: DashboardRelatedRow | DashboardRelatedRow[] | null
  branch?: DashboardRelatedRow | DashboardRelatedRow[] | null
}

type EqualityFilterBuilder = {
  eq(column: string, value: unknown): EqualityFilterBuilder
}

type DashboardQueryResult = {
  data: unknown[] | null
  error: { message: string } | null
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function sumRows(rows: DashboardRow[] | null | undefined, key: string) {
  return (rows ?? []).reduce((total, row) => total + numberValue(row[key]), 0)
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "معلق",
    confirmed: "مؤكد",
    preparing: "تجهيز",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    cancelled: "ملغي",
    returned: "مرتجع",
    approved: "معتمد",
    ordered: "تم الطلب",
    received: "تم الاستلام",
  }
  return labels[status ?? ""] ?? status ?? "—"
}

function paymentLabel(status?: string | null) {
  const labels: Record<string, string> = {
    unpaid: "غير مدفوع",
    partial: "جزئي",
    paid: "مدفوع",
    refunded: "مسترد",
  }
  return labels[status ?? ""] ?? status ?? "—"
}

function dateText(value?: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value))
}

function quantityText(quantity: unknown, unit?: string | null) {
  const qty = numberValue(quantity)
  const normalizedUnit = unit?.trim() || "وحدة"
  return `${qty.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${normalizedUnit}`
}

async function getDbClient(): Promise<SupabaseClient> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient() as SupabaseClient
  }
  return (await createClient()) as unknown as SupabaseClient
}

function applyPharmacyBranchScope<T>(query: T, pharmacyId: string, branchId: string | null, branchColumn = "branch_id"): T {
  let scoped = (query as unknown as EqualityFilterBuilder).eq("pharmacy_id", pharmacyId)
  if (branchId) scoped = scoped.eq(branchColumn, branchId)
  return scoped as unknown as T
}

function safeDateFilter(value: string | null): DashboardDateFilter {
  return value && DASHBOARD_FILTERS.has(value as DashboardDateFilter) ? (value as DashboardDateFilter) : "today"
}

function canUseAllBranches(scope: Awaited<ReturnType<typeof getServerAuthScope>>) {
  return scope.isDeveloper || scope.isOwner || ["owner", "admin", "manager", "accountant"].includes(scope.role)
}

function resolveRequestedBranch(scope: Awaited<ReturnType<typeof getServerAuthScope>>, branchParam: string | null) {
  if (!canUseAllBranches(scope)) return scope.activeBranchId
  if (!branchParam || branchParam === "all") return null
  const allowed = scope.branches.some((branch) => branch.id === branchParam)
  return allowed ? branchParam : null
}

function emptyPayload(dateFilter: DashboardDateFilter, branchFilter: string): DashboardHomePayload {
  return {
    generatedAt: new Date().toISOString(),
    dateFilter,
    branchFilter,
    kpis: [
      "sales-total",
      "net-income",
      "pending-sales",
      "sales-returns",
      "purchases-total",
      "pending-purchases",
      "purchase-returns",
      "expenses-total",
    ].map((id) => ({ id, value: 0 })),
    salesLast30DaysChart: { title: "المبيعات في آخر 30 يوماً", unitLabel: "إجمالي المبيعات (EGP)", labels: [], series: [] },
    currentFinancialYearChart: { title: "السنة المالية الحالية", unitLabel: "إجمالي المبيعات (EGP)", labels: [], series: [] },
    tables: {
      customerDebts: [],
      supplierDebts: [],
      stockWarning: [],
      expiryAlert: [],
      orders: [],
      purchaseRequests: [],
      pendingShipments: [],
    },
  }
}

async function readRows(query: PromiseLike<DashboardQueryResult>, label = "dashboard-query"): Promise<DashboardRow[]> {
  const { data, error } = await query
  if (error) {
    console.warn(`[dashboard/home] ${label} skipped:`, error.message)
    return []
  }
  return (data ?? []) as DashboardRow[]
}

function branchNameMap(scope: Awaited<ReturnType<typeof getServerAuthScope>>) {
  return new Map(scope.branches.map((branch) => [branch.id, `${branch.name}${branch.code ? ` (${branch.code})` : ""}`]))
}

function buildDailyChart(rows: DashboardRow[], branches: Awaited<ReturnType<typeof getServerAuthScope>>["branches"], selectedBranchId: string | null): DashboardChartData {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 29)
  const days = listDays(start, 30)
  const labels = days.map(formatDayLabel)
  const dateKeys = days.map(isoDate)
  const branchMap = new Map(branches.map((branch) => [branch.id, `${branch.name}${branch.code ? ` (${branch.code})` : ""}`]))

  const allowedBranchIds = selectedBranchId
    ? [selectedBranchId]
    : branches.slice(0, 2).map((branch) => branch.id)

  const valuesForBranch = (branchId: string | null) => dateKeys.map((key) => rows.reduce((total, row) => {
    const saleDate = isoDate(new Date(row.sale_date ?? 0))
    if (saleDate !== key) return total
    if (branchId && row.branch_id !== branchId) return total
    return total + numberValue(row.total)
  }, 0))

  const series = allowedBranchIds.map((branchId, index) => ({
    id: branchId,
    label: branchMap.get(branchId) ?? "فرع",
    color: SERIES_COLORS[index] ?? SERIES_COLORS[0],
    values: valuesForBranch(branchId),
  }))

  if (!selectedBranchId && branches.length > 1) {
    series.push({ id: "all", label: "كل الفروع", color: "#22c55e", values: valuesForBranch(null) })
  }

  if (series.length === 0) {
    series.push({ id: "all", label: "إجمالي المبيعات", color: "#22c55e", values: valuesForBranch(null) })
  }

  return { title: "المبيعات في آخر 30 يوماً", unitLabel: "إجمالي المبيعات (EGP)", labels, series }
}

function buildMonthlyChart(rows: DashboardRow[], branches: Awaited<ReturnType<typeof getServerAuthScope>>["branches"], selectedBranchId: string | null): DashboardChartData {
  const months = monthStarts(new Date().getFullYear())
  const labels = months.map(formatMonthLabel)
  const branchMap = new Map(branches.map((branch) => [branch.id, `${branch.name}${branch.code ? ` (${branch.code})` : ""}`]))
  const allowedBranchIds = selectedBranchId
    ? [selectedBranchId]
    : branches.slice(0, 2).map((branch) => branch.id)

  const valuesForBranch = (branchId: string | null) => months.map((month) => rows.reduce((total, row) => {
    const saleDate = new Date(row.sale_date ?? 0)
    if (saleDate.getFullYear() !== month.getFullYear() || saleDate.getMonth() !== month.getMonth()) return total
    if (branchId && row.branch_id !== branchId) return total
    return total + numberValue(row.total)
  }, 0))

  const series = allowedBranchIds.map((branchId, index) => ({
    id: branchId,
    label: branchMap.get(branchId) ?? "فرع",
    color: SERIES_COLORS[index] ?? SERIES_COLORS[0],
    values: valuesForBranch(branchId),
  }))

  if (!selectedBranchId && branches.length > 1) {
    series.push({ id: "all", label: "كل الفروع", color: "#22c55e", values: valuesForBranch(null) })
  }

  if (series.length === 0) {
    series.push({ id: "all", label: "إجمالي المبيعات", color: "#22c55e", values: valuesForBranch(null) })
  }

  return { title: "السنة المالية الحالية", unitLabel: "إجمالي المبيعات (EGP)", labels, series }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const dateFilter = safeDateFilter(url.searchParams.get("date_filter"))
    const branchParam = url.searchParams.get("branch_id")
    const refresh = url.searchParams.get("refresh") === "1"
    const includeTables = url.searchParams.get("tables") !== "0"
    const scope = await getServerAuthScope({ requestedBranchId: branchParam === "all" ? null : branchParam })

    if (!scope.user) {
      return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    }

    const pharmacyId = scope.activePharmacyId
    const selectedBranchId = resolveRequestedBranch(scope, branchParam)
    const branchFilter = selectedBranchId ?? "all"

    if (!pharmacyId) {
      return NextResponse.json(emptyPayload(dateFilter, branchFilter))
    }

    const cacheKey = [pharmacyId, selectedBranchId ?? "all", dateFilter, includeTables ? "full" : "summary"].join(":")
    const cached = serverCache.get(cacheKey)
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: {
          "x-dashboard-cache": "hit",
          "x-dashboard-mode": includeTables ? "full" : "summary",
          "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
        },
      })
    }

    const db = await getDbClient()
    const { start, end } = resolveDashboardDateRange(dateFilter)
    const startIso = isoDateTime(start)
    const endIso = isoDateTime(end)

    const chartStart = new Date()
    chartStart.setHours(0, 0, 0, 0)
    chartStart.setDate(chartStart.getDate() - 29)
    const yearStart = new Date(new Date().getFullYear(), 0, 1)
    const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1)
    const todayDate = isoDate(new Date())
    const expiryCutoff = new Date()
    expiryCutoff.setDate(expiryCutoff.getDate() + 90)

    const [
      salesRows,
      salesReturnsRows,
      purchasesRows,
      purchaseReturnsRows,
      expensesRows,
      salesChartRows,
      salesYearRows,
      customerDebtRows,
      supplierDebtRows,
      stockBalanceRows,
      expiryRows,
      orderRows,
      purchaseOrderRows,
      shipmentRows,
    ] = await Promise.all([
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_sales").select("total,due_amount,sale_date,branch_id").is("voided_at", null).gte("sale_date", startIso).lt("sale_date", endIso),
        pharmacyId,
        selectedBranchId,
      ), "sales-period"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_sales_returns").select("total,return_date,branch_id").is("voided_at", null).gte("return_date", startIso).lt("return_date", endIso),
        pharmacyId,
        selectedBranchId,
      ), "sales-returns-period"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_purchases").select("total,due_amount,purchase_date,branch_id").is("voided_at", null).gte("purchase_date", startIso).lt("purchase_date", endIso),
        pharmacyId,
        selectedBranchId,
      ), "purchases-period"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_purchase_returns").select("total,created_at,branch_id").gte("created_at", startIso).lt("created_at", endIso),
        pharmacyId,
        selectedBranchId,
      ), "purchase-returns-period"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_expenses").select("total,amount,expense_date,branch_id").is("voided_at", null).gte("expense_date", startIso).lt("expense_date", endIso),
        pharmacyId,
        selectedBranchId,
      ), "expenses-period"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_sales").select("total,sale_date,branch_id").is("voided_at", null).gte("sale_date", isoDateTime(chartStart)).lt("sale_date", isoDateTime(new Date())),
        pharmacyId,
        selectedBranchId,
      ), "sales-chart-30-days"),
      readRows(applyPharmacyBranchScope(
        db.from("pharmacy_sales").select("total,sale_date,branch_id").is("voided_at", null).gte("sale_date", isoDateTime(yearStart)).lt("sale_date", isoDateTime(yearEnd)),
        pharmacyId,
        selectedBranchId,
      ), "sales-chart-year"),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_sales").select("id,invoice_number,customer_name,due_amount,sale_date,branch_id").is("voided_at", null).gt("due_amount", 0).order("sale_date", { ascending: false }).limit(50),
        pharmacyId,
        selectedBranchId,
      ), "customer-debts") : Promise.resolve([]),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_purchases").select("id,purchase_number,supplier_name,due_amount,purchase_date,branch_id").is("voided_at", null).gt("due_amount", 0).order("purchase_date", { ascending: false }).limit(50),
        pharmacyId,
        selectedBranchId,
      ), "supplier-debts") : Promise.resolve([]),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_stock_balances").select("quantity,branch_id,item:pharmacy_items(id,name_ar,unit,min_stock,status),branch:pharmacy_branches(id,name,code)").limit(120),
        pharmacyId,
        selectedBranchId,
      ), "stock-warning") : Promise.resolve([]),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_item_batches").select("id,expiry_date,remaining_quantity,quantity,unit,branch_id,item:pharmacy_items(id,name_ar,unit,status),branch:pharmacy_branches(id,name,code)").gte("expiry_date", todayDate).lte("expiry_date", isoDate(expiryCutoff)).gt("remaining_quantity", 0).order("expiry_date", { ascending: true }).limit(60),
        pharmacyId,
        selectedBranchId,
      ), "expiry-alert") : Promise.resolve([]),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_orders").select("id,order_number,customer_name,total,due_amount,payment_status,status,created_at,branch_id").order("created_at", { ascending: false }).limit(60),
        pharmacyId,
        selectedBranchId,
      ), "orders") : Promise.resolve([]),
      includeTables ? readRows(
        db.from("pharmacy_purchase_orders").select("id,supplier_name,total,status,expected_date,created_at").eq("pharmacy_id", pharmacyId).in("status", ["draft", "sent", "partial"]).order("created_at", { ascending: false }).limit(60),
        "purchase-orders",
      ) : Promise.resolve([]),
      includeTables ? readRows(applyPharmacyBranchScope(
        db.from("pharmacy_orders").select("id,order_number,customer_name,total,due_amount,payment_status,status,created_at,branch_id").in("status", ["confirmed", "preparing", "shipped"]).order("created_at", { ascending: false }).limit(60),
        pharmacyId,
        selectedBranchId,
      ), "pending-shipments") : Promise.resolve([]),
    ])

    const salesTotal = sumRows(salesRows, "total")
    const pendingSales = sumRows(salesRows, "due_amount")
    const salesReturns = sumRows(salesReturnsRows, "total")
    const purchasesTotal = sumRows(purchasesRows, "total")
    const pendingPurchases = sumRows(purchasesRows, "due_amount")
    const purchaseReturns = sumRows(purchaseReturnsRows, "total")
    const expensesTotal = sumRows(expensesRows, "total") || sumRows(expensesRows, "amount")
    const netIncome = salesTotal - pendingSales - expensesTotal

    const branchesById = branchNameMap(scope)
    const customerDebts: CustomerDebtRow[] = customerDebtRows.map((row) => ({
      id: String(row.id),
      customer: row.customer_name ?? "زبون",
      invoiceNo: row.invoice_number ?? "—",
      dueAmount: numberValue(row.due_amount),
    }))

    const supplierDebts: SupplierDebtRow[] = supplierDebtRows.map((row) => ({
      id: String(row.id),
      supplier: row.supplier_name ?? "مورد",
      referenceNo: row.purchase_number ?? "—",
      dueAmount: numberValue(row.due_amount),
    }))

    const stockWarning: StockWarningRow[] = stockBalanceRows
      .map((row) => {
        const item = firstRelated<DashboardRelatedRow>(row.item)
        const branch = firstRelated<DashboardRelatedRow>(row.branch)
        const minStock = numberValue(item?.min_stock)
        const quantity = numberValue(row.quantity)
        if (!item || item.status === "inactive" || (minStock > 0 && quantity > minStock)) return null
        return {
          id: `${item.id}-${row.branch_id}`,
          item: item.name_ar ?? "صنف",
          branch: branch?.name ?? branchesById.get(row.branch_id ?? "") ?? "—",
          currentStock: quantityText(quantity, item.unit),
        }
      })
      .filter(Boolean)
      .slice(0, 100) as StockWarningRow[]

    const expiryAlert: ExpiryAlertRow[] = expiryRows.map((row) => {
      const item = firstRelated<DashboardRelatedRow>(row.item)
      const branch = firstRelated<DashboardRelatedRow>(row.branch)
      return {
        id: String(row.id),
        item: item?.name_ar ?? "صنف",
        branch: branch?.name ?? branchesById.get(row.branch_id ?? "") ?? "—",
        remainingStock: quantityText(row.remaining_quantity ?? row.quantity, row.unit ?? item?.unit),
        expiresAt: row.expiry_date ?? "—",
      }
    })

    const orders: SalesOrderRow[] = orderRows.map((row) => ({
      id: String(row.id),
      option: "",
      date: dateText(row.created_at),
      orderNo: row.order_number ?? "—",
      customer: row.customer_name ?? "عميل",
      phone: "—",
      branch: branchesById.get(row.branch_id ?? "") ?? "—",
      status: statusLabel(row.status),
      shippingStatus: statusLabel(row.status),
      remainingQty: "—",
      addedBy: "—",
    }))

    const purchaseRequests: PurchaseRequestRow[] = purchaseOrderRows.map((row) => ({
      id: String(row.id),
      option: "",
      date: dateText(row.expected_date ?? row.created_at),
      referenceNo: row.id ? String(row.id).slice(0, 8) : "—",
      branch: selectedBranchId ? (branchesById.get(selectedBranchId) ?? "—") : "كل الفروع",
      supplier: row.supplier_name ?? "مورد",
      status: statusLabel(row.status),
      remainingQty: "—",
      addedBy: "—",
    }))

    const pendingShipments: PendingShipmentRow[] = shipmentRows.map((row) => ({
      id: String(row.id),
      option: "",
      date: dateText(row.created_at),
      invoiceNo: row.order_number ?? "—",
      customer: row.customer_name ?? "عميل",
      phone: "—",
      branch: branchesById.get(row.branch_id ?? "") ?? "—",
      shippingStatus: statusLabel(row.status),
      paymentStatus: paymentLabel(row.payment_status),
    }))

    const payload: DashboardHomePayload = {
      generatedAt: new Date().toISOString(),
      dateFilter,
      branchFilter,
      kpis: [
        { id: "sales-total", value: salesTotal, hint: `${salesRows.length.toLocaleString("en-US")} فاتورة` },
        { id: "net-income", value: netIncome },
        { id: "pending-sales", value: pendingSales },
        { id: "sales-returns", value: salesReturns },
        { id: "purchases-total", value: purchasesTotal, hint: `${purchasesRows.length.toLocaleString("en-US")} فاتورة` },
        { id: "pending-purchases", value: pendingPurchases },
        { id: "purchase-returns", value: purchaseReturns },
        { id: "expenses-total", value: expensesTotal, hint: `${expensesRows.length.toLocaleString("en-US")} مصروف` },
      ],
      salesLast30DaysChart: buildDailyChart(salesChartRows, scope.branches, selectedBranchId),
      currentFinancialYearChart: buildMonthlyChart(salesYearRows, scope.branches, selectedBranchId),
      tables: {
        customerDebts,
        supplierDebts,
        stockWarning,
        expiryAlert,
        orders,
        purchaseRequests,
        pendingShipments,
      },
    }

    serverCache.set(cacheKey, { expiresAt: Date.now() + SERVER_CACHE_TTL_MS, payload })

    return NextResponse.json(payload, {
      headers: {
        "x-dashboard-cache": "miss",
        "x-dashboard-mode": includeTables ? "full" : "summary",
        "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
      },
    })
  } catch (error) {
    console.error("dashboard/home failed", error)
    return NextResponse.json({ error: "فشل تحميل بيانات لوحة المتابعة" }, { status: 500 })
  }
}
