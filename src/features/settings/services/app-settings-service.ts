"use client"

import { SETTINGS_DEFAULTS, flattenDefaultSettings, SETTINGS_UPDATED_EVENT, type SettingsNamespace } from "../lib/settings-keys"
import { localDB } from "@/lib/sync/local-db"
import { network } from "@/lib/network"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { syncManager } from "@/lib/sync/sync-manager"

const GLOBAL_SETTING_NAMESPACES = new Set<SettingsNamespace>(["system"])
const SETTINGS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000

export interface PharmacySettingRow {
  id: string
  pharmacy_id: string | null
  key: string
  value: string
  description?: string | null
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

type SettingsApiResponse = {
  settings?: Record<string, string>
  rows?: PharmacySettingRow[]
  error?: string
  pharmacyId?: string | null
  saved?: number
  ok?: boolean
}

function getActivePharmacyId() { return typeof window === "undefined" ? null : localStorage.getItem("active-pharmacy-id") }
function getActiveBranchId() { return typeof window === "undefined" ? null : localStorage.getItem("active-branch-id") }
function cacheKey(kind: string, namespace?: string | null, pharmacyId = getActivePharmacyId()) {
  return `settings:${kind}:${pharmacyId ?? "global"}:${getActiveBranchId() ?? "all"}:${namespace ?? "all"}`
}

async function readJson(response: Response): Promise<SettingsApiResponse> {
  const data = (await response.json().catch(() => ({}))) as SettingsApiResponse
  if (!response.ok) throw new Error(data.error ?? "فشل تنفيذ عملية الإعدادات")
  return data
}

function buildSettingsUrl(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  return search.size ? `/api/settings?${search.toString()}` : "/api/settings"
}

export function notifySettingsUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT))
}

async function fetchOrCache<T>(key: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  if (await network.check()) {
    try {
      const value = await loader()
      await localDB.setCache(key, value, SETTINGS_CACHE_TTL)
      return value
    } catch { /* stale cache */ }
  }
  return (await localDB.getStaleCache(key) as T | null) ?? fallback
}

export const AppSettingsService = {
  isGlobalNamespace(namespace?: SettingsNamespace) { return Boolean(namespace && GLOBAL_SETTING_NAMESPACES.has(namespace)) },

  async fetchRows(pharmacyId = getActivePharmacyId()): Promise<PharmacySettingRow[]> {
    return fetchOrCache(cacheKey("rows", null, pharmacyId), async () => {
      const data = await readJson(await fetch(buildSettingsUrl({ mode: "rows", pharmacy_id: pharmacyId }), { cache: "no-store" }))
      return data.rows ?? []
    }, [])
  },

  async fetchGlobalRows(): Promise<PharmacySettingRow[]> {
    return fetchOrCache(cacheKey("rows", "system", null), async () => {
      const data = await readJson(await fetch(buildSettingsUrl({ mode: "rows", namespace: "system" }), { cache: "no-store" }))
      return data.rows ?? []
    }, [])
  },

  async fetchSettingsMap(pharmacyId = getActivePharmacyId()): Promise<Record<string, string>> {
    const defaults = flattenDefaultSettings()
    return fetchOrCache(cacheKey("map", null, pharmacyId), async () => {
      const data = await readJson(await fetch(buildSettingsUrl({ mode: "all", pharmacy_id: pharmacyId, branch_id: getActiveBranchId() }), { cache: "no-store" }))
      return { ...defaults, ...(data.settings ?? {}) }
    }, defaults)
  },

  async fetchNamespace(namespace: SettingsNamespace, defaults: Record<string, string>): Promise<Record<string, string>> {
    const pharmacyId = this.isGlobalNamespace(namespace) ? null : getActivePharmacyId()
    return fetchOrCache(cacheKey("namespace", namespace, pharmacyId), async () => {
      const data = await readJson(await fetch(buildSettingsUrl({ namespace, pharmacy_id: pharmacyId, branch_id: getActiveBranchId() }), { cache: "no-store" }))
      return { ...defaults, ...(data.settings ?? {}) }
    }, { ...defaults })
  },

  async set(key: string, value: string, options?: { global?: boolean }) {
    await this.setMany({ [key]: value }, options?.global ? "system" : undefined)
  },

  async setGlobal(key: string, value: string) { await this.setMany({ [key]: value }, "system") },

  async setMany(settings: Record<string, string>, namespace?: SettingsNamespace) {
    const pharmacyId = this.isGlobalNamespace(namespace) ? null : getActivePharmacyId()
    const payload = {
      namespace,
      pharmacyId,
      branchId: getActiveBranchId(),
      settings: namespace ? settings : Object.fromEntries(Object.entries(settings).filter(([key]) => key.includes(".") || SETTINGS_DEFAULTS.system[key] !== undefined)),
    }

    const applyLocal = async () => {
      const mapKey = cacheKey("map", null, pharmacyId)
      const currentMap = (await localDB.getStaleCache(mapKey) as Record<string, string> | null) ?? flattenDefaultSettings()
      await localDB.setCache(mapKey, { ...currentMap, ...payload.settings }, SETTINGS_CACHE_TTL)
      if (namespace) {
        const namespaceKey = cacheKey("namespace", namespace, pharmacyId)
        const currentNamespace = (await localDB.getStaleCache(namespaceKey) as Record<string, string> | null) ?? {}
        await localDB.setCache(namespaceKey, { ...currentNamespace, ...payload.settings }, SETTINGS_CACHE_TTL)
      }
      notifySettingsUpdated()
    }

    if (await network.check()) {
      try {
        await readJson(await fetch("/api/settings", {
          method: "PATCH",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }))
        await applyLocal()
        return
      } catch { /* queue */ }
    }

    await queueApiRequest({ path: "/api/settings", method: "PATCH", body: payload as unknown as Record<string, unknown>, label: "تعديل إعدادات أوفلاين" })
    await applyLocal()
    await syncManager.refreshPending()
  },
}
