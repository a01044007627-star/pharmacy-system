import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const operationalRoutes = [
  "src/app/api/sales/drafts/route.ts",
  "src/app/api/sales/returns/route.ts",
  "src/app/api/sales/shipping/route.ts",
  "src/app/api/purchases/orders/route.ts",
  "src/app/api/purchases/route.ts",
  "src/app/api/purchases/returns/route.ts",
  "src/app/api/purchases/shipping/route.ts",
]

const failures = []
const embeddedRelationPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*\s*\(/

for (const relativePath of operationalRoutes) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8")
  if (!source.includes("TenantRequestContext.from")) {
    failures.push(`${relativePath}: missing TenantRequestContext`) 
  }
  if (embeddedRelationPattern.test(source)) {
    failures.push(`${relativePath}: contains an ambiguous embedded PostgREST relation`)
  }
}

const itemRoute = await fs.readFile(path.join(root, "src/app/api/items/[itemId]/route.ts"), "utf8")
if (!itemRoute.includes("new ItemDetailRepository")) failures.push("item detail route: repository is not used")
if (embeddedRelationPattern.test(itemRoute)) failures.push("item detail route: contains an embedded PostgREST relation")

const barcodeView = await fs.readFile(path.join(root, "src/features/inventory/components/barcode-print-view.tsx"), "utf8")
if (!barcodeView.includes("DEFAULT_BARCODE_PAPER")) failures.push("barcode view: missing fallback paper configuration")
if (!barcodeView.includes("inventoryItemService.getDetail")) failures.push("barcode view: item API service is not used")
if (/Promise\.all\s*\([\s\S]{0,500}barcode-papers/.test(barcodeView)) {
  failures.push("barcode view: item and paper settings are coupled in Promise.all")
}

const purchaseOrders = await fs.readFile(path.join(root, "src/app/api/purchases/orders/route.ts"), "utf8")
const expectedStatuses = '["draft", "sent", "partial", "received", "cancelled"]'
if (!purchaseOrders.includes(expectedStatuses)) failures.push("purchase orders: API status enum does not match database constraint")

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    ok: true,
    checkedRoutes: operationalRoutes.length + 1,
    checks: [
      "central tenant/auth context",
      "no ambiguous embedded relations",
      "item detail repository",
      "barcode paper fallback",
      "purchase-order status consistency",
    ],
  }, null, 2))
}
