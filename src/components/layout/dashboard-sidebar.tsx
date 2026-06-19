"use client"

import { memo, useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  Home, ShoppingCart, Truck, Package, ClipboardList, Users, Wallet,
  BarChart3, UserCheck, Settings, ContactRound, CheckSquare,
  ChevronDown, Store, X,
  LayoutDashboard, FileText, Gift, Bell, Database, Archive, Wrench, Box, ShieldCheck,
} from "lucide-react"
import { sidebarItems } from "@/config/dashboard"
import { cn } from "@/lib/utils"
import { useBranch } from "@/contexts/branch-context"
import { useUserRole } from "@/hooks/use-user-role"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import type { Permission } from "@/lib/auth/permissions"

const iconMap: Record<string, LucideIcon> = {
  home: Home, "shopping-cart": ShoppingCart, truck: Truck,
  package: Package, "clipboard-list": ClipboardList, users: Users,
  wallet: Wallet, "chart-bar": BarChart3, "user-check": UserCheck,
  settings: Settings, contact: ContactRound, "check-square": CheckSquare,
  "layout-dashboard": LayoutDashboard, "file-text": FileText,
  box: Box, gift: Gift, bell: Bell, database: Database,
  archive: Archive, wrench: Wrench, "shield-check": ShieldCheck,
}

interface SidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

interface NavChild {
  title: string
  href: string
  permission?: Permission | null
  devOnly?: boolean
}

interface NavItem {
  title: string
  icon?: string
  href?: string
  children?: NavChild[]
  devOnly?: boolean
  permission?: Permission | null
}

interface SidebarSectionConfig {
  title: string
  items: string[]
}

const navPermissions: Record<string, Permission | null> = {
  "الرئيسية": null,
  "لوحة المتابعة": null,
  "المبيعات": "sales:read",
  "المشتريات": "purchases:read",
  "الأدوية والأصناف": "inventory:read",
  "الجرد": "inventory:read",
  "المستخدمين": "users:read",
  "المحاسبة": "financials:read",
  "التقارير": "reports:read",
  "الموارد البشرية": "hr:read",
  "CRM": "crm:read",
  "المهام": null,
  "الوصفات الطبية": "prescriptions:read",
  "التوصيل": "delivery:read",
  "نقاط المكافآت": "loyalty:read",
  "الإشعارات": null,
  "المزامنة والتسوية": "sync:read",
  "السجلات المحذوفة": "deleted-records:read",
  "سجل المراجعة": "auth:audit.read",
  "الإعدادات": "settings:read",
  "لوحة المطور": null,
}


const pathPermissions: Array<{ prefix: string; permission: Permission | null }> = [
  { prefix: "/dashboard/sales", permission: "sales:read" },
  { prefix: "/dashboard/purchases", permission: "purchases:read" },
  { prefix: "/dashboard/items/deleted", permission: "deleted-records:read" },
  { prefix: "/dashboard/items/new", permission: "inventory:create" },
  { prefix: "/dashboard/items/groups", permission: "inventory:write" },
  { prefix: "/dashboard/items/brands", permission: "inventory:write" },
  { prefix: "/dashboard/items/units", permission: "inventory:write" },
  { prefix: "/dashboard/items/barcode", permission: "inventory:barcode.print" },
  { prefix: "/dashboard/items/price-update", permission: "inventory:update" },
  { prefix: "/dashboard/items/variants", permission: "inventory:update" },
  { prefix: "/dashboard/items/warranties", permission: "inventory:update" },
  { prefix: "/dashboard/items/alternatives", permission: "inventory:update" },
  { prefix: "/dashboard/items/price-groups", permission: "items:price-groups.write" },
  { prefix: "/dashboard/items", permission: "inventory:read" },
  { prefix: "/dashboard/stocktaking", permission: "inventory:read" },
  { prefix: "/dashboard/users/roles", permission: "roles:manage" },
  { prefix: "/dashboard/users", permission: "users:read" },
  { prefix: "/dashboard/accounts", permission: "financials:read" },
  { prefix: "/dashboard/reports", permission: "reports:read" },
  { prefix: "/dashboard/hr", permission: "hr:read" },
  { prefix: "/dashboard/crm", permission: "crm:read" },
  { prefix: "/dashboard/prescriptions", permission: "prescriptions:read" },
  { prefix: "/dashboard/delivery", permission: "delivery:read" },
  { prefix: "/dashboard/loyalty", permission: "loyalty:read" },
  { prefix: "/dashboard/notifications", permission: "notifications:read" },
  { prefix: "/dashboard/sync", permission: "sync:read" },
  { prefix: "/dashboard/deleted-records", permission: "deleted-records:read" },
  { prefix: "/dashboard/audit", permission: "auth:audit.read" },
  { prefix: "/dashboard/settings/system", permission: "settings:system.read" },
  { prefix: "/dashboard/settings/branches", permission: "settings:branches.read" },
  { prefix: "/dashboard/settings/tax-rates", permission: "settings:tax.read" },
  { prefix: "/dashboard/settings/items", permission: "settings:items.read" },
  { prefix: "/dashboard/settings/sales", permission: "settings:sales.read" },
  { prefix: "/dashboard/settings/cashier", permission: "settings:cashier.read" },
  { prefix: "/dashboard/settings/purchases", permission: "settings:purchases.read" },
  { prefix: "/dashboard/settings/payments", permission: "settings:payments.read" },
  { prefix: "/dashboard/settings/contacts", permission: "settings:contacts.read" },
  { prefix: "/dashboard/settings/invoice", permission: "settings:invoice.read" },
  { prefix: "/dashboard/settings/barcode", permission: "settings:barcode.read" },
  { prefix: "/dashboard/settings/printers", permission: "settings:printers.read" },
  { prefix: "/dashboard/settings/stock-alerts", permission: "settings:stock-alerts.read" },
  { prefix: "/dashboard/settings/notification-templates", permission: "settings:notification-templates.read" },
  { prefix: "/dashboard/settings/email", permission: "settings:email.read" },
  { prefix: "/dashboard/settings/sms", permission: "settings:sms.read" },
  { prefix: "/dashboard/settings/backup", permission: "settings:backup.read" },
  { prefix: "/dashboard/settings/shortcuts", permission: "settings:shortcuts.read" },
  { prefix: "/dashboard/settings/rewards", permission: "settings:rewards.read" },
  { prefix: "/dashboard/settings/extra-units", permission: "settings:extra-units.read" },
  { prefix: "/dashboard/settings/custom-labels", permission: "settings:custom-labels.read" },
  { prefix: "/dashboard/settings", permission: "settings:project.read" },
  { prefix: "/dashboard/dev", permission: "developer:read" },
]

function permissionForHref(href?: string): Permission | null {
  if (!href) return null
  const found = pathPermissions.find((item) => href === item.prefix || href.startsWith(`${item.prefix}/`))
  return found?.permission ?? null
}


const IMPLEMENTED_DASHBOARD_HREFS = new Set([
  "/dashboard",
  "/dashboard/home",
  "/dashboard/profile",
  "/dashboard/sales",
  "/dashboard/sales/cashier",
  "/dashboard/sales/drafts",
  "/dashboard/sales/price-offers",
  "/dashboard/sales/returns",
  "/dashboard/sales/free-returns",
  "/dashboard/sales/shipping",
  "/dashboard/sales/promotions",
  "/dashboard/purchases",
  "/dashboard/purchases/new",
  "/dashboard/purchases/orders",
  "/dashboard/purchases/returns",
  "/dashboard/purchases/shipping",
  "/dashboard/items",
  "/dashboard/items/new",
  "/dashboard/items/groups",
  "/dashboard/items/brands",
  "/dashboard/items/units",
  "/dashboard/items/barcode",
  "/dashboard/items/price-update",
  "/dashboard/items/alternatives",
  "/dashboard/items/price-groups",
  "/dashboard/items/deleted",
  "/dashboard/items/damaged",
  "/dashboard/stocktaking",
  "/dashboard/stocktaking/stock",
  "/dashboard/stocktaking/movements",
  "/dashboard/stocktaking/transfer",
  "/dashboard/users",
  "/dashboard/users/employees",
  "/dashboard/users/roles",
  "/dashboard/accounts",
  "/dashboard/accounts/cash",
  "/dashboard/accounts/expenses",
  "/dashboard/accounts/chart",
  "/dashboard/accounts/closeout",
  "/dashboard/reports",
  "/dashboard/reports/sales",
  "/dashboard/reports/purchases",
  "/dashboard/reports/profit-loss",
  "/dashboard/reports/top-items",
  "/dashboard/reports/customer-activity",
  "/dashboard/reports/tax-summary",
  "/dashboard/hr",
  "/dashboard/hr/attendance",
  "/dashboard/hr/payroll",
  "/dashboard/hr/leave",
  "/dashboard/crm",
  "/dashboard/crm/suppliers",
  "/dashboard/crm/activities",
  "/dashboard/crm/communication",
  "/dashboard/tasks",
  "/dashboard/prescriptions",
  "/dashboard/delivery",
  "/dashboard/loyalty",
  "/dashboard/notifications",
  "/dashboard/notifications/audit",
  "/dashboard/sync",
  "/dashboard/sync/log",
  "/dashboard/deleted-records",
  "/dashboard/audit",
  "/dashboard/settings",
  "/dashboard/settings/branches",
  "/dashboard/settings/tax-rates",
  "/dashboard/settings/items",
  "/dashboard/settings/sales",
  "/dashboard/settings/cashier",
  "/dashboard/settings/purchases",
  "/dashboard/settings/payments",
  "/dashboard/settings/contacts",
  "/dashboard/settings/invoice",
  "/dashboard/settings/barcode",
  "/dashboard/settings/printers",
  "/dashboard/settings/stock-alerts",
  "/dashboard/settings/notification-templates",
  "/dashboard/settings/email",
  "/dashboard/settings/sms",
  "/dashboard/settings/backup",
  "/dashboard/settings/system",
  "/dashboard/settings/shortcuts",
  "/dashboard/settings/rewards",
  "/dashboard/settings/extra-units",
  "/dashboard/settings/custom-labels",
  "/dashboard/dev",
])
function isImplementedHref(href?: string | null) {
  if (!href) return true
  const normalized = normalizePath(href)
  return IMPLEMENTED_DASHBOARD_HREFS.has(normalized)
}

function canSeeNavEntry(entry: { href?: string; permission?: Permission | null; devOnly?: boolean }, can: (permission: Permission) => boolean, isDeveloper: boolean) {
  if (entry.devOnly && !isDeveloper) return false
  if (!isImplementedHref(entry.href)) return false
  const permission = entry.permission ?? permissionForHref(entry.href)
  return !permission || can(permission) || (isDeveloper && permission.startsWith("developer:"))
}

const sidebarSections: SidebarSectionConfig[] = [
  { title: "الأساسي", items: ["الرئيسية", "لوحة المتابعة"] },
  { title: "التشغيل اليومي", items: ["المبيعات", "المشتريات", "الأدوية والأصناف", "الجرد"] },
  { title: "الإدارة", items: ["المستخدمين", "المحاسبة", "التقارير", "الموارد البشرية", "CRM", "المهام"] },
  { title: "خدمات إضافية", items: ["الوصفات الطبية", "التوصيل", "نقاط المكافآت", "الإشعارات"] },
  { title: "النظام", items: ["المزامنة والتسوية", "السجلات المحذوفة", "سجل المراجعة", "الإعدادات", "لوحة المطور"] },
]

const COLLAPSED_KEY = "pharmacy_sidebar_collapsed"

const SECTION_INDEX_HREFS = new Set([
  "/dashboard",
  "/dashboard/sales",
  "/dashboard/purchases",
  "/dashboard/items",
  "/dashboard/stocktaking",
  "/dashboard/users",
  "/dashboard/accounts",
  "/dashboard/reports",
  "/dashboard/hr",
  "/dashboard/crm",
  "/dashboard/sync",
  "/dashboard/settings",
])

const PREFIX_ACTIVE_DIRECT_HREFS = new Set(["/dashboard/settings"])

function normalizePath(value?: string | null) {
  if (!value) return ""
  const [pathOnly] = value.split(/[?#]/)
  return pathOnly.length > 1 ? pathOnly.replace(/\/+$/, "") : pathOnly
}

function pathMatches(pathname: string, href?: string, exactForIndex = true) {
  if (!href) return false
  const current = normalizePath(pathname)
  const target = normalizePath(href)
  if (!target) return false
  if (current === target) return true
  if (exactForIndex && SECTION_INDEX_HREFS.has(target)) return false
  return current.startsWith(`${target}/`)
}

function getActiveChildHref(pathname: string, children?: NavChild[]) {
  if (!children?.length) return null
  const matches = children
    .filter((child) => pathMatches(pathname, child.href, true))
    .sort((a, b) => normalizePath(b.href).length - normalizePath(a.href).length)
  return matches[0]?.href ?? null
}

function isSectionActive(pathname: string, item: NavItem, activeChildHref: string | null) {
  if (activeChildHref) return true
  if (!item.href) return false
  if (!item.children?.length) {
    return pathMatches(pathname, item.href, !PREFIX_ACTIVE_DIRECT_HREFS.has(normalizePath(item.href)))
  }
  return pathMatches(pathname, item.href, false)
}

function groupVisibleItems(items: NavItem[]) {
  const byTitle = new Map(items.map((item) => [item.title, item]))
  const used = new Set<string>()
  const groups = sidebarSections
    .map((section) => {
      const sectionItems = section.items
        .map((title) => byTitle.get(title))
        .filter(Boolean) as NavItem[]
      sectionItems.forEach((item) => used.add(item.title))
      return { title: section.title, items: sectionItems }
    })
    .filter((section) => section.items.length > 0)

  const remaining = items.filter((item) => !used.has(item.title))
  if (remaining.length > 0) groups.push({ title: "أخرى", items: remaining })
  return groups
}

const DashboardSidebar = memo(function DashboardSidebar({ open, onOpenChange, collapsed, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname()
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const { branchName, pharmacyName } = useBranch()
  const { isOwnerOrDev } = useUserRole()
  const { can, isDeveloper } = useAuth()
  const appSettings = useAppSettings()
  const appName = appSettings.get("system", "appName", "Logixa Pharmacy") || "Logixa Pharmacy"
  const appVersion = appSettings.get("system", "appVersion", "1.0.0") || "1.0.0"

  const visibleItems = useMemo(() => sidebarItems
    .map((item: NavItem) => {
      const visibleChildren = item.children?.filter((child) => canSeeNavEntry(child, can, isDeveloper))
      return { ...item, children: visibleChildren }
    })
    .filter((item: NavItem) => {
      if (!canSeeNavEntry({ ...item, permission: item.permission ?? navPermissions[item.title] ?? permissionForHref(item.href) }, can, isDeveloper)) {
        return Boolean(item.children?.length)
      }
      return !item.children || item.children.length > 0 || Boolean(item.href)
    }) as NavItem[], [can, isDeveloper])

  const visibleGroups = useMemo(() => groupVisibleItems(visibleItems), [visibleItems])

  useEffect(() => {
    if (collapsed !== undefined) {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    }
  }, [collapsed])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        if (window.innerWidth < 1024) {
          onOpenChange(!open)
        } else {
          onCollapsedChange?.(!collapsed)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, collapsed, onOpenChange, onCollapsedChange])

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/45 transition lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[280px] flex-col border-l border-sidebar-border bg-sidebar shadow-xl transition-transform duration-200 ease-in-out lg:shadow-none",
          collapsed ? "lg:translate-x-full" : "lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-[72px] items-center gap-2 border-b border-sidebar-border px-3">
          <Link
            href="/dashboard"
            title={`${appName} v${appVersion}`}
            onClick={() => onOpenChange(false)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-brand px-4 py-2.5 text-white shadow-sm transition hover:bg-brand-hover"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_0_4px_rgba(125,211,252,0.2)]" />
            <span className="min-w-0 truncate text-sm font-black tracking-wide" translate="no">{appName}</span>
          </Link>
          <button onClick={() => onOpenChange(false)} className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 pharmacy-scrollbar">
          <div className="space-y-4">
            {visibleGroups.map((section) => (
              <SidebarSection
                key={section.title}
                section={section}
                pathname={pathname}
                manualOpen={manualOpen}
                onManualToggle={(key) => setManualOpen((prev: Record<string, boolean>) => ({ ...prev, [key]: !prev[key] }))}
                onNavigate={() => onOpenChange(false)}
              />
            ))}
          </div>
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex h-12 items-center gap-2.5 rounded-2xl border border-sidebar-border/60 bg-white shadow-xs px-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
              <Store className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center leading-none">
              <span className="text-[10px] font-black text-slate-400">الفرع الحالي</span>
              <span className="mt-1 truncate text-xs font-black text-slate-800">{isOwnerOrDev ? (pharmacyName ?? "كل الصيدليات") : (branchName ?? "الفرع الرئيسي")}</span>
            </span>
          </div>
        </div>
      </aside>
    </>
  )
})

function SidebarSection({
  section, pathname, manualOpen, onManualToggle, onNavigate,
}: {
  section: { title: string; items: NavItem[] }
  pathname: string
  manualOpen: Record<string, boolean>
  onManualToggle: (key: string) => void
  onNavigate: () => void
}) {
  return (
    <section>
      <p className="px-2 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{section.title}</p>
      <ul className="space-y-1.5">
        {section.items.map((item) => (
          <SidebarNavItem
            key={item.title}
            item={item}
            pathname={pathname}
            manualOpen={manualOpen}
            onManualToggle={onManualToggle}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  )
}

function SidebarNavItem({
  item, pathname, manualOpen, onManualToggle, onNavigate,
}: {
  item: NavItem
  pathname: string
  manualOpen: Record<string, boolean>
  onManualToggle: (key: string) => void
  onNavigate: () => void
}) {
  const Icon = item.icon ? iconMap[item.icon] : undefined
  const hasChildren = Boolean(item.children?.length)
  const activeChildHref = getActiveChildHref(pathname, item.children)
  const childActive = Boolean(activeChildHref)
  const active = isSectionActive(pathname, item, activeChildHref)
  const isOpen = manualOpen[item.title] ?? childActive ?? false

  if (!hasChildren && item.href) {
    return (
      <li>
        <Link
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "group flex h-11 w-full items-center gap-2.5 rounded-2xl px-2.5 text-[14px] font-black transition-all duration-200",
            active
              ? "bg-brand text-white shadow-md"
              : "bg-white border border-sidebar-border/50 text-slate-700 shadow-xs hover:bg-brand-muted hover:text-brand active:scale-[0.99]",
          )}
        >
          {Icon && (
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-xl transition",
                active ? "bg-white/15 text-white" : "bg-white text-slate-600 shadow-sm group-hover:text-brand",
              )}
            >
              <Icon className="size-4" strokeWidth={2.2} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-right">{item.title}</span>
        </Link>
      </li>
    )
  }

  return (
    <li>
      <button
        onClick={() => onManualToggle(item.title)}
        aria-expanded={isOpen}
        className={cn(
          "group flex h-11 w-full items-center gap-2.5 rounded-2xl px-2.5 text-[14px] font-black transition-all duration-200",
          active
            ? "bg-brand text-white shadow-md"
            : "bg-white border border-sidebar-border/50 text-slate-700 shadow-xs hover:bg-brand-muted hover:text-brand active:scale-[0.99]",
        )}
      >
        {Icon && (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-xl transition",
              active ? "bg-white/15 text-white" : "bg-white text-slate-600 shadow-sm group-hover:text-brand",
            )}
          >
            <Icon className="size-4" strokeWidth={2.2} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right">{item.title}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform duration-200",
            active ? "text-white/85" : "text-slate-500",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <div className="mr-4 mt-1.5 border-r border-sidebar-border pr-3">
          <ul className="space-y-0.5 py-1">
            {item.children?.map((child) => {
              const isChildActive = activeChildHref === child.href
              return (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    onClick={onNavigate}
                    className={cn(
                      "group/child flex h-9 items-center gap-2 rounded-xl px-2 text-[13px] font-bold leading-none transition-all duration-150",
                      isChildActive
                        ? "bg-brand-subtle text-brand shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-brand",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full transition-colors",
                        isChildActive ? "bg-brand" : "bg-slate-300 group-hover/child:bg-slate-400",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-right">{child.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </li>
  )
}

export { DashboardSidebar }
