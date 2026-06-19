"use client"

import { memo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Bell, BellOff, CalendarDays, CheckCheck, LogOut, Settings, UserCircle,
  TrendingUp, PanelRightClose, PanelRightOpen,
  AlertTriangle, CheckCircle2, Info, XCircle,
  Headphones, Gauge,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { NavActionButton, navbarIconButtonClass } from "@/components/layout/navbar/nav-action-button"
import { CalculatorPopover } from "@/components/layout/navbar/calculator-popover"
import { DailyProfitDialog } from "@/components/shared/daily-profit-dialog"
import { useAuth } from "@/contexts/auth-context"
import { useNotifications } from "@/contexts/notification-context"
import { useAppSettings } from "@/contexts/settings-context"
import { ROUTES } from "@/config/routes"
import { cn } from "@/lib/utils"

function formatToday() {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`
}

function getDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  return user?.user_metadata?.display_name
    ?? user?.user_metadata?.full_name
    ?? user?.email?.split("@")[0]
    ?? "مستخدم النظام"
}

const DashboardNavbar = memo(function DashboardNavbar({
  onMenuClick, sidebarCollapsed = false,
}: {
  onMenuClick: () => void
  sidebarCollapsed?: boolean
}) {
  const router = useRouter()
  const { user, profile, signOut } = useAuth()
  const displayName = profile?.full_name ?? getDisplayName(user)
  const appSettings = useAppSettings()
  const notificationsEnabled = appSettings.bool("system", "enableNotifications", true)
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
  const [dailyProfitOpen, setDailyProfitOpen] = useState(false)

  useEffect(() => {
    if (!user?.id) return

    const key = `pharmacy_welcome_toast_${user.id}`
    if (sessionStorage.getItem(key)) return

    sessionStorage.setItem(key, "1")
    toast.success(`مرحباً بعودتك يا ${displayName}`)
  }, [user?.id, displayName])

  function handleSignOut() {
    toast.success("جاري تسجيل الخروج…")
    signOut()
  }

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div dir="rtl" className="flex h-full min-w-0 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onMenuClick}
            title={sidebarCollapsed ? "إظهار القائمة" : "إخفاء القائمة"}
            aria-label={sidebarCollapsed ? "إظهار القائمة" : "إخفاء القائمة"}
            className={cn(navbarIconButtonClass, "shrink-0")}
          >
            {sidebarCollapsed
              ? <PanelRightOpen className="size-[18px]" strokeWidth={2.35} />
              : <PanelRightClose className="size-[18px]" strokeWidth={2.35} />}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-hidden">
          <NavActionButton label="الدعم الفني" icon={Headphones} type="pill" className="hidden w-auto shrink-0 px-3.5 xl:inline-flex" />

          <NavActionButton label="الكاشير" icon={Gauge} type="pill" href={ROUTES.dashboardCashier} className="hidden w-auto shrink-0 px-3.5 xl:inline-flex" />

          <CalculatorPopover />

          <button
            type="button"
            title="ربح اليوم"
            aria-label="ربح اليوم"
            onClick={() => setDailyProfitOpen(true)}
            className={cn(navbarIconButtonClass, "w-auto gap-2 px-3.5 shrink-0")}
          >
            <span className="hidden sm:inline leading-none text-xs font-black">ربح اليوم</span>
            <TrendingUp className="size-[18px]" strokeWidth={2.35} />
          </button>

          <div className={cn(navbarIconButtonClass, "w-auto gap-1.5 px-3.5 shrink-0")} title="تاريخ اليوم">
            <span className="hidden sm:inline font-black text-xs">{appSettings.date(new Date()) || formatToday()}</span>
            <CalendarDays className="size-[18px]" strokeWidth={2.35} />
          </div>

          {notificationsEnabled ? (
          <Popover>
            <PopoverTrigger
              title="الإشعارات"
              aria-label="الإشعارات"
              className={cn(navbarIconButtonClass, "relative")}
            >
              <Bell className="size-[18px]" strokeWidth={2.35} />
              {unreadCount > 0 && (
                <span className="absolute top-2 left-2 size-2 rounded-full bg-red-500 animate-pulse border border-white" />
              )}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 p-0 rounded-xl border border-slate-100 bg-white/95 backdrop-blur-md shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_16px_-6px_rgba(0,0,0,0.05)]"
            >
              <div dir="rtl" className="w-full">
                <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5 select-none">
                    <Bell className="size-3.5 text-slate-500" />
                    الإشعارات
                    {unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full bg-red-50 text-red-700 px-1.5 py-0.5 text-[9px] font-black leading-none">
                        {unreadCount} جديد
                      </span>
                    )}
                  </span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => { markAllAsRead(); toast.success("تم تحديد جميع الإشعارات كمقروءة") }}
                      className="text-[10px] font-bold text-brand hover:text-brand-hover flex items-center gap-1"
                    >
                      <CheckCheck className="size-3" />
                      قراءة الكل
                    </button>
                  )}
                </div>

                <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-50 pharmacy-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center px-4 select-none">
                      <span className="flex size-10 items-center justify-center rounded-full bg-slate-50 text-slate-400 mb-2">
                        <BellOff className="size-5" />
                      </span>
                      <p className="text-xs font-bold text-slate-400">لا توجد إشعارات حالياً</p>
                    </div>
                  ) : (
                    notifications.map((notif) => {
                      const Icon = notif.type === "warning" ? AlertTriangle : notif.type === "success" ? CheckCircle2 : notif.type === "error" ? XCircle : Info
                      const iconBg = notif.type === "warning" ? "bg-amber-50 text-amber-600" : notif.type === "success" ? "bg-brand-subtle text-brand" : notif.type === "error" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                      return (
                        <div
                          key={notif.id}
                          onClick={() => { markAsRead(notif.id); if (notif.href) router.push(notif.href) }}
                          className={cn(
                            "flex gap-3 p-3 transition-colors hover:bg-slate-50/50 cursor-pointer text-right",
                            !notif.read && "bg-brand-muted/40 hover:bg-brand-muted/70",
                          )}
                        >
                          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", iconBg)}>
                            <Icon className="size-3.5" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1.5">
                              <span className={cn("text-xs font-black text-slate-800 leading-tight", !notif.read && "font-black text-brand")}>
                                {notif.title}
                              </span>
                              <span className="text-[9px] text-slate-400 font-bold shrink-0 whitespace-nowrap">{notif.time}</span>
                            </div>
                            <p className="text-[10px] font-bold text-slate-500 mt-1 leading-normal">{notif.desc}</p>
                          </div>
                          {!notif.read && <span className="size-1.5 rounded-full bg-blue-500 shrink-0 self-center" />}
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="border-t border-slate-100 p-2 text-center select-none">
                  <button
                    type="button"
                    onClick={() => router.push(ROUTES.dashboardNotifications)}
                    className="w-full rounded-lg py-1.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                  >
                    عرض كل الإشعارات
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(navbarIconButtonClass, "max-w-[190px] w-auto justify-between gap-2 px-3.5")}
              title={displayName}
              aria-label={displayName}
            >
              <span className="truncate text-xs font-black">{displayName}</span>
              <UserCircle className="size-[18px]" strokeWidth={2.35} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-60 p-1.5 rounded-xl border border-slate-100 bg-white/95 backdrop-blur-md shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_16px_-6px_rgba(0,0,0,0.05)]"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex flex-col p-2.5 rounded-lg bg-slate-50/80 mb-1.5 leading-none select-none">
                  <span className="font-extrabold text-[12px] text-slate-800 leading-tight">{displayName}</span>
                  <span className="text-[10px] font-bold text-slate-400 mt-1 truncate leading-none">{user?.email ?? ""}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                onClick={() => router.push(ROUTES.dashboardProfile)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs font-bold text-slate-600 transition-colors focus:bg-slate-50 focus:text-slate-900 cursor-pointer"
              >
                <UserCircle className="size-4 shrink-0 text-slate-400" />
                <span className="flex-1">الملف الشخصي</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(ROUTES.dashboardSettings)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs font-bold text-slate-600 transition-colors focus:bg-slate-50 focus:text-slate-900 cursor-pointer"
              >
                <Settings className="size-4 shrink-0 text-slate-400" />
                <span className="flex-1">الإعدادات</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                variant="destructive"
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs font-bold text-red-600 transition-colors focus:bg-red-50 focus:text-red-700 cursor-pointer"
              >
                <LogOut className="size-4 shrink-0 text-red-500" />
                <span className="flex-1">تسجيل الخروج</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DailyProfitDialog open={dailyProfitOpen} onOpenChange={setDailyProfitOpen} />
    </header>
  )
})

export { DashboardNavbar }
