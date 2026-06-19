"use client"

import { SETTINGS_DEFAULTS, flattenDefaultSettings, SETTINGS_UPDATED_EVENT, type SettingsNamespace } from "../lib/settings-keys"

const GLOBAL_SETTING_NAMESPACES = new Set<SettingsNamespace>(["system"])

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

function getActivePharmacyId(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem("active-pharmacy-id")
}

function getActiveBranchId(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem("active-branch-id")
}

async function readJson(response: Response): Promise<SettingsApiResponse> {
  const data = (await response.json().catch(() => ({}))) as SettingsApiResponse
  if (!response.ok) throw new Error(data.error ?? "فشل تنفيذ عملية الإعدادات")
  return data
}

function buildSettingsUrl(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `/api/settings?${query}` : "/api/settings"
}

export function notifySettingsUpdated() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT))
}

export const AppSettingsService = {
  isGlobalNamespace(namespace?: SettingsNamespace): boolean {
    return Boolean(namespace && GLOBAL_SETTING_NAMESPACES.has(namespace))
  },

  async fetchRows(pharmacyId = getActivePharmacyId()): Promise<PharmacySettingRow[]> {
    try {
      const data = await readJson(await fetch(buildSettingsUrl({ mode: "rows", pharmacy_id: pharmacyId }), { cache: "no-store" }))
      return data.rows ?? []
    } catch (error) {
      console.warn("settings rows fetch failed", error)
      return []
    }
  },

  async fetchGlobalRows(): Promise<PharmacySettingRow[]> {
    try {
      const data = await readJson(await fetch(buildSettingsUrl({ mode: "rows", namespace: "system" }), { cache: "no-store" }))
      return data.rows ?? []
    } catch (error) {
      console.warn("global settings rows fetch failed", error)
      return []
    }
  },

  async fetchSettingsMap(pharmacyId = getActivePharmacyId()): Promise<Record<string, string>> {
    try {
      const data = await readJson(await fetch(buildSettingsUrl({
        mode: "all",
        pharmacy_id: pharmacyId,
        branch_id: getActiveBranchId(),
      }), { cache: "no-store" }))

      return data.settings ?? flattenDefaultSettings()
    } catch (error) {
      console.warn("settings map fetch failed", error)
      return flattenDefaultSettings()
    }
  },

  async fetchNamespace(namespace: SettingsNamespace, defaults: Record<string, string>): Promise<Record<string, string>> {
    try {
      const data = await readJson(await fetch(buildSettingsUrl({
        namespace,
        pharmacy_id: this.isGlobalNamespace(namespace) ? null : getActivePharmacyId(),
        branch_id: getActiveBranchId(),
      }), { cache: "no-store" }))

      return { ...defaults, ...(data.settings ?? {}) }
    } catch (error) {
      console.warn(`settings namespace fetch failed: ${namespace}`, error)
      return { ...defaults }
    }
  },

  async set(key: string, value: string, options?: { global?: boolean }): Promise<void> {
    const namespace = options?.global ? "system" : undefined
    await this.setMany({ [key]: value }, namespace as SettingsNamespace | undefined)
  },

  async setGlobal(key: string, value: string): Promise<void> {
    await this.setMany({ [key]: value }, "system")
  },

  async setMany(settings: Record<string, string>, namespace?: SettingsNamespace): Promise<void> {
    const payload = {
      namespace,
      pharmacyId: this.isGlobalNamespace(namespace) ? null : getActivePharmacyId(),
      branchId: getActiveBranchId(),
      settings: namespace
        ? settings
        : Object.fromEntries(Object.entries(settings).filter(([key]) => key.includes(".") || SETTINGS_DEFAULTS.system[key] !== undefined)),
    }

    await readJson(await fetch("/api/settings", {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }))

    notifySettingsUpdated()
  },
}
