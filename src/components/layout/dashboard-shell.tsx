"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar"
import { DashboardNavbar } from "@/components/layout/dashboard-navbar"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { Button } from "@/components/ui/button"
import { ROUTES } from "@/config/routes"

const COLLAPSED_KEY = "pharmacy_sidebar_collapsed"

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false
  return localStorage.getItem(COLLAPSED_KEY) === "true"
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed)
  const { loading, user, role, error, signOut, isDeveloper } = useAuth()
  const appSettings = useAppSettings()
  const maintenanceMode = appSettings.bool("system", "maintenanceMode", false)
  const appName = appSettings.get("system", "appName", "Logixa Pharmacy")

  useEffect(() => {
    if (!loading && !user) router.replace(ROUTES.login)
  }, [loading, router, user])

  const toggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen((prev: boolean) => !prev)
    } else {
      setSidebarCollapsed((prev: boolean) => !prev)
    }
  }, [])

  if (loading && !user) {
    return <div className="min-h-dvh bg-dashboard-bg" aria-busy="true" />
  }

  if (!user) {
    return <div className="min-h-dvh bg-dashboard-bg" aria-busy="true" />
  }

  if (!isDeveloper && maintenanceMode) {
    return (
      <div dir="rtl" className="flex min-h-dvh items-center justify-center bg-dashboard-bg px-4 text-center">
        <div className="max-w-md rounded-3xl border border-amber-200 bg-white p-7 shadow-sm">
          <p className="text-xl font-black text-slate-950" translate="no">{appName}</p>
          <p className="mt-3 text-base font-black text-amber-700">النظام في وضع الصيانة حالياً</p>
          <p className="mt-2 text-sm font-semibold leading-7 text-slate-500">تم تفعيل وضع الصيانة من إعدادات النظام. المطور فقط يقدر يدخل ويلغي وضع الصيانة.</p>
          <Button className="mt-5 w-full" variant="outline" onClick={signOut}>تسجيل الخروج</Button>
        </div>
      </div>
    )
  }

  if (!isDeveloper && role === "no-access") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-dashboard-bg px-4 text-center">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <p className="text-lg font-black text-slate-950">الحساب غير مفعل داخل أي صيدلية</p>
          <p className="mt-2 text-sm font-semibold leading-7 text-slate-500">
            اطلب من صاحب الصيدلية أو المطور إضافة الحساب للمستخدمين وتحديد الفرع والدور المناسب.
          </p>
          {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
          <Button className="mt-5 w-full" variant="outline" onClick={signOut}>تسجيل الخروج</Button>
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-dvh overflow-x-hidden bg-dashboard-bg text-slate-900">
      <DashboardSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className={cn(
        "min-h-dvh min-w-0 transition-[padding] duration-200 ease-in-out",
        sidebarCollapsed ? "lg:pr-0" : "lg:pr-[280px]",
      )}>
        {loading ? <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-transparent" aria-hidden="true"><div className="h-full w-1/3 animate-pulse rounded-full bg-brand/40" /></div> : null}
        <DashboardNavbar onMenuClick={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />
        <main className="dashboard-clean-ui arabic-leading min-w-0 flex-1 overflow-x-clip py-3 sm:py-5">
          {children}
        </main>
      </div>
    </div>
  )
}
