"use client"

import { localDB } from "@/lib/sync/local-db"
import type { DashboardHomePayload } from "../types"

const MEMORY_TTL_MS = 2 * 60 * 1000
const LOCAL_DB_TTL_MS = 15 * 60 * 1000

const memoryCache = new Map<string, { at: number; data: DashboardHomePayload }>()

function memoryKey(key: string) {
  return `dashboard-home:${key}`
}

function storageKey(key: string) {
  return `dashboard-home-v3:${key}`
}

function isValidPayload(value: unknown): value is DashboardHomePayload {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<DashboardHomePayload>
  return Boolean(candidate.generatedAt && candidate.kpis && candidate.tables)
}

export function getMemoryDashboardPayload(key: string): DashboardHomePayload | null {
  const entry = memoryCache.get(memoryKey(key))
  if (!entry) return null
  if (Date.now() - entry.at > MEMORY_TTL_MS) {
    memoryCache.delete(memoryKey(key))
    return null
  }
  return entry.data
}

export function setMemoryDashboardPayload(key: string, data: DashboardHomePayload) {
  memoryCache.set(memoryKey(key), { at: Date.now(), data })
}

export function getSessionDashboardPayload(key: string): DashboardHomePayload | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: unknown }
    if (Date.now() - parsed.at > MEMORY_TTL_MS || !isValidPayload(parsed.data)) return null
    setMemoryDashboardPayload(key, parsed.data)
    return parsed.data
  } catch {
    return null
  }
}

export function setSessionDashboardPayload(key: string, data: DashboardHomePayload) {
  setMemoryDashboardPayload(key, data)
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify({ at: Date.now(), data }))
  } catch {
    // Ignore storage limits; memory cache is enough for the current page lifecycle.
  }
}

export async function getLocalDashboardPayload(key: string): Promise<DashboardHomePayload | null> {
  try {
    const cached = await localDB.getCache(storageKey(key))
    if (!isValidPayload(cached)) return null
    setSessionDashboardPayload(key, cached)
    return cached
  } catch {
    return null
  }
}

export async function setLocalDashboardPayload(key: string, data: DashboardHomePayload): Promise<void> {
  setSessionDashboardPayload(key, data)
  try {
    await localDB.setCache(storageKey(key), data, LOCAL_DB_TTL_MS)
  } catch {
    // IndexedDB can be blocked in private mode; keep the UI fast with memory/session cache.
  }
}

export function mergeDashboardPayload(base: DashboardHomePayload, next: DashboardHomePayload): DashboardHomePayload {
  const nextTablesEmpty = Object.values(next.tables).every((rows) => rows.length === 0)
  return {
    ...base,
    ...next,
    tables: nextTablesEmpty ? base.tables : next.tables,
  }
}
