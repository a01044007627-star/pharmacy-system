"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAuth } from "@/contexts/auth-context"
import { AppSettingsService } from "@/features/settings/services/app-settings-service"
import { SETTINGS_UPDATED_EVENT, flattenDefaultSettings, type SettingsNamespace } from "@/features/settings/lib/settings-keys"
import {
  boolSetting,
  formatCurrencyBySettings,
  formatDateBySettings,
  formatDateTimeBySettings,
  numberSetting,
  readSetting,
  type SettingsMap,
} from "@/features/settings/lib/settings-utils"

interface AppSettingsContextValue {
  settings: SettingsMap
  loading: boolean
  refreshSettings: () => Promise<void>
  get: (namespace: SettingsNamespace, key: string, fallback?: string) => string
  bool: (namespace: SettingsNamespace, key: string, fallback?: boolean) => boolean
  number: (namespace: SettingsNamespace, key: string, fallback?: number) => number
  money: (value: unknown) => string
  date: (value: string | Date | number | null | undefined) => string
  dateTime: (value: string | Date | number | null | undefined) => string
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { activePharmacyId, loading: authLoading, user } = useAuth()
  const [settings, setSettings] = useState<SettingsMap>(() => flattenDefaultSettings())
  const [loading, setLoading] = useState(true)

  const refreshSettings = useCallback(async () => {
    setLoading(true)
    try {
      if (!user) {
        setSettings(flattenDefaultSettings())
        return
      }

      setSettings(await AppSettingsService.fetchSettingsMap(activePharmacyId))
    } catch (error) {
      console.warn("settings refresh failed; using defaults", error)
      setSettings(flattenDefaultSettings())
    } finally {
      setLoading(false)
    }
  }, [activePharmacyId, user])

  useEffect(() => {
    if (authLoading) return
    void refreshSettings()
  }, [authLoading, refreshSettings])

  useEffect(() => {
    const handler = () => { void refreshSettings() }
    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    window.addEventListener("storage", handler)
    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
      window.removeEventListener("storage", handler)
    }
  }, [refreshSettings])

  const value = useMemo<AppSettingsContextValue>(() => ({
    settings,
    loading,
    refreshSettings,
    get: (namespace, key, fallback) => readSetting(settings, namespace, key, fallback),
    bool: (namespace, key, fallback = false) => boolSetting(readSetting(settings, namespace, key), fallback),
    number: (namespace, key, fallback = 0) => numberSetting(readSetting(settings, namespace, key), fallback),
    money: (amount) => formatCurrencyBySettings(amount, settings),
    date: (date) => formatDateBySettings(date, settings),
    dateTime: (date) => formatDateTimeBySettings(date, settings),
  }), [loading, refreshSettings, settings])

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider")
  return ctx
}
