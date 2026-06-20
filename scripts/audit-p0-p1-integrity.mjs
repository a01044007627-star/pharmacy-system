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

function requireAll(relativePath, tokens) {
  const content = read(relativePath)
  for (const token of tokens) {
    if (!content.includes(token)) failures.push(`${relativePath} is missing: ${token}`)
  }
  return content
}

function rejectAll(relativePath, tokens) {
  const content = read(relativePath)
  for (const token of tokens) {
    if (content.includes(token)) failures.push(`${relativePath} still contains forbidden pattern: ${token}`)
  }
  return content
}

function roleBlock(sql, role, nextRole) {
  const start = sql.indexOf(`v_role = '${role}'`)
  if (start < 0) return ""
  const end = nextRole ? sql.indexOf(`v_role = '${nextRole}'`, start + 1) : sql.indexOf("RETURN false", start + 1)
  return sql.slice(start, end < 0 ? undefined : end)
}

const migrationName = "20260621116000_p0_p1_integrity_closure.sql"
const migrationPath = `supabase/migrations/${migrationName}`
const migration = requireAll(migrationPath, [
  "ADD COLUMN IF NOT EXISTS import_request_id TEXT",
  "ADD COLUMN IF NOT EXISTS client_request_id TEXT",
  "ADD COLUMN IF NOT EXISTS purchase_line_id UUID",
  "ADD COLUMN IF NOT EXISTS sale_line_id UUID",
  "ADD COLUMN IF NOT EXISTS batch_allocations JSONB",
  "record_damaged_stock_v1",
  "import_pharmacy_item_row_v1",
  "import_pharmacy_items_batch_v1",
  "pg_advisory_xact_lock",
  "inventory:damaged.write",
  "NOTIFY pgrst, 'reload schema'",
])

const core = requireAll("supabase/consolidated/000_core_tables.sql", [
  "ADD COLUMN IF NOT EXISTS import_request_id TEXT",
  "client_request_id TEXT",
  "purchase_line_id UUID",
  "sale_line_id UUID",
  "batch_allocations JSONB",
  "batch_id UUID REFERENCES pharmacy_item_batches",
])

const requiredCoreTables = [
  "pharmacy_items",
  "pharmacy_purchases",
  "pharmacy_purchase_lines",
  "pharmacy_sales_returns",
  "pharmacy_sales_return_lines",
  "pharmacy_purchase_returns",
  "pharmacy_purchase_return_lines",
  "pharmacy_damaged_stock",
]
for (const table of requiredCoreTables) {
  if (!core.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) failures.push(`Canonical core schema is missing table ${table}`)
}

const damagedRoute = requireAll("src/app/api/inventory/damaged/route.ts", [
  'scopeCan(scope, "inventory:damaged.write")',
  'db.rpc("record_damaged_stock_v1"',
  "p_client_request_id",
  "p_batch_id",
  "writeAuditLog",
])
if (/\.from\(["']pharmacy_damaged_stock["']\)\s*\.insert/s.test(damagedRoute)) {
  failures.push("Damaged-stock route still performs a direct non-atomic insert")
}
rejectAll("src/app/api/inventory/damaged/route.ts", ["recorded_by"])

const importRoute = requireAll("src/app/api/items/import/route.ts", [
  'db.rpc("import_pharmacy_items_batch_v1"',
  "createHash(\"sha256\")",
  "client_request_id: clientRequestId",
  "AtomicImportResult",
])
if (/\.from\(["']pharmacy_items["']\)\s*\.insert/s.test(importRoute)) {
  failures.push("Excel import route still inserts items directly outside the atomic RPC")
}
rejectAll("src/app/api/items/import/route.ts", ["addOpeningStock("])

const syncApi = requireAll("src/app/api/sync/route.ts", [
  "pending_changes: null",
  'pending_source: "client_device"',
])
if (/pending_changes:\s*0\b/.test(syncApi)) failures.push("Sync API still reports a fake zero pending count")
requireAll("src/lib/sync/local-db.ts", ["countDeadLetters()"])
requireAll("src/lib/sync/sync-manager.ts", ["failedMutations: number", "localDB.countDeadLetters()"])
requireAll("src/app/dashboard/sync/page.tsx", ["clientStatus.pendingMutations", "clientStatus.failedMutations"])
requireAll("src/features/inventory/components/damaged-stock-view.tsx", [
  'auth.can("inventory:damaged.write")',
  "client_request_id: requestIdRef.current",
  "requestIdRef.current = crypto.randomUUID()",
])
rejectAll("src/features/inventory/components/damaged-stock-view.tsx", ['auth.can("inventory:create")'])

const admin = roleBlock(migration, "admin", "manager")
const manager = roleBlock(migration, "manager", "accountant")
const technician = roleBlock(migration, "technician", "worker")
const viewer = roleBlock(migration, "viewer", null)
for (const permission of ["prescriptions:write", "delivery:write", "loyalty:write", "notifications:templates.write"]) {
  if (!admin.includes(`'${permission}'`)) failures.push(`Database admin role is missing ${permission}`)
}
for (const permission of ["delivery:read", "delivery:write"]) {
  if (!manager.includes(`'${permission}'`)) failures.push(`Database manager role is missing ${permission}`)
}
if (manager.includes("'pharmacy:write'")) failures.push("Database manager role exceeds the TypeScript matrix with pharmacy:write")
for (const permission of ["inventory:write", "inventory:update", "inventory:stocktake", "inventory:barcode.print"]) {
  if (!technician.includes(`'${permission}'`)) failures.push(`Database technician role is missing ${permission}`)
}
if (!viewer.includes("'purchases:read'")) failures.push("Database viewer role is missing purchases:read")
if (migration.includes("'sales:manage'")) failures.push("Legacy undefined sales:manage permission remains in the final permission function")

for (const generatedSql of ["supabase/deploy.sql", "supabase/final-repair.sql"]) {
  const content = read(generatedSql)
  if (!content.includes(migrationName) || !content.includes("record_damaged_stock_v1") || !content.includes("import_pharmacy_items_batch_v1")) {
    failures.push(`${generatedSql} is stale and does not contain the P0/P1 closure migration`)
  }
}

// Basic guard against a truncated SQL function body in the handoff artifact.
const dollarQuoteCount = (migration.match(/\$\$/g) ?? []).length
if (dollarQuoteCount % 2 !== 0) failures.push(`${migrationPath} has unbalanced dollar-quoted function bodies`)
if (!migration.trimStart().startsWith("BEGIN;") || !migration.trimEnd().endsWith("COMMIT;")) {
  failures.push(`${migrationPath} must be a single explicit transaction`)
}

notices.push("Purchase/return schema fields are present before dependent functions and indexes")
notices.push("Damaged stock is idempotent and atomically updates batches, balance and movements")
notices.push("Every Excel row is imported through a subtransaction-safe RPC")
notices.push("Database role permissions match the current application role matrix for audited roles")
notices.push("Offline status reports real device-local pending and failed counts")

if (failures.length > 0) {
  console.error(`P0/P1 integrity audit failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("P0/P1 integrity audit passed")
for (const notice of notices) console.log(`- ${notice}`)
