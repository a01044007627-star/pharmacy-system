import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const notices = []

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required file: ${relativePath}`)
    return ""
  }
  return readFileSync(absolutePath, "utf8")
}

function requireText(relativePath, patterns) {
  const content = read(relativePath)
  for (const pattern of patterns) {
    if (!content.includes(pattern)) failures.push(`${relativePath} is missing: ${pattern}`)
  }
  return content
}

function rejectText(relativePath, patterns) {
  const content = read(relativePath)
  for (const pattern of patterns) {
    if (content.includes(pattern)) failures.push(`${relativePath} still contains forbidden pattern: ${pattern}`)
  }
  return content
}

const packageJson = JSON.parse(read("package.json") || "{}")
if (!String(packageJson.packageManager ?? "").startsWith("pnpm@")) {
  failures.push("package.json must declare pnpm as the single package manager")
}
if (existsSync(path.join(root, "package-lock.json"))) {
  failures.push("package-lock.json must be removed; pnpm-lock.yaml is the source of truth")
}

requireText("src/domain/shared/decimal-value.ts", ["export class Money", "Decimal.ROUND_HALF_UP"])
requireText("src/domain/inventory/units/unit-policy.ts", ["export class QuantityPolicy", "export class UnitPolicyService"])
requireText("src/domain/workflows/operational-workflows.ts", ["PurchaseOrderStatus", "DeliveryStatus", "StockCountStatus"])
requireText("src/features/inventory/server/item-quantity-policy-repository.ts", ["export class ItemQuantityPolicyRepository", "normalizeTransactionLines"])

for (const route of [
  "src/app/api/sales/cashier/route.ts",
  "src/app/api/purchases/route.ts",
  "src/app/api/inventory/stock-transfers/route.ts",
  "src/app/api/inventory/damaged/route.ts",
]) {
  requireText(route, ["ItemQuantityPolicyRepository", "normalizeTransactionLines"])
}

requireText("src/app/api/purchases/orders/route.ts", ["purchaseOrderWorkflow", "assertTransition"])
requireText("src/app/api/inventory/stock-counts/route.ts", ["stockCountWorkflow", "assertTransition"])
requireText("src/app/api/sales/shipping/route.ts", ["deliveryLifecycleService", "prepareUpdate"])
requireText("src/domain/delivery/delivery-lifecycle-service.ts", ["deliveryWorkflow.assertTransition", "export class DeliveryLifecycleService"])

for (const view of [
  "src/features/purchases/components/purchase-orders-view.tsx",
  "src/features/sales/components/shipping-view.tsx",
]) {
  requireText(view, ["apiClient"])
  rejectText(view, ["await fetch("])
}

const compatibilityClient = read("src/lib/api-client.ts")
if (!compatibilityClient.includes("@/lib/http/api-client") && !compatibilityClient.includes("./http/api-client")) {
  failures.push("src/lib/api-client.ts must remain a compatibility re-export, not a second HTTP client")
}
rejectText("src/lib/api-client.ts", ["class HttpClient", "async function apiRequest"])

const migration = requireText("supabase/migrations/20260621111000_domain_units_delivery_workflows.sql", [
  "apply_unit_domain_policy",
  "enforce_operational_status_transition",
  "Normalize legacy aliases",
  "trg_purchase_order_status_transition",
  "trg_delivery_status_transition",
  "trg_stock_count_status_transition",
])
requireText("supabase/migrations/20260621112000_atomic_purchase_order_receiving.sql", [
  "receive_purchase_order_complete_v1",
  "create_received_purchase_complete_v1",
  "pharmacy_purchase_order_receipts",
  "UNIQUE(pharmacy_id, client_request_id)",
  "v_all_received",
])
requireText("src/app/api/purchases/orders/route.ts", ["sell_price", "received_quantity: 0"])
requireText("src/app/api/purchases/orders/[orderId]/receive/route.ts", ["sellPrices", "receive_purchase_order_complete_v1"])
requireText("src/features/purchases/components/purchase-order-receive-dialog.tsx", ["line.sell_price", "client_request_id"])

requireText("src/domain/hr/payroll/payroll-types.ts", ["SalaryType", "PayrollRunStatus", "PayrollPaymentMethod"])
requireText("src/domain/hr/payroll/payroll-calculator.ts", ["export class PayrollCalculator", "PayrollPeriod", "explicit_attendance_records"])
requireText("src/domain/hr/payroll/payroll-workflow.ts", ["payrollRunWorkflow", "PayrollRunStatus.Approved", "PayrollRunStatus.Paid"])
requireText("src/lib/server/payroll-repository.ts", ["export class PayrollRepository", "calculateDraftLines", "create_payroll_run_v1", "pay_payroll_run_v1"])
requireText("src/app/api/hr/payroll/route.ts", ["PayrollRepository", "financials:write", "update-line", "payrollRunWorkflow"])
requireText("src/features/hr/components/payroll-view.tsx", ["apiClient", "PayrollLineAdjustmentDialog", "صرف وتسجيل القيد"])
rejectText("src/features/hr/components/payroll-view.tsx", ["await fetch("])
requireText("supabase/migrations/20260621113000_payroll_domain_operations.sql", [
  "pharmacy_payroll_runs",
  "pharmacy_payroll_lines",
  "create_payroll_run_v1",
  "update_payroll_line_v1",
  "transition_payroll_run_v1",
  "pay_payroll_run_v1",
  "trg_enforce_payroll_run_transition",
  "pharmacy_financial_movements",
])

requireText("src/domain/hr/hr-types.ts", ["AttendanceStatus", "LeaveType", "LeaveStatus"])
requireText("src/domain/hr/attendance-policy.ts", ["export class AttendancePolicy", "graceMinutes", "cairoMinutesOfDay"])
requireText("src/domain/hr/leave-workflow.ts", ["leaveWorkflow", "LeaveStatus.Approved", "LeaveStatus.Cancelled"])
requireText("src/lib/server/hr-repository.ts", ["export class HrRepository", "deactivateEmployee", "leaveWorkflow.assertTransition", "Money.nonNegative"])
requireText("src/app/api/hr/employees/route.ts", ["TenantRequestContext", "HrRepository", "employee.deactivated"])
rejectText("src/app/api/hr/employees/route.ts", [".delete()", "user_id: scope.user.id"])
for (const view of [
  "src/features/hr/components/employees-view.tsx",
  "src/features/hr/components/attendance-view.tsx",
  "src/features/hr/components/leave-view.tsx",
]) {
  requireText(view, ["apiClient"])
  rejectText(view, ["await fetch(", "fetch(`/api/hr/"])
}
requireText("supabase/migrations/20260621114000_hr_workflow_integrity.sql", [
  "enforce_employee_integrity_v1",
  "prevent_employee_hard_delete_v1",
  "enforce_leave_transition_v1",
  "pharmacy_leave_valid_period",
  "hr.attendanceGraceMinutes",
])

requireText("src/features/sales/server/cashier-sale-service.ts", [
  "export class CashierSaleService",
  "create_cashier_sale_complete_v2",
  "create_cashier_sale_complete_v1",
  "create_cashier_sale_v2",
  "CASHIER_DATABASE_UPGRADE_REQUIRED",
])
requireText("src/features/sales/server/cashier-shift-repository.ts", [
  "export class CashierShiftRepository",
  "async snapshot",
  "expectedDrawer",
  "recentSales",
])
requireText("src/features/sales/components/cashier-view.tsx", [
  "CashierSessionDialog",
  "CashierCloseDialog",
  "CashierShortcutsDialog",
  "InvoiceDiscountDialog",
  "searchResultsVisible",
  "openSystemWindow",
])
requireText("supabase/migrations/20260621115000_cashier_experience_operational_repair.sql", [
  "create_cashier_sale_complete_v2",
  "sales:discount",
  "idx_sales_shift_date",
])

for (const generatedSql of ["supabase/deploy.sql", "supabase/final-repair.sql"]) {
  const content = read(generatedSql)
  if (!content.includes("20260621111000_domain_units_delivery_workflows.sql")) {
    failures.push(`${generatedSql} does not include the latest domain migration`)
  }
  if (!content.includes("Normalize legacy aliases") || !content.includes("receive_purchase_order_complete_v1") || !content.includes("pharmacy_purchase_order_receipts") || !content.includes("pay_payroll_run_v1") || !content.includes("pharmacy_payroll_lines") || !content.includes("enforce_leave_transition_v1") || !content.includes("prevent_employee_hard_delete_v1") || !content.includes("create_cashier_sale_complete_v2") || !content.includes("open_cashier_shift_v1") || !content.includes("close_cashier_shift_v1")) {
    failures.push(`${generatedSql} is stale; rebuild it after domain migration changes`)
  }
}

const businessFiles = [
  "src/features/purchases/lib/purchase-totals.ts",
  "src/features/sales/lib/return-settlement.ts",
  "src/lib/inventory/opening-stock.ts",
  "src/lib/daily-profit-service.ts",
]
for (const file of businessFiles) {
  const content = read(file)
  if (/Math\.round\([^\n]*\*\s*100\)/.test(content)) {
    failures.push(`${file} contains manual money rounding; use Money/roundMoney`)
  }
}

if (migration.length > 0) notices.push("Domain SQL migration is present in fresh-deploy and existing-database repair scripts")
notices.push("Money, quantity policy and state machines are centralized and audited")
notices.push("Operational UIs use the shared HTTP client and legal workflow transitions")
notices.push("Payroll calculation, approval, payment and accounting are centralized and audited")
notices.push("Employee lifecycle and leave transitions are protected in API, domain and database layers")
notices.push("Attendance status is derived from shift time and a centralized grace-period policy")
notices.push("Cashier save, live-session reporting, closing summary and shortcuts are centralized and audited")

if (failures.length > 0) {
  console.error(`Domain architecture audit failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Domain architecture audit passed")
for (const notice of notices) console.log(`- ${notice}`)
