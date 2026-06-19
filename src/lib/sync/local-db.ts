import { openDB, type IDBPDatabase, type DBSchema } from "idb"

export type SyncLogEntry = {
  id: string
  table: string
  action: string
  status: "success" | "failed" | "warning"
  timestamp: string
  details: string
}

interface PharmacyDB extends DBSchema {
  documents: {
    key: string
    value: { id: string; type: string; data: unknown; synced: boolean; updated_at: string }
    indexes: { "type": string; "synced": number }
  }
  mutations: {
    key: string
    value: { id: string; table: string; operation: "create" | "update" | "delete"; data: unknown; created_at: string }
  }
  cache: {
    key: string
    value: { key: string; data: unknown; expires_at: number }
    indexes: { "expires_at": number }
  }
  syncLogs: {
    key: string
    value: SyncLogEntry
    indexes: { "timestamp": string; "status": string }
  }
}

const DB_NAME = "pharmacy-offline"
const DB_VERSION = 3
let dbPromise: Promise<IDBPDatabase<PharmacyDB>> | null = null

function tableDocumentKey(table: string, id: string) { return `table:${table}:${id}` }

const COMPOSITE_KEYS: Record<string, string[]> = {
  pharmacy_stock_balances: ["pharmacy_id", "item_id", "branch_id"],
  pharmacy_daily_summary: ["pharmacy_id", "branch_id", "summary_date"],
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function tableRowKey(table: string, row: Record<string, unknown>) {
  const directId = String(row.id ?? "").trim()
  if (directId) return directId
  const fields = COMPOSITE_KEYS[table]
  if (!fields) return ""
  const values = fields.map((field) => String(row[field] ?? "").trim())
  if (values.some((value) => !value)) return ""
  return values.map(encodeURIComponent).join(":")
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PharmacyDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("documents")) {
          const docs = db.createObjectStore("documents", { keyPath: "id" })
          docs.createIndex("type", "type")
          docs.createIndex("synced", "synced")
        }
        if (!db.objectStoreNames.contains("mutations")) db.createObjectStore("mutations", { keyPath: "id" })
        if (!db.objectStoreNames.contains("cache")) {
          const cache = db.createObjectStore("cache", { keyPath: "key" })
          cache.createIndex("expires_at", "expires_at")
        }
        if (!db.objectStoreNames.contains("syncLogs")) {
          const logs = db.createObjectStore("syncLogs", { keyPath: "id" })
          logs.createIndex("timestamp", "timestamp")
          logs.createIndex("status", "status")
        }
      },
    })
  }
  return dbPromise
}

export const localDB = {
  async getDocument(id: string) { return (await getDB()).get("documents", id) },
  async getAllDocuments(type?: string) {
    const db = await getDB()
    return type ? db.getAllFromIndex("documents", "type", type) : db.getAll("documents")
  },
  async putDocument(doc: PharmacyDB["documents"]["value"]) { return (await getDB()).put("documents", doc) },
  async deleteDocument(id: string) { return (await getDB()).delete("documents", id) },
  async putTableRow(table: string, row: Record<string, unknown>, synced = true) {
    const id = tableRowKey(table, row)
    if (!id) throw new Error(`لا يمكن تخزين سجل محلي بدون مفتاح ثابت في ${table}`)
    const db = await getDB()
    const key = tableDocumentKey(table, id)
    const existing = await db.get("documents", key)
    const previous = asRecord(existing?.data)
    await db.put("documents", {
      id: key,
      type: table,
      data: { ...(previous ?? {}), ...row },
      synced,
      updated_at: String(row.updated_at ?? new Date().toISOString()),
    })
  },
  async putTableRows(table: string, rows: Record<string, unknown>[], synced = true) {
    if (!rows.length) return
    const db = await getDB()
    const tx = db.transaction("documents", "readwrite")
    for (const row of rows) {
      const id = tableRowKey(table, row)
      if (!id) continue
      const key = tableDocumentKey(table, id)
      const existing = await tx.store.get(key)
      const previous = asRecord(existing?.data)
      await tx.store.put({
        id: key,
        type: table,
        data: { ...(previous ?? {}), ...row },
        synced,
        updated_at: String(row.updated_at ?? new Date().toISOString()),
      })
    }
    await tx.done
  },
  async getTableRow(table: string, id: string) {
    const doc = await (await getDB()).get("documents", tableDocumentKey(table, id))
    return asRecord(doc?.data)
  },
  async getTableRows(table: string) {
    const docs = await (await getDB()).getAllFromIndex("documents", "type", table)
    return docs.map((doc) => asRecord(doc.data)).filter((row): row is Record<string, unknown> => Boolean(row))
  },
  async deleteTableRow(table: string, id: string) { return (await getDB()).delete("documents", tableDocumentKey(table, id)) },
  async clearTable(table: string) {
    const db = await getDB()
    const keys = await db.getAllKeysFromIndex("documents", "type", table)
    const tx = db.transaction("documents", "readwrite")
    await Promise.all(keys.map((key) => tx.store.delete(key)))
    await tx.done
  },
  async getUnsyncedDocuments() { return (await getDB()).getAllFromIndex("documents", "synced", 0) },
  async queueMutation(mutation: PharmacyDB["mutations"]["value"]) {
    const db = await getDB()
    await db.put("mutations", mutation)
    await this.addSyncLog({ id: `queue_${mutation.id}`, table: mutation.table, action: mutation.operation, status: "warning", timestamp: new Date().toISOString(), details: "تمت إضافة تغيير محلي في انتظار المزامنة" })
  },
  async getMutations() { return (await getDB()).getAll("mutations") },
  async countMutations() { return (await getDB()).count("mutations") },
  async deleteMutation(id: string) { return (await getDB()).delete("mutations", id) },
  async addSyncLog(entry: SyncLogEntry) {
    const db = await getDB()
    await db.put("syncLogs", entry)
    const logs = await db.getAllFromIndex("syncLogs", "timestamp")
    if (logs.length > 200) {
      const old = logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, logs.length - 200)
      await Promise.all(old.map((log) => db.delete("syncLogs", log.id)))
    }
  },
  async getSyncLogs(limit = 100) {
    const logs = await (await getDB()).getAllFromIndex("syncLogs", "timestamp")
    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  },
  async clearSyncLogs() { return (await getDB()).clear("syncLogs") },
  async setCache(key: string, data: unknown, ttlMs = 5 * 60 * 1000) {
    return (await getDB()).put("cache", { key, data, expires_at: Date.now() + ttlMs })
  },
  async getCache(key: string, allowExpired = false) {
    const entry = await (await getDB()).get("cache", key)
    if (!entry || (!allowExpired && entry.expires_at < Date.now())) return null
    return entry.data
  },
  async getStaleCache(key: string) { return this.getCache(key, true) },
}
