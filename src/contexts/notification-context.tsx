"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { NotificationService, getUserId } from "@/features/notifications/services/notification-service"
import { useAppSettings } from "@/contexts/settings-context"
import { useSound, type SoundName } from "@/hooks/use-sound"
import { notificationScenarioMap, renderNotificationTemplate, type NotificationScenarioId, type NotificationScenarioVars } from "@/config/notification-scenarios"
import type { NotificationRow, NotifType } from "@/types/notifications"

export interface Notification {
  id: string
  title: string
  desc: string
  type: NotifType
  read: boolean
  time: string
  createdAt: number
  href?: string
}

export interface AddNotificationInput {
  title: string
  desc: string
  type?: NotifType
  href?: string
  /**
   * استخدم false للإشعارات الهادية/المتكررة، أو اسم صوت معين من public/sounds.
   */
  sound?: SoundName | false
  /**
   * مدة منع تكرار نفس الإشعار محلياً داخل نفس التبويب.
   */
  dedupeWindowMs?: number
  /**
   * false = صوت فقط/تنبيه محلي بدون تخزين داخل جدول الإشعارات.
   */
  persist?: boolean
}

export interface AddScenarioNotificationOptions extends Partial<AddNotificationInput> {
  href?: string
}

interface NotificationContextValue {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  addNotification: (n: AddNotificationInput) => Promise<void>
  addScenarioNotification: (scenarioId: NotificationScenarioId, vars?: NotificationScenarioVars, options?: AddScenarioNotificationOptions) => Promise<void>
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeNotification: (id: string) => void
  clearAll: () => void
  refresh: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const DEFAULT_DEDUPE_WINDOW_MS = 10_000
const WELCOME_TITLE = "مرحباً بعودتك"
const WELCOME_DESC_MARKER = "تم تحميل لوحة التحكم بنجاح"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  if (diff < 60000) return "الآن"
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} د`
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} س`
  if (diff < 604800000) return `منذ ${Math.floor(diff / 86400000)} ي`
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" })
}

function getSoundForType(type: NotifType): SoundName {
  if (type === "warning") return "warning"
  if (type === "error") return "error"
  return "notification"
}

function getNotificationKey(input: Pick<AddNotificationInput, "title" | "desc" | "type" | "href">): string {
  return [input.type ?? "info", input.title.trim(), input.desc.trim(), input.href ?? ""].join("|")
}

function isWelcomeNotification(row: NotificationRow): boolean {
  return row.title.trim() === WELCOME_TITLE && row.description.includes(WELCOME_DESC_MARKER)
}

function compactSystemDuplicates(rows: NotificationRow[]): { rows: NotificationRow[]; duplicateIds: string[] } {
  const output: NotificationRow[] = []
  const duplicateIds: string[] = []
  let keptWelcome = false

  for (const row of rows) {
    if (isWelcomeNotification(row)) {
      if (keptWelcome) {
        duplicateIds.push(row.id)
        continue
      }
      keptWelcome = true
    }

    output.push(row)
  }

  return { rows: output, duplicateIds }
}


function isWelcomeAppNotification(notification: Notification): boolean {
  return notification.title.trim() === WELCOME_TITLE && notification.desc.includes(WELCOME_DESC_MARKER)
}

function isWelcomeInput(input: Pick<AddNotificationInput, "title" | "desc">): boolean {
  return input.title.trim() === WELCOME_TITLE && input.desc.includes(WELCOME_DESC_MARKER)
}

function compactAppSystemDuplicates(notifications: Notification[]): Notification[] {
  const output: Notification[] = []
  let keptWelcome = false

  for (const notification of notifications) {
    if (isWelcomeAppNotification(notification)) {
      if (keptWelcome) continue
      keptWelcome = true
    }

    output.push(notification)
  }

  return output
}

function dbToApp(row: NotificationRow): Notification {
  const date = new Date(row.created_at)
  return {
    id: row.id,
    title: row.title,
    desc: row.description,
    type: (["warning", "success", "info", "error"].includes(row.notif_type) ? row.notif_type : "info") as NotifType,
    read: row.read,
    time: relativeTime(date),
    createdAt: date.getTime(),
    href: row.href ?? undefined,
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const { play } = useSound()
  const appSettings = useAppSettings()
  const notificationsEnabled = appSettings.bool("system", "enableNotifications", true)
  const soundEnabled = appSettings.bool("project", "notifSound", true)
  const lastAddedAtRef = useRef<Map<string, number>>(new Map())

  const refresh = useCallback(async () => {
    if (!notificationsEnabled) {
      setNotifications([])
      setLoading(false)
      return
    }

    try {
      const rows = await NotificationService.fetch()
      const compacted = compactSystemDuplicates(rows)
      setNotifications(compacted.rows.map(dbToApp))

      if (compacted.duplicateIds.length > 0) {
        void NotificationService.deleteMany(compacted.duplicateIds)
      }
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false)
    }
  }, [notificationsEnabled])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  const addNotification = useCallback(async (n: AddNotificationInput) => {
    const normalized = {
      title: n.title.trim(),
      desc: n.desc.trim(),
      type: n.type ?? "info",
      href: n.href,
    }

    if (!notificationsEnabled || !normalized.title) return

    const key = getNotificationKey(normalized)
    const now = Date.now()
    const dedupeWindowMs = n.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS
    const lastAddedAt = lastAddedAtRef.current.get(key)

    if (lastAddedAt && now - lastAddedAt < dedupeWindowMs) {
      return
    }

    lastAddedAtRef.current.set(key, now)

    if (soundEnabled && n.sound !== false) {
      play(n.sound ?? getSoundForType(normalized.type), normalized.type === "info" ? 0.35 : 0.45)
    }

    // رسائل الترحيب لا تتخزن في قاعدة البيانات حتى لا تظهر مكررة للعميل.
    if (n.persist === false || isWelcomeInput(normalized)) {
      return
    }

    const user_id = await getUserId()
    if (!user_id) return

    const row = await NotificationService.insert({
      user_id,
      title: normalized.title,
      description: normalized.desc,
      notif_type: normalized.type,
      href: normalized.href,
    })

    if (row) {
      setNotifications((prev) => compactAppSystemDuplicates([dbToApp(row), ...prev]).slice(0, 200))
    }
  }, [notificationsEnabled, play, soundEnabled])

  const addScenarioNotification = useCallback(async (
    scenarioId: NotificationScenarioId,
    vars: NotificationScenarioVars = {},
    options: AddScenarioNotificationOptions = {},
  ) => {
    const scenario = notificationScenarioMap[scenarioId]
    if (!scenario) return

    await addNotification({
      title: options.title ?? renderNotificationTemplate(scenario.title, vars),
      desc: options.desc ?? renderNotificationTemplate(scenario.description, vars),
      type: options.type ?? scenario.type,
      href: options.href ?? scenario.href,
      sound: options.sound ?? scenario.sound,
      dedupeWindowMs: options.dedupeWindowMs ?? scenario.dedupeWindowMs,
      persist: options.persist,
    })
  }, [addNotification])

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    void NotificationService.markRead(id)
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    void NotificationService.markAllRead()
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    void NotificationService.delete(id)
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
    void NotificationService.clearAll()
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, loading, addNotification, addScenarioNotification, markAsRead, markAllAsRead, removeNotification, clearAll, refresh }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider")
  return ctx
}
