"use client"

import { createClient } from "@/lib/supabase/client"
import { localDB } from "./local-db"
import { network } from "@/lib/network"

type TableName = string

interface QueryOptions {
  columns?: string
  order?: string
  ascending?: boolean
  limit?: number
  offset?: number
}

type WhereFilter = Record<string, unknown>

function getPharmacyId() {
  try { return localStorage.getItem("active-pharmacy-id") } catch { return null }
}

function getBranchId() {
  try { return localStorage.getItem("active-branch-id") } catch { return null }
}

function shouldScopeByPharmacy(table: TableName) { return table.startsWith("pharmacy_") }
function hasExplicitPharmacyFilter(filter?: WhereFilter) { return Boolean(filter && Object.prototype.hasOwnProperty.call(filter, "pharmacy_id")) }

function shouldInjectBranchId(table: TableName, record: Record<string, unknown>) {
  return !Object.prototype.hasOwnProperty.call(record, "branch_id") && [
    "pharmacy_items", "pharmacy_sales", "pharmacy_purchases", "pharmacy_expenses",
    "pharmacy_stock_movements", "pharmacy_cash_registers", "pharmacy_shifts",
  ].includes(table)
}

function withScopeFilter(table: TableName, filter?: WhereFilter): WhereFilter {
  const pharmacyId = getPharmacyId()
  if (!pharmacyId || !shouldScopeByPharmacy(table) || hasExplicitPharmacyFilter(filter)) return { ...(filter ?? {}) }
  return { ...(filter ?? {}), pharmacy_id: pharmacyId }
}

function withScopePayload(table: TableName, record: Record<string, unknown>) {
  const payload = { ...record }
  const pharmacyId = getPharmacyId()
  const branchId = getBranchId()
  if (pharmacyId && shouldScopeByPharmacy(table) && !("pharmacy_id" in payload)) payload.pharmacy_id = pharmacyId
  if (branchId && shouldInjectBranchId(table, payload)) payload.branch_id = branchId
  return payload
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(right)) return right.some((value) => sameValue(left, value))
  if (right === null) return left === null || left === undefined
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right)
  return String(left ?? "") === String(right ?? "")
}

function matches(row: Record<string, unknown>, filter: WhereFilter) {
  return Object.entries(filter).every(([key, value]) => value === undefined || sameValue(row[key], value))
}

function project<T>(row: Record<string, unknown>, columns?: string): T {
  if (!columns || columns.trim() === "*") return row as T
  const fields = columns.split(",").map((field) => field.trim()).filter((field) => /^[A-Za-z0-9_]+$/.test(field))
  if (!fields.length) return row as T
  return Object.fromEntries(fields.map((field) => [field, row[field]])) as T
}

async function onlineQuery<T>(table: TableName, filter?: WhereFilter, opts?: QueryOptions): Promise<T[]> {
  const supabase = createClient()
  const scoped = withScopeFilter(table, filter)
  let query = supabase.from(table).select(opts?.columns ?? "*")
  for (const [key, value] of Object.entries(scoped)) {
    if (value === undefined) continue
    if (Array.isArray(value)) query = query.in(key, value)
    else query = value === null ? query.is(key, null) : query.eq(key, value)
  }
  if (opts?.order) query = query.order(opts.order, { ascending: opts.ascending ?? true })
  if (opts?.offset != null) query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1)
  else if (opts?.limit) query = query.limit(opts.limit)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  if (!opts?.columns || opts.columns === "*") await localDB.putTableRows(table, rows, true)
  return rows as T[]
}

async function onlineGetById<T>(table: TableName, id: string): Promise<T | null> {
  const supabase = createClient()
  let query = supabase.from(table).select("*").eq("id", id)
  const pharmacyId = getPharmacyId()
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (data) await localDB.putTableRow(table, data as Record<string, unknown>, true)
  return (data ?? null) as T | null
}

async function onlineInsert<T>(table: TableName, record: Partial<T>): Promise<T> {
  const payload = withScopePayload(table, record as Record<string, unknown>)
  const { data, error } = await createClient().from(table).insert(payload).select().single()
  if (error) throw error
  await localDB.putTableRow(table, data as Record<string, unknown>, true)
  return data as T
}

async function onlineUpdate<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
  const pharmacyId = getPharmacyId()
  let query = createClient().from(table).update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id)
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { data, error } = await query.select().single()
  if (error) throw error
  await localDB.putTableRow(table, data as Record<string, unknown>, true)
  return data as T
}

async function onlineDelete(table: TableName, id: string) {
  const supabase = createClient()
  const pharmacyId = getPharmacyId()
  let query = supabase.from(table).delete().eq("id", id)
  if (pharmacyId && shouldScopeByPharmacy(table)) query = query.eq("pharmacy_id", pharmacyId)
  const { error } = await query
  if (error) throw error
  await localDB.deleteTableRow(table, id)
}

async function offlineQuery<T>(table: TableName, filter?: WhereFilter, opts?: QueryOptions): Promise<T[]> {
  const scoped = withScopeFilter(table, filter)
  let rows = (await localDB.getTableRows(table)).filter((row) => matches(row, scoped))
  if (opts?.order) {
    const key = opts.order
    const direction = opts.ascending === false ? -1 : 1
    rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "ar", { numeric: true }) * direction)
  }
  const offset = Math.max(0, opts?.offset ?? 0)
  rows = rows.slice(offset, opts?.limit ? offset + opts.limit : undefined)
  return rows.map((row) => project<T>(row, opts?.columns))
}

async function offlineGetById<T>(table: TableName, id: string): Promise<T | null> {
  const row = await localDB.getTableRow(table, id)
  if (!row) return null
  const pharmacyId = getPharmacyId()
  if (pharmacyId && shouldScopeByPharmacy(table) && row.pharmacy_id && row.pharmacy_id !== pharmacyId) return null
  return row as T
}

async function offlineInsert<T>(table: TableName, record: Partial<T>): Promise<T> {
  const payload = withScopePayload(table, record as Record<string, unknown>)
  if (!payload.id) payload.id = crypto.randomUUID()
  if (!payload.created_at) payload.created_at = new Date().toISOString()
  payload.updated_at = new Date().toISOString()
  await localDB.putTableRow(table, payload, false)
  await localDB.queueMutation({ id: crypto.randomUUID(), table, operation: "create", data: payload, created_at: new Date().toISOString() })
  return payload as T
}

async function offlineUpdate<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
  const existing = await offlineGetById<Record<string, unknown>>(table, id)
  if (!existing) throw new Error(`السجل غير موجود محليًا في ${table}`)
  const updated = { ...existing, ...updates, id, updated_at: new Date().toISOString() }
  await localDB.putTableRow(table, updated, false)
  await localDB.queueMutation({ id: crypto.randomUUID(), table, operation: "update", data: updated, created_at: new Date().toISOString() })
  return updated as T
}

async function offlineDelete(table: TableName, id: string) {
  const existing = await offlineGetById<Record<string, unknown>>(table, id)
  if (!existing) return
  await localDB.deleteTableRow(table, id)
  await localDB.queueMutation({ id: crypto.randomUUID(), table, operation: "delete", data: { id, pharmacy_id: existing.pharmacy_id }, created_at: new Date().toISOString() })
}

export const dataLayer = {
  async query<T>(table: TableName, filter?: WhereFilter, opts?: QueryOptions): Promise<T[]> {
    if (await network.check()) {
      try { return await onlineQuery<T>(table, filter, opts) } catch { /* use local */ }
    }
    return offlineQuery<T>(table, filter, opts)
  },
  async getById<T>(table: TableName, id: string): Promise<T | null> {
    if (await network.check()) {
      try { return await onlineGetById<T>(table, id) } catch { /* use local */ }
    }
    return offlineGetById<T>(table, id)
  },
  async insert<T>(table: TableName, record: Partial<T>): Promise<T> {
    if (await network.check()) {
      try { return await onlineInsert<T>(table, record) } catch { /* queue local */ }
    }
    return offlineInsert<T>(table, record)
  },
  async update<T>(table: TableName, id: string, updates: Partial<T>): Promise<T> {
    if (await network.check()) {
      try { return await onlineUpdate<T>(table, id, updates) } catch { /* queue local */ }
    }
    return offlineUpdate<T>(table, id, updates)
  },
  async delete(table: TableName, id: string): Promise<void> {
    if (await network.check()) {
      try { await onlineDelete(table, id); return } catch { /* queue local */ }
    }
    await offlineDelete(table, id)
  },
  async exists(table: TableName, filter: WhereFilter) {
    return (await this.query<Record<string, unknown>>(table, filter, { limit: 1 })).length > 0
  },
  async count(table: TableName, filter?: WhereFilter) {
    if (await network.check()) {
      try {
        let query = createClient().from(table).select("*", { count: "exact", head: true })
        const scoped = withScopeFilter(table, filter)
        for (const [key, value] of Object.entries(scoped)) {
          if (value === undefined) continue
          if (Array.isArray(value)) query = query.in(key, value)
          else query = value === null ? query.is(key, null) : query.eq(key, value)
        }
        const { count, error } = await query
        if (error) throw error
        return count ?? 0
      } catch { /* local */ }
    }
    return (await offlineQuery<Record<string, unknown>>(table, filter)).length
  },
}
