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

export class SyncManager {
  private isSyncing = false
  private listeners: Set<Listener> = new Set()
  private _lastSync: string | null = null
  private _online = network.isOnline
  private _pendingMutations = 0
  private syncTimer: ReturnType<typeof setInterval> | null = null

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
    return {
      isSyncing: this.isSyncing,
      pendingMutations: this._pendingMutations,
      lastSync: this._lastSync,
      online: this._online,
    }
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
    try {
      this._pendingMutations = await localDB.countMutations()
    } catch {
      this._pendingMutations = 0
    }
    this.notify()
  }

  startAutoSync(intervalMs = 30000) {
    this.stopAutoSync()
    this.syncTimer = setInterval(() => {
      if (this._online) void this.sync()
    }, intervalMs)
  }

  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  async sync() {
    if (this.isSyncing || !this._online) return
    this.isSyncing = true
    await this.refreshPending()
    this.notify()

    let syncedCount = 0
    let failedCount = 0

    try {
      const mutations = await localDB.getMutations()
      const supabase = createClient()

      for (const mutation of mutations) {
        try {
          const { table, operation, data } = mutation as unknown as {
            table: string
            operation: "create" | "update" | "delete"
            data: Record<string, unknown>
          }

          if (table === API_MUTATION_TABLE || table === LEGACY_ITEM_API_MUTATION_TABLE) {
            const apiRequest = data as unknown as QueuedApiRequest
            const response = await fetch(apiRequest.path, {
              method: apiRequest.method,
              headers: { "Content-Type": "application/json", ...(apiRequest.headers ?? {}) },
              body: apiRequest.method === "DELETE" && !apiRequest.body ? undefined : JSON.stringify(apiRequest.body ?? {}),
            })
            const payload = await response.json().catch(() => ({})) as { error?: string }
            if (!response.ok) throw new Error(payload.error ?? `فشل مزامنة ${apiRequest.label ?? "العملية"}`)
          } else if (operation === "create") {
            const { error } = await supabase.from(table).insert(data)
            if (error) throw error
          } else if (operation === "update") {
            const { id, ...updates } = data
            const { error } = await supabase
              .from(table)
              .update({ ...updates, updated_at: new Date().toISOString() })
              .eq("id", id as string)
            if (error) throw error
          } else if (operation === "delete") {
            const { error } = await supabase.from(table).delete().eq("id", data.id as string)
            if (error) throw error
          }

          await localDB.deleteMutation(mutation.id)
          syncedCount++
          await localDB.addSyncLog({
            id: `sync_${mutation.id}_${Date.now()}`,
            table,
            action: operation,
            status: "success",
            timestamp: new Date().toISOString(),
            details: "تمت مزامنة التغيير المحلي مع الخادم",
          })
        } catch (error) {
          failedCount++
          await localDB.addSyncLog({
            id: `sync_failed_${mutation.id}_${Date.now()}`,
            table: mutation.table,
            action: mutation.operation,
            status: "failed",
            timestamp: new Date().toISOString(),
            details: error instanceof Error ? error.message : "فشل مزامنة تغيير محلي وسيعاد المحاولة لاحقًا",
          })
        }
      }

      this._lastSync = new Date().toISOString()
      if (mutations.length === 0) {
        await localDB.addSyncLog({
          id: `sync_idle_${Date.now()}`,
          table: "all",
          action: "sync",
          status: "success",
          timestamp: this._lastSync,
          details: "لا توجد تغييرات معلقة للمزامنة",
        })
      } else {
        await localDB.addSyncLog({
          id: `sync_summary_${Date.now()}`,
          table: "all",
          action: "sync",
          status: failedCount > 0 ? "warning" : "success",
          timestamp: this._lastSync,
          details: `تمت مزامنة ${syncedCount} تغيير، وفشل ${failedCount} تغيير`,
        })
      }
    } finally {
      this.isSyncing = false
      await this.refreshPending()
      this.notify()
    }
  }

  async syncTable(table: string) {
    if (!this._online || this.isSyncing) return

    try {
      const supabase = createClient()
      const lastSync = await localSQLite.getLastSync(table)
      const syncVersion = lastSync ? parseInt(lastSync) || 0 : 0

      let query = supabase
        .from(table)
        .select("*")
        .order("updated_at", { ascending: true })

      if (lastSync) query = query.gt("updated_at", lastSync)

      const { data, error } = await query
      if (error) throw error

      if (data && Array.isArray(data)) {
        for (const row of data) await localSQLite.insert(table, row as Record<string, unknown>)
      }

      await localSQLite.setLastSync(table, syncVersion + 1)
      await localDB.addSyncLog({
        id: `pull_${table}_${Date.now()}`,
        table,
        action: "pull",
        status: "success",
        timestamp: new Date().toISOString(),
        details: `تم تحديث ${data?.length ?? 0} سجل من الخادم`,
      })
    } catch (error) {
      await localDB.addSyncLog({
        id: `pull_failed_${table}_${Date.now()}`,
        table,
        action: "pull",
        status: "failed",
        timestamp: new Date().toISOString(),
        details: error instanceof Error ? error.message : "فشل تحديث الجدول من الخادم",
      })
    }
  }

  async forceSync() {
    return this.sync()
  }

  destroy() {
    this.stopAutoSync()
    this.listeners.clear()
  }
}

export const syncManager = new SyncManager()
