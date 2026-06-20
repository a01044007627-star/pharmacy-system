import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

function walk(dir: string, predicate: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full, predicate)
    return predicate(full) ? [full] : []
  })
}

function readAll(files: string[]) {
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n")
}

describe("operational wiring integrity", () => {
  const sourceFiles = walk(path.join(root, "src"), (file) => /\.(ts|tsx)$/.test(file))
  const migrationFiles = walk(path.join(root, "supabase", "migrations"), (file) => file.endsWith(".sql"))
  const source = readAll(sourceFiles)
  const migrations = readAll(migrationFiles)

  test("every literal Supabase RPC used by the application exists in migrations", () => {
    const used = new Set(Array.from(source.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g), (match) => match[1]))
    const defined = new Set(Array.from(migrations.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)/gi), (match) => match[1]))
    const missing = [...used].filter((name) => !defined.has(name)).sort()
    expect(missing).toEqual([])
  })

  test("literal API routes used by the UI have route handlers", () => {
    const routeFiles = walk(path.join(root, "src", "app", "api"), (file) => file.endsWith(`${path.sep}route.ts`) || file.endsWith("/route.ts"))
    const patterns = routeFiles.map((file) => {
      const relative = path.relative(path.join(root, "src", "app"), path.dirname(file)).replaceAll(path.sep, "/")
      const escaped = `/${relative}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\[[^/]+\\\]/g, "[^/]+")
      return new RegExp(`^${escaped}/?$`)
    })
    const used = new Set<string>()
    for (const match of source.matchAll(/(?:fetch|path:)\s*\(?\s*["'`]\/api\/([^"'`?${}]+)/g)) used.add(`/api/${match[1]}`.replace(/\/$/, ""))
    const missing = [...used].filter((route) => !patterns.some((pattern) => pattern.test(route))).sort()
    expect(missing).toEqual([])
  })

  test("new operational migrations are transactional and have balanced function delimiters", () => {
    const files = migrationFiles.filter((file) => /2026062100[1-8]000_/.test(path.basename(file)))
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const file of files) {
      const sql = fs.readFileSync(file, "utf8")
      expect(sql.trimStart().toUpperCase().startsWith("BEGIN;")).toBe(true)
      expect(sql.trimEnd().toUpperCase().endsWith("COMMIT;")).toBe(true)
      expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0)
    }
  })

  test("accounting closeout is atomic and wired through its RPC", () => {
    const api = fs.readFileSync(path.join(root, "src", "app", "api", "accounts", "closeout", "route.ts"), "utf8")
    const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260621007000_atomic_accounting_closeout.sql"), "utf8")
    expect(api).toContain('rpc("close_accounting_period_v1"')
    expect(migration).toContain("قيد الإقفال غير متوازن")
    expect(migration).toContain("pg_advisory_xact_lock")
  })
})
