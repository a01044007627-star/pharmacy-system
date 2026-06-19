import { AlertTriangle, ClipboardList, Package, Truck } from "lucide-react"
import {
  type CustomerDebtRow,
  type DashboardTableConfig,
  type DashboardTablesPayload,
  type ExpiryAlertRow,
  type PendingShipmentRow,
  type PurchaseRequestRow,
  type SalesOrderRow,
  type StockWarningRow,
  type SupplierDebtRow,
} from "./types"
import { PaymentButton, WarningEmptyState } from "./components/dashboard-report-table"

function fmt(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ج.م`
}

export function buildTableConfigs(rows: DashboardTablesPayload) {
  const customerDebts: DashboardTableConfig<CustomerDebtRow> = {
    id: "customer-debts",
    title: "ديون العملاء",
    tone: "amber",
    icon: AlertTriangle,
    info: "فواتير العملاء غير المحصلة بالكامل، ويتم فتح إضافة الدفع من نفس الصف.",
    rows: rows.customerDebts,
    defaultPageSize: 12,
    compact: true,
    columns: [
      { key: "customer", header: "زبون" },
      { key: "invoiceNo", header: "الفاتورة رقم.", render: (row) => <span className="text-sky-600">{row.invoiceNo}</span> },
      { key: "dueAmount", header: "المبلغ المستحق", render: (row) => <span dir="ltr" className="tabular-nums">{fmt(row.dueAmount)}</span> },
      { key: "option", header: "خيار", render: () => <PaymentButton /> },
    ],
  }

  const supplierDebts: DashboardTableConfig<SupplierDebtRow> = {
    id: "supplier-debts",
    title: "ديون الموردين",
    tone: "amber",
    icon: AlertTriangle,
    info: "مستحقات الموردين المرتبطة بفواتير الشراء أو أوامر الشراء.",
    rows: rows.supplierDebts,
    defaultPageSize: 12,
    compact: true,
    columns: [
      { key: "supplier", header: "المورد" },
      { key: "referenceNo", header: "الرقم المرجعي", render: (row) => <span className="text-sky-600">{row.referenceNo}</span> },
      { key: "dueAmount", header: "المبلغ المستحق", render: (row) => <span dir="ltr" className="tabular-nums">{fmt(row.dueAmount)}</span> },
      { key: "option", header: "خيار", render: () => <PaymentButton /> },
    ],
  }

  const stockWarning: DashboardTableConfig<StockWarningRow> = {
    id: "stock-warning",
    title: "منبه المخزون",
    tone: "amber",
    icon: Package,
    info: "الأصناف التي وصلت للحد الأدنى أو أقل داخل الفروع.",
    rows: rows.stockWarning,
    defaultPageSize: 15,
    columns: [
      { key: "item", header: "صنف", className: "min-w-[360px]" },
      { key: "branch", header: "الفرع" },
      { key: "currentStock", header: "المخزون الحالي" },
    ],
  }

  const expiryAlert: DashboardTableConfig<ExpiryAlertRow> = {
    id: "expiry-alert",
    title: "تنبيه انتهاء الصلاحية",
    tone: "amber",
    icon: AlertTriangle,
    info: "تشغيل سريع للأصناف التي تنتهي خلال 90 يومًا مع الكمية المتبقية.",
    rows: rows.expiryAlert,
    defaultPageSize: 12,
    compact: true,
    columns: [
      { key: "item", header: "الصنف", className: "min-w-[360px]" },
      { key: "branch", header: "الفرع" },
      { key: "remainingStock", header: "المخزون المتبقي" },
      { key: "expiresAt", header: "تنتهي في" },
    ],
  }

  const orders: DashboardTableConfig<SalesOrderRow> = {
    id: "orders",
    title: "طلبات",
    tone: "amber",
    icon: ClipboardList,
    info: "طلبات العملاء المسجلة داخل المنظومة حسب الفرع والحالة.",
    rows: rows.orders,
    defaultPageSize: 10,
    columns: [
      { key: "option", header: "خيار", render: () => <WarningEmptyState /> },
      { key: "date", header: "تاريخ" },
      { key: "orderNo", header: "رقم الطلب" },
      { key: "customer", header: "اسم العميل" },
      { key: "phone", header: "رقم الاتصال" },
      { key: "branch", header: "الفرع" },
      { key: "status", header: "الحالة" },
      { key: "shippingStatus", header: "حالة الشحن والتوصيل" },
      { key: "remainingQty", header: "الكمية المتبقية" },
      { key: "addedBy", header: "أضيفت بواسطة" },
    ],
  }

  const purchaseRequests: DashboardTableConfig<PurchaseRequestRow> = {
    id: "purchase-requests",
    title: "طلبات الشراء",
    tone: "amber",
    icon: ClipboardList,
    info: "أوامر وطلبات الشراء المفتوحة التي تحتاج متابعة.",
    rows: rows.purchaseRequests,
    defaultPageSize: 10,
    columns: [
      { key: "option", header: "خيار", render: () => <WarningEmptyState /> },
      { key: "date", header: "تاريخ" },
      { key: "referenceNo", header: "الرقم المرجعي" },
      { key: "branch", header: "الفرع" },
      { key: "supplier", header: "المورد" },
      { key: "status", header: "الحالة" },
      { key: "remainingQty", header: "الكمية المتبقية" },
      { key: "addedBy", header: "أضيفت بواسطة" },
    ],
  }

  const pendingShipments: DashboardTableConfig<PendingShipmentRow> = {
    id: "pending-shipments",
    title: "الشحنات المعلقة",
    tone: "amber",
    icon: Truck,
    info: "طلبات الشحن أو التوصيل التي لم تكتمل بعد.",
    rows: rows.pendingShipments,
    defaultPageSize: 10,
    columns: [
      { key: "option", header: "خيار", render: () => <WarningEmptyState /> },
      { key: "date", header: "تاريخ" },
      { key: "invoiceNo", header: "الفاتورة رقم." },
      { key: "customer", header: "اسم العميل" },
      { key: "phone", header: "رقم الاتصال" },
      { key: "branch", header: "الفرع" },
      { key: "shippingStatus", header: "حالة الشحن والتوصيل" },
      { key: "paymentStatus", header: "حالة الدفع" },
    ],
  }

  return {
    customerDebts,
    supplierDebts,
    stockWarning,
    expiryAlert,
    orders,
    purchaseRequests,
    pendingShipments,
  }
}
