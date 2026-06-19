"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, BellOff, CheckCheck, Trash2, Bell, AlertTriangle,
  CheckCircle2, Info, XCircle, Volume2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useNotifications } from "@/contexts/notification-context"
import { notificationScenarios } from "@/config/notification-scenarios"
import { useSound } from "@/hooks/use-sound"
import type { Notification } from "@/contexts/notification-context"
import type { NotifType } from "@/types/notifications"
import { cn } from "@/lib/utils"
import { PageAccess } from "@/components/auth/page-access"

const typeStyle: Record<NotifType, { badge: string; icon: typeof Info; label: string; dot: string }> = {
  warning: {
    label: "تحذير",
    icon: AlertTriangle,
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  success: {
    label: "نجاح",
    icon: CheckCircle2,
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  info: {
    label: "معلومة",
    icon: Info,
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  error: {
    label: "خطأ",
    icon: XCircle,
    badge: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
}

type FilterKey = "all" | "unread" | NotifType

const filterLabels: Record<FilterKey, string> = {
  all: "الكل",
  unread: "غير مقروء",
  warning: "تحذيرات",
  success: "نجاح",
  info: "معلومات",
  error: "أخطاء",
}

function getFiltered(notifications: Notification[], filter: FilterKey) {
  if (filter === "all") return notifications
  if (filter === "unread") return notifications.filter((notification) => !notification.read)
  return notifications.filter((notification) => notification.type === filter)
}

export default function NotificationsPage() {
  const router = useRouter()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, removeNotification, clearAll } = useNotifications()
  const { play } = useSound()
  const [filter, setFilter] = useState<FilterKey>("all")

  const filteredNotifications = useMemo(() => getFiltered(notifications, filter), [notifications, filter])
  const counts = useMemo(() => ({
    all: notifications.length,
    unread: unreadCount,
    warning: notifications.filter((notification) => notification.type === "warning").length,
    success: notifications.filter((notification) => notification.type === "success").length,
    info: notifications.filter((notification) => notification.type === "info").length,
    error: notifications.filter((notification) => notification.type === "error").length,
  }), [notifications, unreadCount])

  return (
    <PageAccess permission="notifications:read">
    <div dir="rtl" className="mx-auto max-w-[1300px] space-y-5 px-4 pb-8 text-right">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="shrink-0 rounded-xl">
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">الإشعارات</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {loading ? "جارٍ التحميل..." : `${notifications.length} إشعار محفوظ`}
              {unreadCount > 0 && ` · ${unreadCount} غير مقروء`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => play("notification", 0.45)} className="rounded-xl text-xs font-black">
            <Volume2 className="size-4" />
            اختبار الصوت
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllAsRead} className="rounded-xl text-xs font-black">
              <CheckCheck className="size-4" />
              قراءة الكل
            </Button>
          )}
          {notifications.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => { router.push("/dashboard/notifications/audit") }} className="rounded-xl text-xs font-black">
              سجل المحذوفات
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardContent className="flex flex-wrap gap-2 p-3">
              {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-black transition",
                    filter === key
                      ? "border-brand bg-brand text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-brand-muted hover:text-brand",
                  )}
                >
                  {filterLabels[key]}
                  <span className="mr-2 opacity-75">{counts[key]}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="size-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-20 shadow-sm">
              <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                <BellOff className="size-7" />
              </span>
              <p className="text-sm font-black text-slate-400">لا توجد إشعارات في هذا التصنيف</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredNotifications.map((notif) => {
                const style = typeStyle[notif.type]
                const Icon = style.icon
                return (
                  <div
                    key={notif.id}
                    onClick={() => { markAsRead(notif.id); if (notif.href) router.push(notif.href) }}
                    className={cn(
                      "group flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                      !notif.read && "border-r-4 border-r-brand bg-brand-muted/20",
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border", style.badge)}>
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn("text-sm leading-tight", notif.read ? "font-bold text-slate-600" : "font-black text-slate-950")}>
                          {notif.title}
                        </p>
                        <Badge variant="outline" className={cn("rounded-full px-2 py-0 text-[10px] font-black", style.badge)}>
                          {style.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs font-semibold leading-6 text-slate-500">{notif.desc}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-300">{notif.time}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeNotification(notif.id) }}
                      className="shrink-0 rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="حذف"
                      aria-label="حذف الإشعار"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {notifications.length > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" size="sm" onClick={clearAll} className="rounded-xl text-xs font-bold text-red-500 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="size-4" />
                مسح جميع الإشعارات
              </Button>
            </div>
          )}
        </div>

        <Card className="h-fit rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950">
              <Bell className="size-5 text-brand" />
              سيناريوهات الإشعارات المفعلة
            </CardTitle>
            <p className="text-xs font-bold leading-6 text-slate-500">
              الأصوات مفعلة للأحداث المهمة، ورسائل الترحيب لا تُحفظ داخل قائمة الإشعارات.
            </p>
          </CardHeader>
          <CardContent className="max-h-[560px] space-y-2 overflow-y-auto p-3 pharmacy-scrollbar">
            {notificationScenarios.map((scenario) => {
              const style = typeStyle[scenario.type]
              return (
                <div key={scenario.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-slate-800">{scenario.label}</p>
                    <p className="truncate text-[10px] font-bold text-slate-400">صوت: {scenario.sound}</p>
                  </div>
                  <span className={cn("size-2.5 shrink-0 rounded-full", style.dot)} />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
    </PageAccess>
  )
}
