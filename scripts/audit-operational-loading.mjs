import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const embeddedRelationPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*\s*\(/

const tenantContextRoutes = [
  "src/app/api/sales/drafts/route.ts",
  "src/app/api/sales/returns/route.ts",
  "src/app/api/sales/shipping/route.ts",
  "src/app/api/purchases/orders/route.ts",
  "src/app/api/purchases/route.ts",
  "src/app/api/purchases/returns/route.ts",
  "src/app/api/purchases/shipping/route.ts",
  "src/app/api/sales/route.ts",
  "src/app/api/inventory/stock-balances/route.ts",
  "src/app/api/inventory/stock-counts/route.ts",
  "src/app/api/inventory/stock-movements/route.ts",
]

const relationSafeRoutes = [
  ...tenantContextRoutes,
  "src/app/api/hr/attendance/route.ts",
  "src/app/api/hr/leave/route.ts",
]

for (const relativePath of tenantContextRoutes) {
  const source = await read(relativePath)
  if (!source.includes("TenantRequestContext.from")) {
    failures.push(`${relativePath}: missing TenantRequestContext`)
  }
}

for (const relativePath of relationSafeRoutes) {
  const source = await read(relativePath)
  if (embeddedRelationPattern.test(source)) {
    failures.push(`${relativePath}: contains an ambiguous embedded PostgREST relation`)
  }
}

const inventoryRoutes = [
  "src/app/api/inventory/stock-balances/route.ts",
  "src/app/api/inventory/stock-counts/route.ts",
  "src/app/api/inventory/stock-movements/route.ts",
]
for (const relativePath of inventoryRoutes) {
  const source = await read(relativePath)
  if (!source.includes("InventoryReadRepository")) {
    failures.push(`${relativePath}: InventoryReadRepository is not used`)
  }
}

const stockBalances = await read("src/app/api/inventory/stock-balances/route.ts")
if (stockBalances.includes('.textSearch("item_id"')) {
  failures.push("stock balances: UUID item_id is incorrectly used as full-text search input")
}

const stockCounts = await read("src/app/api/inventory/stock-counts/route.ts")
if (!stockCounts.includes("StockCountStatus.Posted") || !stockCounts.includes("StockCountStatus.Draft")) {
  failures.push("stock counts: draft/posted canonical workflow statuses are not used")
}
if (/status:\s*variance\s*===\s*0\s*\?\s*["']matched["']/.test(stockCounts)) {
  failures.push("stock counts: legacy matched/variance values are still written")
}

for (const relativePath of ["src/app/api/hr/attendance/route.ts", "src/app/api/hr/leave/route.ts"]) {
  const source = await read(relativePath)
  if (!source.includes("HrRepository")) failures.push(`${relativePath}: HrRepository is not used`)
  if (source.includes("pharmacy_shifts")) failures.push(`${relativePath}: cashier shifts table is incorrectly used for HR data`)
}

const hrRepository = await read("src/lib/server/hr-repository.ts")
if (!hrRepository.includes('.from("pharmacy_attendance")')) failures.push("HR repository: attendance table is not used")
if (!hrRepository.includes('.from("pharmacy_leave")')) failures.push("HR repository: leave table is not used")

const salesRoute = await read("src/app/api/sales/route.ts")
if (!salesRoute.includes("OperationalRelationsRepository")) failures.push("sales route: branch relation repository is not used")

const deliveryPage = await read("src/app/dashboard/delivery/page.tsx")
if (!deliveryPage.includes("/api/sales/shipping?")) failures.push("delivery page: canonical shipping API is not used")
if (deliveryPage.includes("/api/sales?")) failures.push("delivery page: generic sales API is still used")

const itemRoute = await read("src/app/api/items/[itemId]/route.ts")
if (!itemRoute.includes("new ItemDetailRepository")) failures.push("item detail route: repository is not used")
if (embeddedRelationPattern.test(itemRoute)) failures.push("item detail route: contains an embedded PostgREST relation")

const barcodeView = await read("src/features/inventory/components/barcode-print-view.tsx")
if (!barcodeView.includes("DEFAULT_BARCODE_PAPER")) failures.push("barcode view: missing fallback paper configuration")
if (!barcodeView.includes("inventoryItemService.getDetail")) failures.push("barcode view: item API service is not used")
if (/Promise\.all\s*\([\s\S]{0,500}barcode-papers/.test(barcodeView)) {
  failures.push("barcode view: item and paper settings are coupled in Promise.all")
}

const purchaseOrders = await read("src/app/api/purchases/orders/route.ts")
for (const token of ["PurchaseOrderStatus.Draft", "PurchaseOrderStatus.Sent", "PurchaseOrderStatus.Partial", "PurchaseOrderStatus.Received", "PurchaseOrderStatus.Cancelled"]) {
  if (!purchaseOrders.includes(token)) failures.push(`purchase orders: missing canonical status ${token}`)
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    ok: true,
    checkedRoutes: relationSafeRoutes.length + 1,
    checks: [
      "central tenant/auth context",
      "no ambiguous embedded relations",
      "inventory repository boundaries",
      "canonical stock-count statuses",
      "HR tables separated from cashier shifts",
      "delivery uses pharmacy orders",
      "item detail repository",
      "barcode paper fallback",
      "purchase-order status consistency",
    ],
  }, null, 2))
}

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}
