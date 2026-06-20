"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Box,
  Calendar,
  DollarSign,
  FileText,
  Package,
  RefreshCw,
  ShoppingCart,
  Clock,
  TrendingUp,
  Truck,
  ClipboardList,
  Settings,
  Receipt,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/contexts/auth-context"
import { EmptyState } from "@/components/shared/empty-state"
import { cn } from "@/lib/utils"

type DashboardStats = {
  todaySalesTotal: number
  todaySalesCount: number
  todayPurchasesTotal: number
  todayPurchasesCount: number
  todayExpensesTotal: number
  activeShifts: number
  pendingTasks: number
  lowStockAlerts: number
}

type RecentInvoice = {
  id: string
  invoice_number: string
  customer_name: string
  total: number
  sale_date: string
  status: string
}

type DashboardHomeData = {
  stats: DashboardStats
  recentInvoices: RecentInvoice[]
}

const emptyData: DashboardHomeData = {
  stats: {
    todaySalesTotal: 0,
    todaySalesCount: 0,
    todayPurchasesTotal: 0,
    todayPurchasesCount: 0,
    todayExpensesTotal: 0,
    activeShifts: 0,
    pendingTasks: 0,
    lowStockAlerts: 0,
  },
  recentInvoices: [],
}

type FetchState = "idle" | "loading" | "success" | "error"

function QuickActionCard({
  title,
  href,
  icon: Icon,
  color,
}: {
  title: string
  href: string
  icon: typeof ShoppingCart
  color: "blue" | "orange" | "green" | "purple" | "cyan" | "slate"
}) {
  const colorMap = {
    blue: "border-blue-200 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:from-blue-600 hover:to-blue-700",
    orange: "border-orange-200 bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 hover:from-orange-600 hover:to-orange-700",
    green: "border-emerald-200 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:from-emerald-600 hover:to-emerald-700",
    purple: "border-violet-200 bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-600 hover:to-violet-700",
    cyan: "border-cyan-200 bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-600 hover:to-cyan-700",
    slate: "border-slate-200 bg-gradient-to-br from-slate-600 to-slate-700 text-white shadow-lg shadow-slate-500/25 hover:shadow-slate-500/40 hover:from-slate-700 hover:to-slate-800",
  }

  return (
    <Link href={href} className="group block">
      <Card
        className={cn(
          "overflow-hidden rounded-2xl border-0 py-0 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-xl",
          colorMap[color],
        )}
      >
        <CardContent className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="flex flex-col items-end gap-1">
            <span className="text-lg font-black leading-tight">{title}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-white/70 group-hover:text-white/90">
              <span>الدخول</span>
              <ArrowLeft className="size-3.5" />
            </span>
          </div>
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Icon className="size-7" strokeWidth={2.2} />
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string
  value: string
  icon: typeof ShoppingCart
  tone: "blue" | "green" | "amber" | "red" | "purple" | "cyan"
  loading?: boolean
}) {
  const toneMap = {
    blue: "bg-sky-50 text-sky-600 border-sky-100",
    green: "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    red: "bg-rose-50 text-rose-600 border-rose-100",
    purple: "bg-violet-50 text-violet-600 border-violet-100",
    cyan: "bg-cyan-50 text-cyan-600 border-cyan-100",
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white py-0 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 px-5 py-4">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl border", toneMap[tone])}>
          <Icon className="size-6" strokeWidth={2.2} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <span className="text-xs font-bold text-slate-500">{label}</span>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-24 rounded-md" />
          ) : (
            <span className="text-lg font-black text-slate-950">{value}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function getDisplayName(profileName?: string | null, email?: string | null) {
  const name = profileName?.trim() || email?.split("@")[0] || "المستخدم"
  return name || "المستخدم"
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function InvoiceRow({ invoice }: { invoice: RecentInvoice }) {
  const statusBadge = {
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    draft: "bg-slate-50 text-slate-600 border-slate-200",
    voided: "bg-rose-50 text-rose-600 border-rose-200",
  }

  const statusLabel: Record<string, string> = {
    completed: "مكتمل",
    pending: "معلق",
    draft: "مسودة",
    voided: "ملغي",
  }

  const badgeClass = statusBadge[invoice.status as keyof typeof statusBadge] ?? statusBadge.completed
  const label = statusLabel[invoice.status as keyof typeof statusLabel] ?? invoice.status

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 transition-colors hover:bg-slate-50">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <Receipt className="size-4" />
        </span>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-900">{invoice.customer_name || "زبون نقدي"}</p>
          <p className="text-xs font-bold text-slate-400">
            فاتورة #{invoice.invoice_number}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge className={cn("rounded-lg border px-2 py-0.5 text-[11px] font-black", badgeClass)}>
          {label}
        </Badge>
        <span className="min-w-[90px] text-left text-sm font-black text-slate-950 tabular-nums">
          {formatMoney(invoice.total)} ج.م
        </span>
      </div>
    </div>
  )
}

export function DashboardHomeView() {
  const { profile, user, activeBranch, activePharmacy, isDeveloper } = useAuth()
  const [data, setData] = useState<DashboardHomeData>(emptyData)
  const [fetchState, setFetchState] = useState<FetchState>("loading")

  const displayName = getDisplayName(profile?.full_name, user?.email)

  const fetchDashboardData = useCallback(async () => {
    setFetchState("loading")
    try {
      const today = new Date().toISOString().split("T")[0]

      const [salesRes, purchasesRes, expensesRes, tasksRes, stockRes, shiftsRes] = await Promise.allSettled([
        fetch(`/api/sales?date_from=${today}&date_to=${today}&page_size=5`),
        fetch(`/api/purchases?date_from=${today}&date_to=${today}&page_size=1`),
        fetch(`/api/expenses?date_from=${today}&date_to=${today}&page_size=1`),
        fetch("/api/tasks?completed=false&page_size=1"),
        fetch("/api/inventory/stock-balances?page_size=1"),
        fetch("/api/sales/cashier/shift?page_size=1"),
      ])

      const salesData = salesRes.status === "fulfilled" ? await salesRes.value.json() : { data: [], count: 0, total: 0 }
      const purchasesData = purchasesRes.status === "fulfilled" ? await purchasesRes.value.json() : { data: [], count: 0, total: 0 }
      const expensesData = expensesRes.status === "fulfilled" ? await expensesRes.value.json() : { data: [], count: 0, total: 0 }
      const tasksData = tasksRes.status === "fulfilled" ? await tasksRes.value.json() : { count: 0 }
      const stockData = stockRes.status === "fulfilled" ? await stockRes.value.json() : { data: [] }
      const shiftsData = shiftsRes.status === "fulfilled" ? await shiftsRes.value.json() : { data: [] }

      const salesList = Array.isArray(salesData) ? salesData : salesData.data ?? []
      const purchasesList = Array.isArray(purchasesData) ? purchasesData : purchasesData.data ?? []
      const expensesList = Array.isArray(expensesData) ? expensesData : expensesData.data ?? []
      const shiftsList = Array.isArray(shiftsData) ? shiftsData : shiftsData.data ?? []

      const salesTotal = salesList.reduce((sum: number, s: { total?: number }) => sum + Number(s.total ?? 0), 0)
      const purchasesTotal = purchasesList.reduce((sum: number, p: { total?: number }) => sum + Number(p.total ?? 0), 0)
      const expensesTotal = expensesList.reduce((sum: number, e: { amount?: number }) => sum + Number(e.amount ?? 0), 0)

      const lowStockCount = stockData.data?.filter((item: { current_stock?: number }) => Number(item.current_stock ?? 0) <= 5).length ?? 0
      const activeShiftsCount = shiftsList.filter((s: { status?: string }) => s.status === "active").length

      setData({
        stats: {
          todaySalesTotal: salesTotal,
          todaySalesCount: salesList.length,
          todayPurchasesTotal: purchasesTotal,
          todayPurchasesCount: purchasesList.length,
          todayExpensesTotal: expensesTotal,
          activeShifts: activeShiftsCount,
          pendingTasks: tasksData.count ?? 0,
          lowStockAlerts: lowStockCount,
        },
        recentInvoices: salesList.slice(0, 5).map((s: { id: string; invoice_number?: string; customer_name?: string; total?: number; sale_date?: string; status?: string }) => ({
          id: s.id,
          invoice_number: s.invoice_number ?? "---",
          customer_name: s.customer_name ?? "",
          total: Number(s.total ?? 0),
          sale_date: s.sale_date ?? "",
          status: s.status ?? "completed",
        })),
      })
      setFetchState("success")
    } catch {
      setFetchState("error")
      toast.error("حدث خطأ أثناء تحميل البيانات", {
        description: "تأكد من الاتصال وحاول مرة أخرى",
      })
    }
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData])

  const quickActions = useMemo(() => [
    { title: "فاتورة جديدة", href: "/dashboard/sales/cashier", icon: ShoppingCart, color: "blue" as const },
    { title: "إضافة صنف", href: "/dashboard/items/new", icon: Package, color: "green" as const },
    { title: "مشتريات جديدة", href: "/dashboard/purchases/new", icon: Truck, color: "orange" as const },
    { title: "تقرير المبيعات", href: "/dashboard/reports/sales", icon: TrendingUp, color: "purple" as const },
    { title: "المخزون", href: "/dashboard/stocktaking/stock", icon: Box, color: "cyan" as const },
    { title: "الإعدادات السريعة", href: "/dashboard/settings", icon: Settings, color: "slate" as const },
  ], [])

  const statsCards = useMemo(() => {
    const s = data.stats
    return [
      { label: "مبيعات اليوم", value: `${formatMoney(s.todaySalesTotal)} ج.م`, icon: ShoppingCart, tone: "blue" as const },
      { label: "عدد فواتير اليوم", value: `${s.todaySalesCount} فاتورة`, icon: FileText, tone: "green" as const },
      { label: "المشتريات اليوم", value: `${formatMoney(s.todayPurchasesTotal)} ج.م`, icon: Truck, tone: "amber" as const },
      { label: "المصروفات اليوم", value: `${formatMoney(s.todayExpensesTotal)} ج.م`, icon: DollarSign, tone: "red" as const },
      { label: "المهام المعلقة", value: `${s.pendingTasks} مهمة`, icon: ClipboardList, tone: "purple" as const },
      { label: "الورديات النشطة", value: `${s.activeShifts} وردية`, icon: Clock, tone: "cyan" as const },
    ]
  }, [data.stats])

  const lowestock = data.stats.lowStockAlerts

  if (fetchState === "loading") {
    return (
      <div dir="rtl" className="mx-auto w-full max-w-[1500px] space-y-5 px-4 pb-10 pt-4 sm:px-5 lg:px-6">
        <div className="rounded-[28px] bg-brand px-6 py-8 text-white shadow-lg">
          <Skeleton className="h-10 w-64 rounded-lg bg-white/20" />
          <Skeleton className="mt-3 h-5 w-48 rounded-lg bg-white/15" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-2xl bg-white/80" />
          ))}
        </div>
        <Skeleton className="h-[200px] rounded-2xl bg-white/80" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-2xl bg-white/80" />
          ))}
        </div>
      </div>
    )
  }

  if (fetchState === "error") {
    return (
      <div dir="rtl" className="mx-auto w-full max-w-[1500px] px-4 pb-10 pt-4 sm:px-5 lg:px-6">
        <EmptyState
          icon={AlertCircle}
          title="تعذر تحميل البيانات"
          description="حدث خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى."
          action={
            <Button onClick={fetchDashboardData} className="h-10 gap-2 rounded-xl px-5 text-sm font-black">
              <RefreshCw className="size-4" />
              إعادة المحاولة
            </Button>
          }
          className="min-h-[400px]"
        />
      </div>
    )
  }

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1500px] space-y-6 px-4 pb-10 pt-4 sm:px-5 lg:px-6">
      <section className="relative overflow-visible rounded-[28px] bg-gradient-to-br from-brand to-blue-700 px-6 py-7 text-white shadow-[0_18px_45px_rgba(37,99,235,0.22)] sm:px-8 lg:px-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black leading-tight sm:text-4xl">
              أهلاً وسهلاً، {displayName}
            </h1>
            <p className="mt-2 text-sm font-bold text-blue-100">
              {isDeveloper ? "وضع المطور" : activeBranch?.name ?? activePharmacy?.name ?? "نظام إدارة الصيدلية"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lowestock > 0 ? (
              <Badge className="h-8 gap-1.5 rounded-xl bg-rose-500/20 px-3 text-xs font-black text-rose-100 ring-1 ring-rose-300/30">
                <AlertTriangle className="size-3.5" />
                {lowestock} إنذار مخزون
              </Badge>
            ) : null}
            <Badge className="h-8 gap-1.5 rounded-xl bg-white/15 px-3 text-xs font-black text-white ring-1 ring-white/20">
              <Calendar className="size-3.5" />
              {new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </Badge>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-950">الإجراءات السريعة</h2>
          <span className="text-xs font-bold text-slate-400">اختر ما تريد فعله</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {quickActions.map((action) => (
            <QuickActionCard key={action.title} title={action.title} href={action.href} icon={action.icon} color={action.color} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-black text-slate-950">ملخص اليوم</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statsCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white py-0 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-black text-slate-950">آخر الفواتير</CardTitle>
                <Link
                  href="/dashboard/sales"
                  className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:text-brand-hover"
                >
                  <span>عرض الكل</span>
                  <ArrowLeft className="size-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {data.recentInvoices.length > 0 ? (
                <div className="space-y-2">
                  {data.recentInvoices.map((invoice) => (
                    <InvoiceRow key={invoice.id} invoice={invoice} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Receipt}
                  title="لا توجد فواتير اليوم"
                  description="لم يتم تسجيل أي فواتير بيع اليوم بعد."
                  className="min-h-[160px]"
                />
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white py-0 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-black text-slate-950">تنبيهات سريعة</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <ClipboardList className="size-4" />
                    </span>
                    <span className="text-sm font-bold text-slate-900">المهام المعلقة</span>
                  </div>
                  <span className="text-lg font-black text-slate-950">{data.stats.pendingTasks}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                      <AlertTriangle className="size-4" />
                    </span>
                    <span className="text-sm font-bold text-slate-900">إنذار المخزون المنخفض</span>
                  </div>
                  <span className="text-lg font-black text-slate-950">{lowestock}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <Clock className="size-4" />
                    </span>
                    <span className="text-sm font-bold text-slate-900">الورديات النشطة</span>
                  </div>
                  <span className="text-lg font-black text-slate-950">{data.stats.activeShifts}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <ShoppingCart className="size-4" />
                    </span>
                    <span className="text-sm font-bold text-slate-900">فواتير اليوم</span>
                  </div>
                  <span className="text-lg font-black text-slate-950">{data.stats.todaySalesCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
