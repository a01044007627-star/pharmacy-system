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
    value: {
      id: string
      type: string
      data: unknown
      synced: boolean
      updated_at: string
    }
    indexes: { "type": string; "synced": number }
  }
  mutations: {
    key: string
    value: {
      id: string
      table: string
      operation: "create" | "update" | "delete"
      data: unknown
      created_at: string
    }
  }
  cache: {
    key: string
    value: {
      key: string
      data: unknown
      expires_at: number
    }
    indexes: { "expires_at": number }
  }
  syncLogs: {
    key: string
    value: SyncLogEntry
    indexes: { "timestamp": string; "status": string }
  }
}

const DB_NAME = "pharmacy-offline"
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<PharmacyDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PharmacyDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("documents")) {
          const docs = db.createObjectStore("documents", { keyPath: "id" })
          docs.createIndex("type", "type")
          docs.createIndex("synced", "synced")
        }
        if (!db.objectStoreNames.contains("mutations")) {
          db.createObjectStore("mutations", { keyPath: "id" })
        }
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
  async getDocument(id: string) {
    const db = await getDB()
    return db.get("documents", id)
  },
  async getAllDocuments(type?: string) {
    const db = await getDB()
    if (type) return db.getAllFromIndex("documents", "type", type)
    return db.getAll("documents")
  },
  async putDocument(doc: PharmacyDB["documents"]["value"]) {
    const db = await getDB()
    return db.put("documents", doc)
  },
  async deleteDocument(id: string) {
    const db = await getDB()
    return db.delete("documents", id)
  },
  async getUnsyncedDocuments() {
    const db = await getDB()
    return db.getAllFromIndex("documents", "synced", 0)
  },
  async queueMutation(mutation: PharmacyDB["mutations"]["value"]) {
    const db = await getDB()
    await db.put("mutations", mutation)
    await this.addSyncLog({
      id: `queue_${mutation.id}`,
      table: mutation.table,
      action: mutation.operation,
      status: "warning",
      timestamp: new Date().toISOString(),
      details: "تمت إضافة تغيير محلي في انتظار المزامنة",
    })
  },
  async getMutations() {
    const db = await getDB()
    return db.getAll("mutations")
  },
  async countMutations() {
    const db = await getDB()
    return db.count("mutations")
  },
  async deleteMutation(id: string) {
    const db = await getDB()
    return db.delete("mutations", id)
  },
  async addSyncLog(entry: SyncLogEntry) {
    const db = await getDB()
    await db.put("syncLogs", entry)
    const logs = await db.getAllFromIndex("syncLogs", "timestamp")
    if (logs.length > 200) {
      const toDelete = logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, logs.length - 200)
      await Promise.all(toDelete.map((log) => db.delete("syncLogs", log.id)))
    }
  },
  async getSyncLogs(limit = 100) {
    const db = await getDB()
    const logs = await db.getAllFromIndex("syncLogs", "timestamp")
    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  },
  async clearSyncLogs() {
    const db = await getDB()
    return db.clear("syncLogs")
  },
  async setCache(key: string, data: unknown, ttlMs = 5 * 60 * 1000) {
    const db = await getDB()
    return db.put("cache", { key, data, expires_at: Date.now() + ttlMs })
  },
  async getCache(key: string) {
    const db = await getDB()
    const entry = await db.get("cache", key)
    if (!entry || entry.expires_at < Date.now()) return null
    return entry.data
  },
}
