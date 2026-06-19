"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useSettingsPermissions } from "../hooks/use-settings-permissions"
import { settingsPermissionMessage } from "../lib/settings-permissions"
import { AppSettingsService } from "../services/app-settings-service"
import type { SettingsNamespace } from "../lib/settings-keys"
import { LoadingState } from "@/components/shared/loading-state"

export interface SettingsRecord {
  id: string
  pharmacy_id: string | null
  key: string
  value: string
  updated_at: string
  [key: string]: unknown
}

interface SettingsContextType {
  settings: Record<string, string>
  loading: boolean
  saving: boolean
  canRead: boolean
  canWrite: boolean
  getSetting: (key: string, fallback?: string) => string
  updateSetting: (key: string, value: string) => void
  saveSettings: () => Promise<void>
  resetSettings: () => void
  dirty: boolean
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsPageProvider({
  children,
  defaultSettings = {},
  namespace,
  canWriteOverride,
}: {
  children: ReactNode
  defaultSettings?: Record<string, string>
  namespace?: SettingsNamespace
  canWriteOverride?: boolean
}) {
  const { canReadNamespace, canWriteNamespace } = useSettingsPermissions(namespace)
  const canRead = canReadNamespace
  const effectiveCanWrite = canWriteOverride ?? canWriteNamespace
  const [settings, setSettings] = useState<Record<string, string>>(defaultSettings)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!canRead) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      try {
        const pharmacyId = localStorage.getItem("active-pharmacy-id")
        const merged = namespace
          ? await AppSettingsService.fetchNamespace(namespace, defaultSettings)
          : await AppSettingsService.fetchSettingsMap(pharmacyId)

        if (!cancelled) {
          setSettings(merged)
          setDraft({ ...merged })
          setLoading(false)
          setInitialized(true)
        }
      } catch {
        if (!cancelled) {
          setSettings(defaultSettings)
          setDraft({ ...defaultSettings })
          setLoading(false)
          setInitialized(true)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [canRead, defaultSettings, namespace])

  const dirty = useMemo(() => {
    if (!initialized) return false
    return Object.keys(draft).some((key) => draft[key] !== settings[key])
  }, [draft, settings, initialized])

  const getSetting = useCallback(
    (key: string, fallback = "") => draft[key] ?? fallback,
    [draft],
  )

  const updateSetting = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const saveSettings = useCallback(async () => {
    if (!effectiveCanWrite) {
      toast.error(settingsPermissionMessage(namespace))
      return
    }

    setSaving(true)

    try {
      const changed: Record<string, string> = {}
      for (const key of Object.keys(draft)) {
        if (draft[key] !== settings[key]) changed[key] = draft[key]
      }

      if (Object.keys(changed).length > 0) {
        await AppSettingsService.setMany(changed, namespace)
      }

      setSettings({ ...draft })
      toast.success("تم حفظ الإعدادات وتفعيلها داخل المنظومة")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الإعدادات")
    } finally {
      setSaving(false)
    }
  }, [effectiveCanWrite, draft, settings, namespace])

  const resetSettings = useCallback(() => {
    setDraft({ ...settings })
  }, [settings])

  const value = useMemo<SettingsContextType>(
    () => ({
      settings,
      loading,
      saving,
      canRead,
      canWrite: effectiveCanWrite,
      getSetting,
      updateSetting,
      saveSettings,
      resetSettings,
      dirty,
    }),
    [settings, loading, saving, canRead, effectiveCanWrite, getSetting, updateSetting, saveSettings, resetSettings, dirty],
  )

  if (!canRead) {
    return <LoadingState text="ليس لديك صلاحية الوصول إلى الإعدادات" minHeight="min-h-[200px]" />
  }

  if (loading) {
    return <LoadingState text="جاري تحميل الإعدادات…" />
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettingsPage() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettingsPage must be used within a SettingsPageProvider")
  return ctx
}
