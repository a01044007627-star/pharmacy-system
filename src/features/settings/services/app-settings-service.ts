"use client"

import { SETTINGS_DEFAULTS, flattenDefaultSettings, SETTINGS_UPDATED_EVENT, type SettingsNamespace } from "../lib/settings-keys"
import { localDB } from "@/lib/sync/local-db"
import { network } from "@/lib/network"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { syncManager } from "@/lib/sync/sync-manager"
import { ApiError } from "@/lib/http/api-error"
import { apiClient, isNetworkError, type QueryParams } from "@/lib/http/api-client"

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
  pharmacyId?: string | null
  saved?: number
  ok?: boolean
}

type SettingsWritePayload = {
  namespace?: SettingsNamespace
  pharmacyId: string | null
  branchId: string | null
  settings: Record<string, string>
}

function getStorageValue(key: string) {
  return typeof window === "undefined" ? null : localStorage.getItem(key)
}

function getActivePharmacyId() {
  return getStorageValue("active-pharmacy-id")
}

function getActiveBranchId() {
  return getStorageValue("active-branch-id")
}

function cacheKey(kind: string, namespace?: string | null, pharmacyId = getActivePharmacyId()) {
  return `settings:${kind}:${pharmacyId ?? "global"}:${getActiveBranchId() ?? "all"}:${namespace ?? "all"}`
}

function shouldUseOfflineFallback(error: unknown) {
  return isNetworkError(error) || (error instanceof ApiError && error.isRetryable)
}

export function notifySettingsUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT))
}

export class AppSettingsRepository {
  isGlobalNamespace(namespace?: SettingsNamespace) {
    return Boolean(namespace && GLOBAL_SETTING_NAMESPACES.has(namespace))
  }

  async fetchRows(pharmacyId = getActivePharmacyId()): Promise<PharmacySettingRow[]> {
    return this.fetchOrCache(cacheKey("rows", null, pharmacyId), async () => {
      const data = await this.fetchSettings({ mode: "rows", pharmacy_id: pharmacyId })
      return data.rows ?? []
    }, [])
  }

  async fetchGlobalRows(): Promise<PharmacySettingRow[]> {
    return this.fetchOrCache(cacheKey("rows", "system", null), async () => {
      const data = await this.fetchSettings({ mode: "rows", namespace: "system" })
      return data.rows ?? []
    }, [])
  }

  async fetchSettingsMap(pharmacyId = getActivePharmacyId()): Promise<Record<string, string>> {
    const defaults = flattenDefaultSettings()
    return this.fetchOrCache(cacheKey("map", null, pharmacyId), async () => {
      const data = await this.fetchSettings({
        mode: "all",
        pharmacy_id: pharmacyId,
        branch_id: getActiveBranchId(),
      })
      return { ...defaults, ...(data.settings ?? {}) }
    }, defaults)
  }

  async fetchNamespace(namespace: SettingsNamespace, defaults: Record<string, string>): Promise<Record<string, string>> {
    const pharmacyId = this.isGlobalNamespace(namespace) ? null : getActivePharmacyId()
    return this.fetchOrCache(cacheKey("namespace", namespace, pharmacyId), async () => {
      const data = await this.fetchSettings({
        namespace,
        pharmacy_id: pharmacyId,
        branch_id: getActiveBranchId(),
      })
      return { ...defaults, ...(data.settings ?? {}) }
    }, { ...defaults })
  }

  async set(key: string, value: string, options?: { global?: boolean }) {
    await this.setMany({ [key]: value }, options?.global ? "system" : undefined)
  }

  async setGlobal(key: string, value: string) {
    await this.setMany({ [key]: value }, "system")
  }

  async setMany(settings: Record<string, string>, namespace?: SettingsNamespace) {
    const pharmacyId = this.isGlobalNamespace(namespace) ? null : getActivePharmacyId()
    const payload: SettingsWritePayload = {
      namespace,
      pharmacyId,
      branchId: getActiveBranchId(),
      settings: namespace
        ? settings
        : Object.fromEntries(
            Object.entries(settings).filter(([key]) => key.includes(".") || SETTINGS_DEFAULTS.system[key] !== undefined),
          ),
    }

    if (await network.check()) {
      try {
        await apiClient.patch<SettingsApiResponse>("/api/settings", payload, {
          fallbackMessage: "فشل حفظ الإعدادات",
        })
        await this.applyLocal(payload)
        return
      } catch (error) {
        if (!shouldUseOfflineFallback(error)) throw error
      }
    }

    await queueApiRequest({
      path: "/api/settings",
      method: "PATCH",
      body: payload as unknown as Record<string, unknown>,
      label: "تعديل إعدادات أوفلاين",
    })
    await this.applyLocal(payload)
    await syncManager.refreshPending()
  }

  private fetchSettings(query: QueryParams) {
    return apiClient.get<SettingsApiResponse>("/api/settings", {
      query,
      fallbackMessage: "فشل تحميل الإعدادات",
    })
  }

  private async fetchOrCache<T>(key: string, loader: () => Promise<T>, fallback: T): Promise<T> {
    if (await network.check()) {
      try {
        const value = await loader()
        await localDB.setCache(key, value, SETTINGS_CACHE_TTL)
        return value
      } catch (error) {
        if (!shouldUseOfflineFallback(error)) throw error
      }
    }
    return (await localDB.getStaleCache(key) as T | null) ?? fallback
  }

  private async applyLocal(payload: SettingsWritePayload) {
    const mapKey = cacheKey("map", null, payload.pharmacyId)
    const currentMap = (await localDB.getStaleCache(mapKey) as Record<string, string> | null) ?? flattenDefaultSettings()
    await localDB.setCache(mapKey, { ...currentMap, ...payload.settings }, SETTINGS_CACHE_TTL)

    if (payload.namespace) {
      const namespaceKey = cacheKey("namespace", payload.namespace, payload.pharmacyId)
      const currentNamespace = (await localDB.getStaleCache(namespaceKey) as Record<string, string> | null) ?? {}
      await localDB.setCache(namespaceKey, { ...currentNamespace, ...payload.settings }, SETTINGS_CACHE_TTL)
    }

    notifySettingsUpdated()
  }
}

export const AppSettingsService = new AppSettingsRepository()
