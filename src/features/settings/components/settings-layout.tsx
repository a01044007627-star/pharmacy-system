"use client"

import { useMemo } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building, Percent, Package, ContactRound, ShoppingCart, Monitor,
  Truck, Wallet, Bell, Settings, FileText, Mail, MessageSquare,
  Gift, Copy,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useSettingsPermissions } from "../hooks/use-settings-permissions"
import type { SettingsPermissionModule } from "../lib/settings-permissions"
import { LoadingState } from "@/components/shared/loading-state"

type SettingsTab = {
  id: string
  module: SettingsPermissionModule
  group: string
  label: string
  icon: LucideIcon
  href: string
}

const settingsTabs: SettingsTab[] = [
  { id: "project", module: "project", group: "الأساسي", label: "بيانات الصيدلية", icon: Building, href: "/dashboard/settings" },
  { id: "branches", module: "branches", group: "الأساسي", label: "الفروع", icon: Building, href: "/dashboard/settings/branches" },
  { id: "tax", module: "tax", group: "الأساسي", label: "الضرائب", icon: Percent, href: "/dashboard/settings/tax-rates" },
  { id: "items", module: "items", group: "التشغيل", label: "الأصناف", icon: Package, href: "/dashboard/settings/items" },
  { id: "sales", module: "sales", group: "التشغيل", label: "المبيعات", icon: ShoppingCart, href: "/dashboard/settings/sales" },
  { id: "cashier", module: "cashier", group: "التشغيل", label: "الكاشير", icon: Monitor, href: "/dashboard/settings/cashier" },
  { id: "purchases", module: "purchases", group: "التشغيل", label: "المشتريات", icon: Truck, href: "/dashboard/settings/purchases" },
  { id: "payments", module: "payments", group: "التشغيل", label: "المدفوعات", icon: Wallet, href: "/dashboard/settings/payments" },
  { id: "contacts", module: "contacts", group: "التشغيل", label: "جهات الاتصال", icon: ContactRound, href: "/dashboard/settings/contacts" },
  { id: "invoice", module: "invoice", group: "الطباعة", label: "شكل الفاتورة", icon: FileText, href: "/dashboard/settings/invoice" },
  { id: "barcode", module: "barcode", group: "الطباعة", label: "الباركود", icon: Copy, href: "/dashboard/settings/barcode" },
  { id: "printers", module: "printers", group: "الطباعة", label: "طابعات الإيصالات", icon: Monitor, href: "/dashboard/settings/printers" },
  { id: "stockAlerts", module: "stockAlerts", group: "الإشعارات", label: "تنبيهات المخزون", icon: Bell, href: "/dashboard/settings/stock-alerts" },
  { id: "notifTemplates", module: "notificationTemplates", group: "الإشعارات", label: "نماذج الإشعارات", icon: Bell, href: "/dashboard/settings/notification-templates" },
  { id: "email", module: "email", group: "الإشعارات", label: "البريد الإلكتروني", icon: Mail, href: "/dashboard/settings/email" },
  { id: "sms", module: "sms", group: "الإشعارات", label: "الرسائل", icon: MessageSquare, href: "/dashboard/settings/sms" },
  { id: "backup", module: "backup", group: "النظام", label: "النسخ الاحتياطي", icon: Settings, href: "/dashboard/settings/backup" },
  { id: "system", module: "system", group: "النظام", label: "النظام", icon: Settings, href: "/dashboard/settings/system" },
  { id: "shortcuts", module: "shortcuts", group: "النظام", label: "الاختصارات", icon: FileText, href: "/dashboard/settings/shortcuts" },
  { id: "rewards", module: "rewards", group: "إضافات", label: "المكافآت", icon: Gift, href: "/dashboard/settings/rewards" },
  { id: "extraUnits", module: "extraUnits", group: "إضافات", label: "الوحدات الإضافية", icon: Copy, href: "/dashboard/settings/extra-units" },
]

function useCanReadSettingsModule(module: SettingsPermissionModule) {
  return useSettingsPermissions(module).canReadNamespace
}

function VisibleSettingsTab({ tab, pathname }: { tab: SettingsTab; pathname: string }) {
  const canRead = useCanReadSettingsModule(tab.module)
  if (!canRead) return null
  const active = pathname === tab.href
  const Icon = tab.icon
  return (
    <Link
      href={tab.href}
      title={`${tab.group} - ${tab.label}`}
      className={cn(
        "inline-flex h-10 w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-black transition-all sm:h-11 xl:w-auto xl:justify-start",
        active
          ? "bg-brand text-white shadow-sm"
          : "bg-slate-50 text-slate-600 hover:bg-brand-muted hover:text-brand",
      )}
    >
      <Icon className="size-4" strokeWidth={active ? 2.5 : 2} />
      <span>{tab.label}</span>
    </Link>
  )
}

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canRead } = useSettingsPermissions()

  const activeTab = useMemo(
    () => settingsTabs.find((tab) => pathname === tab.href) ?? settingsTabs[0],
    [pathname],
  )

  if (!canRead) {
    return <LoadingState text="ليس لديك صلاحية الوصول إلى الإعدادات" minHeight="min-h-[200px]" />
  }

  const ActiveIcon = activeTab.icon

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1540px] space-y-4 px-3 pb-8 sm:px-5 lg:px-6">
      <div className="responsive-toolbar text-right">
        <div>
          <h1 className="text-xl font-black text-slate-950">الإعدادات</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">إدارة إعدادات النظام والصيدلية والصلاحيات التشغيلية</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-brand/10 bg-brand-muted px-3 py-1.5 text-xs font-black text-brand">
          <ActiveIcon className="size-4" />
          {activeTab.label}
        </span>
      </div>

      <Card className="rounded-3xl border-slate-200 bg-white/90 p-2 shadow-sm">
        <div className="grid max-h-[270px] grid-cols-2 gap-2 overflow-y-auto p-1 pharmacy-scrollbar sm:max-h-none sm:grid-cols-3 md:grid-cols-4 xl:flex xl:flex-wrap">
          {settingsTabs.map((tab) => <VisibleSettingsTab key={tab.id} tab={tab} pathname={pathname} />)}
        </div>
      </Card>

      <main className="min-w-0 space-y-5">
        {children}
      </main>
    </div>
  )
}
