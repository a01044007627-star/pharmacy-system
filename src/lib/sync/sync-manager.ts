"use client"

import { localDB } from "./local-db"
import { localSQLite } from "./local-sqlite"
import { createClient } from "@/lib/supabase/client"
import { network } from "@/lib/network"
import { API_MUTATION_TABLE, LEGACY_ITEM_API_MUTATION_TABLE, type QueuedApiRequest } from "./api-mutations"

export interface SyncStatus {
  isSyncing: boolean
  pendingMutations: number
  lastSync: string | null
  online: boolean
}

type Listener = (status: SyncStatus) => void

const CORE_OFFLINE_TABLES = [
  "pharmacy_branches",
  "pharmacy_items",
  "pharmacy_item_barcodes",
  "pharmacy_item_units",
  "pharmacy_item_batches",
  "pharmacy_item_groups",
  "pharmacy_item_brands",
  "pharmacy_stock_balances",
  "pharmacy_partners",
  "pharmacy_settings",
  "pharmacy_tax_rates",
  "pharmacy_shifts",
  "pharmacy_chart_of_accounts",
  "pharmacy_journal_entries",
  "pharmacy_journal_lines",
  "pharmacy_financial_movements",
  "pharmacy_cash_registers",
] as const

const MAX_RETRIES = 5
const CORE_SYNC_INTERVAL = 6 * 60 * 60 * 1000
const CORE_SYNC_KEY = "pharmacy-core-offline-sync"

export class SyncManager {
  private isSyncing = false
  private listeners = new Set<Listener>()
  private _lastSync: string | null = null
  private _online = network.isOnline
  private _pendingMutations = 0
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private coreSyncPromise: Promise<void> | null = null

  constructor() {
    network.subscribe((online) => {
      this._online = online
      void this.refreshPending()
      this.notify()
      if (online) void this.sync()
    })
    if (typeof window !== "undefined") void this.refreshPending()
  }

  get status(): SyncStatus {
    return { isSyncing: this.isSyncing, pendingMutations: this._pendingMutations, lastSync: this._lastSync, online: this._online }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    void this.refreshPending().then(() => listener(this.status))
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const status = this.status
    this.listeners.forEach((listener) => listener(status))
  }

  async refreshPending() {
    try { this._pendingMutations = await localDB.countMutations() } catch { this._pendingMutations = 0 }
    this.notify()
  }

  startAutoSync(intervalMs = 30_000) {
    this.stopAutoSync()
    this.syncTimer = setInterval(() => { if (this._online) void this.sync() }, intervalMs)
  }

  stopAutoSync() {
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
  }

  async sync() {
    if (this.isSyncing) return
    const reachable = await network.check()
    if (!reachable) return
    this._online = true
    this.isSyncing = true
    await this.refreshPending()
    this.notify()

    let syncedCount = 0
    let failedCount = 0
    try {
      const mutations = (await localDB.getMutations()).sort((a, b) => a.created_at.localeCompare(b.created_at))
      const supabase = createClient()

      for (const mutation of mutations) {
        if (!(await network.check())) break
        const { table, operation, data } = mutation as unknown as {
          table: string
          operation: "create" | "update" | "delete"
          data: Record<string, unknown>
        }
        const retryCount = (mutation as unknown as { retry_count?: number }).retry_count ?? 0

        if (retryCount >= MAX_RETRIES) {
          await localDB.addDeadLetter({
            id: mutation.id,
            table,
            operation,
            data,
            created_at: mutation.created_at,
            last_error: `تجاوز الحد الأقصى للمحاولات (${MAX_RETRIES})`,
            failed_at: new Date().toISOString(),
          })
          await localDB.deleteMutation(mutation.id)
          failedCount += 1
          await localDB.addSyncLog({ id: `deadletter_${mutation.id}_${Date.now()}`, table, action: operation, status: "failed", timestamp: new Date().toISOString(), details: `تم نقل التغيير إلى القائمة المهملة بعد ${MAX_RETRIES} محاولات فاشلة` })
          continue
        }

        try {
          if (table === API_MUTATION_TABLE || table === LEGACY_ITEM_API_MUTATION_TABLE) {
            const apiRequest = data as unknown as QueuedApiRequest
            const response = await fetch(apiRequest.path, {
              method: apiRequest.method,
              credentials: "same-origin",
              cache: "no-store",
              headers: {
                "Content-Type": "application/json",
                "X-Idempotency-Key": mutation.id,
                ...(apiRequest.headers ?? {}),
              },
              body: apiRequest.method === "DELETE" && !apiRequest.body ? undefined : JSON.stringify(apiRequest.body ?? {}),
            })
            const payload = await response.json().catch(() => ({})) as { error?: string }
            if (!response.ok) throw new Error(payload.error ?? `فشل مزامنة ${apiRequest.label ?? "العملية"}`)
          } else if (operation === "create") {
            const { error } = await supabase.from(table).insert(data)
            if (error) throw error
          } else if (operation === "update") {
            const { id, pharmacy_id, ...updates } = data
            let query = supabase.from(table).update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id as string)
            const scopeId = String(pharmacy_id ?? (typeof window !== "undefined" ? localStorage.getItem("active-pharmacy-id") : "") ?? "")
            if (scopeId && table.startsWith("pharmacy_")) query = query.eq("pharmacy_id", scopeId)
            const { error } = await query
            if (error) throw error
          } else {
            const id = String(data.id ?? "")
            let query = supabase.from(table).delete().eq("id", id)
            const scopeId = String(data.pharmacy_id ?? (typeof window !== "undefined" ? localStorage.getItem("active-pharmacy-id") : "") ?? "")
            if (scopeId && table.startsWith("pharmacy_")) query = query.eq("pharmacy_id", scopeId)
            const { error } = await query
            if (error) throw error
          }

          await localDB.deleteMutation(mutation.id)
          syncedCount += 1
          await localDB.addSyncLog({ id: `sync_${mutation.id}_${Date.now()}`, table, action: operation, status: "success", timestamp: new Date().toISOString(), details: "تمت مزامنة التغيير المحلي مع الخادم" })
        } catch (error) {
          failedCount += 1
          const newRetryCount = retryCount + 1

          if (newRetryCount >= MAX_RETRIES) {
            await localDB.addDeadLetter({
              id: mutation.id,
              table,
              operation,
              data,
              created_at: mutation.created_at,
              last_error: error instanceof Error ? error.message : "فشل المزامنة",
              failed_at: new Date().toISOString(),
            })
            await localDB.deleteMutation(mutation.id)
          } else {
            await localDB.updateMutationRetry(mutation.id, newRetryCount)
          }

          await localDB.addSyncLog({ id: `sync_failed_${mutation.id}_${Date.now()}`, table, action: operation, status: "failed", timestamp: new Date().toISOString(), details: error instanceof Error ? error.message : "فشل مزامنة تغيير محلي وسيعاد المحاولة لاحقًا" })
          if (!(await network.check())) break
        }
      }

      this._lastSync = new Date().toISOString()
      await localDB.addSyncLog({
        id: `sync_summary_${Date.now()}`,
        table: "all",
        action: "sync",
        status: failedCount ? "warning" : "success",
        timestamp: this._lastSync,
        details: syncedCount || failedCount ? `تمت مزامنة ${syncedCount} تغيير، وفشل ${failedCount} تغيير` : "لا توجد تغييرات معلقة للمزامنة",
      })

      const userResponse = await supabase.auth.getUser()
      const userId = userResponse.data.user?.id
      if (userId && failedCount > 0) {
        try {
          await supabase.from("pharmacy_inapp_notifications").insert({
            user_id: userId,
            title: "فشلت المزامنة",
            description: `فشلت مزامنة ${failedCount} تغيير. تم نقلها إلى قائمة الانتظار للمحاولة لاحقًا.`,
            notif_type: "error",
            href: "/dashboard/sync",
          })
        } catch { /* non-critical */ }
      }
      if (userId && failedCount === 0 && syncedCount > 0) {
        try {
          await supabase.from("pharmacy_inapp_notifications").insert({
            user_id: userId,
            title: "تمت المزامنة بنجاح",
            description: `تمت مزامنة ${syncedCount} تغيير بنجاح.`,
            notif_type: "success",
            href: "/dashboard/sync",
          })
        } catch { /* non-critical */ }
      }
    } finally {
      this.isSyncing = false
      await this.refreshPending()
      this.notify()
    }
  }

  async syncTable(table: string): Promise<boolean> {
    if (!(await network.check()) || typeof window === "undefined") return false
    const pharmacyId = window.localStorage.getItem("active-pharmacy-id")
    if (!pharmacyId) return false
    try {
      const supabase = createClient()
      const allRows: Record<string, unknown>[] = []
      let offset = 0
      const pageSize = 1000
      while (true) {
        if (!(await network.check())) throw new Error("انقطع الاتصال أثناء تنزيل البيانات")
        const { data, error } = await supabase.from(table).select("*").eq("pharmacy_id", pharmacyId).range(offset, offset + pageSize - 1)
        if (error) throw error
        const rows = (data ?? []) as Record<string, unknown>[]
        allRows.push(...rows)
        if (rows.length < pageSize) break
        offset += pageSize
      }

      await localDB.clearTable(table)
      await localDB.putTableRows(table, allRows, true)
      await localSQLite.setLastSync(table, Date.now())
      await localDB.addSyncLog({ id: `pull_${table}_${Date.now()}`, table, action: "pull", status: "success", timestamp: new Date().toISOString(), details: `تم تجهيز ${allRows.length} سجل محلي للعمل دون إنترنت` })
      return true
    } catch (error) {
      await localDB.addSyncLog({ id: `pull_failed_${table}_${Date.now()}`, table, action: "pull", status: "failed", timestamp: new Date().toISOString(), details: error instanceof Error ? error.message : "فشل تحديث الجدول من الخادم" })
      return false
    }
  }

  async syncCoreData(force = false) {
    if (typeof window === "undefined" || !(await network.check())) return
    if (this.coreSyncPromise) return this.coreSyncPromise
    const pharmacyId = window.localStorage.getItem("active-pharmacy-id")
    if (!pharmacyId) return
    const stampKey = `${CORE_SYNC_KEY}:${pharmacyId}`
    const last = Number(window.localStorage.getItem(stampKey) ?? 0)
    if (!force && Number.isFinite(last) && Date.now() - last < CORE_SYNC_INTERVAL) return

    this.coreSyncPromise = (async () => {
      let complete = true
      for (const table of CORE_OFFLINE_TABLES) {
        if (!(await network.check())) { complete = false; break }
        if (!(await this.syncTable(table))) complete = false
      }
      if (complete) window.localStorage.setItem(stampKey, String(Date.now()))
    })().finally(() => { this.coreSyncPromise = null })
    return this.coreSyncPromise
  }

  async forceSync() { return this.sync() }
  destroy() { this.stopAutoSync(); this.listeners.clear() }
}

export const syncManager = new SyncManager()
