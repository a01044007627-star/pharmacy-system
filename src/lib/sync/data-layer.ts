"use client"

import { createClient } from "@/lib/supabase/client"
import { localSQLite } from "./local-sqlite"
import { localDB } from "./local-db"
import { network } from "@/lib/network"

type TableName =
  | "pharmacy_items"
  | "pharmacy_item_barcodes"
  | "pharmacy_item_batches"
  | "pharmacy_item_groups"
  | "pharmacy_item_brands"
  | "pharmacy_partners"
  | "pharmacy_sales"
  | "pharmacy_sale_lines"
  | "pharmacy_purchases"
  | "pharmacy_purchase_lines"
  | "pharmacy_expenses"
  | "pharmacy_expense_categories"
  | "pharmacy_stock_balances"
  | "pharmacy_stock_movements"
  | "pharmacy_cash_registers"
  | "pharmacy_register_transactions"
  | "pharmacy_shifts"
  | "pharmacy_payments"
  | "pharmacy_orders"
  | "pharmacy_coupons"
  | "pharmacy_bundles"
  | "pharmacy_daily_summary"
  | "pharmacy_notifications"
  | "pharmacy_employees"
  | "pharmacy_attendance"
  | "pharmacy_settings"
  | "pharmacy_branches"
  | "pharmacy_invoice_designs"
  | "pharmacy_tax_rates"
  | "pharmacy_tax_groups"
  | "pharmacy_tax_group_members"
  | "pharmacy_barcode_paper_settings"
  | "pharmacy_receipt_printers"
  | "pharmacy_notification_templates"
  | "pharmacy_backups"
  | string

interface QueryOptions {
  columns?: string
  order?: string
  ascending?: boolean
  limit?: number
  offset?: number
}

type WhereFilter = Record<string, unknown>

function buildWhereClause(filter: WhereFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const [key, value] of Object.entries(filter)) {
    if (value === null) {
      clauses.push(`${key} IS NULL`)
    } else if (Array.isArray(value)) {
      const placeholders = value.map(() => "?").join(",")
      clauses.push(`${key} IN (${placeholders})`)
      params.push(...value)
    } else {
      clauses.push(`${key} = ?`)
      params.push(value)
    }
  }
  return { sql: clauses.join(" AND "), params }
}

async function getPharmacyId(): Promise<string | null> {
  try {
    return localStorage.getItem("active-pharmacy-id")
  } catch {
    return null
  }
}

async function getBranchId(): Promise<string | null> {
  try {
    return localStorage.getItem("active-branch-id")
  } catch {
    return null
  }
}

function shouldScopeByPharmacy(table: TableName): boolean {
  return table.startsWith("pharmacy_")
}

const STRICT_ONLINE_TABLES = new Set<TableName>([
  "pharmacy_settings",
  "pharmacy_branches",
  "pharmacy_invoice_designs",
  "pharmacy_tax_rates",
  "pharmacy_tax_groups",
  "pharmacy_tax_group_members",
  "pharmacy_barcode_paper_settings",
  "pharmacy_receipt_printers",
  "pharmacy_notification_templates",
  "pharmacy_backups",
])

function shouldUseStrictOnline(table: TableName): boolean {
  return STRICT_ONLINE_TABLES.has(table)
}

function normalizeOnlineError(table: TableName, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "فشل الاتصال بقاعدة البيانات")
  return new Error(`فشل تنفيذ العملية على ${table}: ${message}`)
}

function hasExplicitPharmacyFilter(filter?: WhereFilter): boolean {
  return Boolean(filter && Object.prototype.hasOwnProperty.call(filter, "pharmacy_id"))
}

function shouldInjectPharmacyId(table: TableName, record: Record<string, unknown>): boolean {
  return shouldScopeByPharmacy(table) && !("pharmacy_id" in record)
}

function shouldInjectBranchId(table: TableName, record: Record<string, unknown>): boolean {
  return table.startsWith("pharmacy_") && !("branch_id" in record) && [
    "pharmacy_items",
    "pharmacy_sales",
    "pharmacy_purchases",
    "pharmacy_expenses",
    "pharmacy_stock_movements",
    "pharmacy_cash_registers",
    "pharmacy_shifts",
  ].includes(table)
}

async function withActiveScope(table: TableName, filter?: WhereFilter): Promise<WhereFilter | undefined> {
  const pharmacyId = await getPharmacyId()
  if (!pharmacyId || !shouldScopeByPharmacy(table) || hasExplicitPharmacyFilter(filter)) return filter
  return { ...(filter ?? {}), pharmacy_id: filter?.pharmacy_id ?? pharmacyId }
}

async function withActiveScopePayload(table: TableName, record: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pharmacyId = await getPharmacyId()
  const branchId = await getBranchId()
  const payload = { ...record }
  if (pharmacyId && shouldInjectPharmacyId(table, payload)) payload.pharmacy_id = pharmacyId
  if (branchId && shouldInjectBranchId(table, payload)) payload.branch_id = branchId
  return payload
}

function assertSameActivePharmacy(table: TableName, row: Record<string, unknown> | null, pharmacyId: string | null) {
  if (!row || !pharmacyId || !shouldScopeByPharmacy(table)) return
  if (row.pharmacy_id && row.pharmacy_id !== pharmacyId) {
    throw new Error("غير مسموح بتعديل بيانات خارج الصيدلية النشطة")
  }
}

async function onlineQuery<T>(
  table: TableName,
  filter?: WhereFilter,
  opts?: QueryOptions,
): Promise<T[]> {
  const supabase = createClient()
  const pharmacyId = await getPharmacyId()

  let query = supabase.from(table).select(opts?.columns ?? "*")

  if (pharmacyId && shouldScopeByPharmacy(table) && !hasExplicitPharmacyFilter(filter)) {
    query = query.eq("pharmacy_id", pharmacyId)
  }

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue
      query = value === null ? query.is(key, null) : query.eq(key, value)
    }
  }

  if (opts?.order) {
    query = query.order(opts.order, { ascending: opts?.ascending ?? true })
  }
  if (opts?.limit) query = query.limit(opts.limit)
  if (opts?.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1)

  const { data, error } = await query.throwOnError()
  if (error) throw error
  return (data ?? []) as T[]
}

async function onlineGetById<T>(table: TableName, id: string): Promise<T | null> {
  const supabase = createClient()
  const pharmacyId = await getPharmacyId()
  let query = supabase.from(table).select("*").eq("id", id)
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data ?? null) as T | null
}

async function onlineInsert<T>(table: TableName, record: Partial<T>): Promise<T> {
  const supabase = createClient()
  const payload = await withActiveScopePayload(table, record as Record<string, unknown>)
  const { data, error } = await supabase.from(table).insert(payload).select().single()
  if (error) throw error
  return data as T
}

async function onlineUpdate<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
  const supabase = createClient()
  const pharmacyId = await getPharmacyId()
  let query = supabase
    .from(table)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { data, error } = await query.select().single()
  if (error) throw error
  return data as T
}

async function onlineDelete(table: TableName, id: string): Promise<void> {
  const supabase = createClient()
  const pharmacyId = await getPharmacyId()
  let query = supabase.from(table).delete().eq("id", id)
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { error } = await query
  if (error) throw error
}

async function offlineQuery<T>(
  table: TableName,
  filter?: WhereFilter,
  opts?: QueryOptions,
): Promise<T[]> {
  let sql = `SELECT ${opts?.columns ?? "*"} FROM ${table}`
  const params: unknown[] = []
  const scopedFilter = await withActiveScope(table, filter)

  if (scopedFilter && Object.keys(scopedFilter).length > 0) {
    const clause = buildWhereClause(scopedFilter)
    sql += ` WHERE ${clause.sql}`
    params.push(...clause.params)
  }

  if (opts?.order) {
    sql += ` ORDER BY ${opts.order} ${opts?.ascending !== false ? "ASC" : "DESC"}`
  }
  if (opts?.limit) sql += ` LIMIT ?`
  if (opts?.limit) params.push(opts.limit)
  if (opts?.offset) sql += ` OFFSET ?`
  if (opts?.offset) params.push(opts.offset)

  const rows = await localSQLite.query(sql, params)
  return rows as T[]
}

async function offlineGetById<T>(table: TableName, id: string): Promise<T | null> {
  return localSQLite.getById(table, id) as Promise<T | null>
}

async function offlineInsert<T>(table: TableName, record: Partial<T>): Promise<T> {
  const payload = await withActiveScopePayload(table, record as Record<string, unknown>)
  await localSQLite.insert(table, payload)
  await localDB.queueMutation({
    id: crypto.randomUUID(),
    table,
    operation: "create",
    data: payload,
    created_at: new Date().toISOString(),
  })
  return payload as T
}

async function offlineUpdate<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
  const existing = await localSQLite.getById(table, id) as Record<string, unknown> | null
  if (!existing) throw new Error(`Record ${id} not found in ${table}`)
  assertSameActivePharmacy(table, existing, await getPharmacyId())

  const updated = { ...existing, ...updates, updated_at: new Date().toISOString() }
  await localSQLite.insert(table, updated as Record<string, unknown>)
  await localDB.queueMutation({
    id: crypto.randomUUID(),
    table,
    operation: "update",
    data: updated,
    created_at: new Date().toISOString(),
  })
  return updated as T
}

async function offlineDelete(table: TableName, id: string): Promise<void> {
  const existing = await localSQLite.getById(table, id) as Record<string, unknown> | null
  assertSameActivePharmacy(table, existing, await getPharmacyId())
  await localSQLite.delete(table, id)
  await localDB.queueMutation({
    id: crypto.randomUUID(),
    table,
    operation: "delete",
    data: { id },
    created_at: new Date().toISOString(),
  })
}

export const dataLayer = {
  async query<T>(table: TableName, filter?: WhereFilter, opts?: QueryOptions): Promise<T[]> {
    if (network.isOnline) {
      try {
        return await onlineQuery<T>(table, filter, opts)
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback to offline */
      }
    }
    return offlineQuery<T>(table, filter, opts)
  },

  async getById<T>(table: TableName, id: string): Promise<T | null> {
    if (network.isOnline) {
      try {
        return await onlineGetById<T>(table, id)
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback */
      }
    }
    return offlineGetById<T>(table, id)
  },

  async insert<T>(table: TableName, record: Partial<T>): Promise<T> {
    if (network.isOnline) {
      try {
        const result = await onlineInsert<T>(table, record)
        return result
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback */
      }
    }
    return offlineInsert<T>(table, record)
  },

  async update<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
    if (network.isOnline) {
      try {
        return await onlineUpdate<T>(table, id, updates)
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback */
      }
    }
    return offlineUpdate<T>(table, id, updates)
  },

  async delete(table: TableName, id: string): Promise<void> {
    if (network.isOnline) {
      try {
        await onlineDelete(table, id)
        return
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback */
      }
    }
    await offlineDelete(table, id)
  },

  async exists(table: TableName, filter: WhereFilter): Promise<boolean> {
    const results = await this.query<Record<string, unknown>>(table, filter, { limit: 1 })
    return results.length > 0
  },

  async count(table: TableName, filter?: WhereFilter): Promise<number> {
    if (network.isOnline) {
      try {
        const supabase = createClient()
        let query = supabase.from(table).select("*", { count: "exact", head: true })
        const pharmacyId = await getPharmacyId()
        if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
        if (filter) {
          for (const [key, value] of Object.entries(filter)) {
            if (value === undefined) continue
            query = value === null ? query.is(key, null) : query.eq(key, value)
          }
        }
        const { count, error } = await query
        if (error) throw error
        return count ?? 0
      } catch (error) {
        if (shouldUseStrictOnline(table)) throw normalizeOnlineError(table, error)
        /* fallback */
      }
    }
    const rows = await offlineQuery(table, filter)
    return rows.length
  },

  async upsert<T extends Record<string, unknown>>(
    table: TableName,
    record: Partial<T>,
    conflictColumn = "id",
  ): Promise<T> {
    const id = record[conflictColumn] as string | undefined
    if (id) {
      const existing = await this.getById<T>(table, id)
      if (existing) {
        return this.update<T>(table, id, record as Partial<T>)
      }
    }
    return this.insert<T>(table, record)
  },

  async getLastSyncTime(table: TableName): Promise<string | null> {
    return localSQLite.getLastSync(table)
  },

  get network() {
    return {
      get isOnline() {
        return network.isOnline
      },
      subscribe: (l: (online: boolean) => void) => network.subscribe(l),
      check: () => network.check(),
      waitForOnline: (timeout?: number) => network.waitForOnline(timeout),
    }
  },
}
