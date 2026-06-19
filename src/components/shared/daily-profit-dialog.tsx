"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { BarChart3, Box, Loader2, Receipt, RefreshCw, TrendingUp, Wallet, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/contexts/auth-context"
import { buildDailyProfitSummary, type DailyProfitSummary, type DailyProfitRow } from "@/lib/daily-profit-service"
import { cn } from "@/lib/utils"

const emptySummary: DailyProfitSummary = {
  generatedAt: 0,
  rangeStart: 0,
  rangeEnd: 0,
  dataSource: "offline",
  pendingSyncCount: 0,
  salesSubtotal: 0,
  salesTotal: 0,
  salesDiscount: 0,
  salesShipping: 0,
  salesExtraFees: 0,
  salesReturnTotal: 0,
  customerRewardDiscounts: 0,
  purchasesSubtotal: 0,
  purchasesTotal: 0,
  purchaseShipping: 0,
  purchaseExtraExpenses: 0,
  purchaseTransferCost: 0,
  purchaseReturnTotal: 0,
  purchaseDiscounts: 0,
  roundingDifferences: 0,
  moduleRevenues: 0,
  endingInventoryPurchaseValue: 0,
  endingInventorySaleValue: 0,
  openingInventoryPurchaseValue: 0,
  openingInventorySaleValue: 0,
  expensesTotal: 0,
  stockCountGainLoss: 0,
  salariesTotal: 0,
  productionCostTotal: 0,
  damagedStockCost: 0,
  costOfGoodsSold: 0,
  grossProfit: 0,
  netProfit: 0,
  salesCount: 0,
  purchasesCount: 0,
  expensesCount: 0,
}


function formatDashboardMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatTime(value: number) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(value: number) {
  if (!value) return "اليوم"
  return new Date(value).toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function ProfitRow({ row }: { row: DailyProfitRow }) {
  const toneClass = {
    blue: "bg-[#dcecff] text-slate-900",
    green: "bg-[#e6fbf1] text-slate-900",
    amber: "bg-[#fff4da] text-slate-900",
    white: "bg-[#f4faff] text-slate-900",
  }[row.tone ?? "green"]

  return (
    <div className={cn("grid grid-cols-[1fr_135px] items-center gap-3 border-b border-white/80 px-4 py-2.5 last:border-b-0", toneClass)}>
      <div className="text-right">
        <p className="text-[13px] font-black leading-5 text-slate-800">{row.label}</p>
        {row.hint ? <p className="mt-0.5 text-[11px] font-bold leading-4 text-slate-500">{row.hint}</p> : null}
      </div>
      <p dir="ltr" className="text-left text-[13px] font-black tabular-nums text-slate-900">
        {formatDashboardMoney(row.value)} ج.م
      </p>
    </div>
  )
}

function ProfitSection({ title, rows, icon: Icon, compact = false }: {
  title?: string
  rows: DailyProfitRow[]
  icon?: LucideIcon
  compact?: boolean
}) {
  return (
    <Card className="overflow-hidden border-[#d6e0e8] bg-white py-0 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
      {title ? (
        <CardHeader className="border-b border-slate-100 bg-white px-4 py-3">
          <CardTitle className="flex items-center justify-between gap-3 text-[13px] font-black text-slate-800">
            <span>{title}</span>
            {Icon ? (
              <span className="flex size-8 items-center justify-center rounded-xl bg-[#edf8ff] text-[#075985]">
                <Icon className="size-4" />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn("px-0", compact && "text-[12px]")}> 
        {rows.map((row, index) => (
          <ProfitRow key={`${row.label}-${row.hint ?? ""}-${index}`} row={row} />
        ))}
      </CardContent>
    </Card>
  )
}

function FormulaCard({ tone, title, value, formula }: {
  tone: "amber" | "blue" | "green"
  title: string
  value: number
  formula: string
}) {
  const toneClass = {
    amber: "border-[#ead8ad] bg-[#fff4df] text-[#7a5b16]",
    blue: "border-[#c8ddf5] bg-[#e7f2ff] text-[#1e3a8a]",
    green: "border-[#c3ead9] bg-[#e6fbf1] text-[#047857]",
  }[tone]

  return (
    <div className={cn("rounded-xl border px-5 py-4 text-center shadow-sm", toneClass)}>
      <p className="text-2xl font-black leading-8 text-slate-700 sm:text-3xl">
        {title}: <span dir="ltr" className="tabular-nums">{formatDashboardMoney(value)} ج.م</span>
      </p>
      <p className="mx-auto mt-1 max-w-5xl text-[11px] font-bold leading-5 text-slate-500">{formula}</p>
    </div>
  )
}

export function DailyProfitDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const [summary, setSummary] = useState<DailyProfitSummary>(emptySummary)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await buildDailyProfitSummary(user?.id)
      setSummary(next)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [open, refresh])

  const sections = useMemo(() => {
    const rightMainRows: DailyProfitRow[] = [
      { label: "إجمالي المبيعات:", hint: "السعر بعد الخصم", value: summary.salesTotal, tone: "blue" },
      { label: "رسوم شحن وتوصيل المبيعات:", value: summary.salesShipping, tone: "green" },
      { label: "رسوم بيعية مضافة:", value: summary.salesExtraFees, tone: "green" },
      { label: "إجمالي المخزون المسترد:", value: summary.salesReturnTotal, tone: "green" },
      { label: "إجمالي مرتجع المشتريات:", value: summary.purchaseReturnTotal, tone: "green" },
      { label: "خصومات مشتريات مكتسبة:", value: summary.purchaseDiscounts, tone: "green" },
      { label: "فروقات تقريب السعر:", value: summary.roundingDifferences, tone: "green" },
    ]

    const rightModuleRows: DailyProfitRow[] = [
      { label: "إيرادات الموديلات المضافة", value: summary.moduleRevenues, tone: "blue" },
    ]

    const rightInventoryRows: DailyProfitRow[] = [
      { label: "مخزون آخر المدة", hint: "بسعر الشراء", value: summary.endingInventoryPurchaseValue, tone: "white" },
      { label: "مخزون آخر المدة", hint: "بسعر البيع", value: summary.endingInventorySaleValue, tone: "green" },
    ]

    const leftPurchaseRows: DailyProfitRow[] = [
      { label: "إجمالي المشتريات:", hint: "السعر الخام", value: summary.purchasesTotal, tone: "blue" },
      { label: "رسوم شحن وتوصيل المشتريات:", value: summary.purchaseShipping, tone: "green" },
      { label: "نفقات إضافية للمشتريات:", value: summary.purchaseExtraExpenses, tone: "green" },
      { label: "تكاليف النقل المخزني:", value: summary.purchaseTransferCost, tone: "green" },
      { label: "إجمالي مرتجع المبيعات:", value: summary.salesReturnTotal, tone: "green" },
      { label: "خصومات مبيعات مسموح بها:", value: summary.salesDiscount, tone: "green" },
      { label: "خصومات نقاط مكافأة العملاء:", value: summary.customerRewardDiscounts, tone: "green" },
    ]

    const leftExpenseRows: DailyProfitRow[] = [
      { label: "مجموع المصاريف:", value: summary.expensesTotal, tone: "blue" },
      { label: "مكاسب | خسائر عمليات الجرد:", value: summary.stockCountGainLoss, tone: "blue" },
      { label: "إجمالي الرواتب:", value: summary.salariesTotal, tone: "blue" },
      { label: "إجمالي تكلفة الإنتاج:", value: summary.productionCostTotal, tone: "blue" },
    ]

    const leftOpeningInventoryRows: DailyProfitRow[] = [
      { label: "مخزون أول المدة - الافتتاحي", hint: "بسعر الشراء", value: summary.openingInventoryPurchaseValue, tone: "white" },
      { label: "مخزون أول المدة - الافتتاحي", hint: "بسعر البيع", value: summary.openingInventorySaleValue, tone: "green" },
    ]

    return {
      rightMainRows,
      rightModuleRows,
      rightInventoryRows,
      leftPurchaseRows,
      leftExpenseRows,
      leftOpeningInventoryRows,
    }
  }, [summary])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        showCloseButton={false}
        className="max-h-[92vh] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-none border-[#d6e0e8] bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.26)] sm:max-w-[1180px] sm:rounded-2xl"
      >
        <DialogHeader className="border-b border-slate-100 bg-white px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0b5b7b] to-[#172554] text-white shadow-lg shadow-[#0b5b7b]/20">
                <TrendingUp className="size-5" />
              </span>
              <div>
                <DialogTitle className="text-xl font-black text-slate-900">ربح اليوم</DialogTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                  <span>تاريخ التقرير: {formatDate(summary.rangeStart)}</span>
                  <span>آخر تحديث: {formatTime(summary.generatedAt)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                    {summary.dataSource === "online" ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={refresh} disabled={loading} className="h-10 rounded-xl border-slate-200 px-3 text-[12px] font-black text-slate-700">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                تحديث
              </Button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
                aria-label="إغلاق"
                title="إغلاق"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(92vh-150px)] overflow-y-auto bg-[#f6fafc] px-4 py-5 pharmacy-scrollbar sm:px-5">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <ProfitSection title="المشتريات والخصومات" rows={sections.leftPurchaseRows} icon={Receipt} />
              <ProfitSection title="المصاريف والتشغيل" rows={sections.leftExpenseRows} icon={Wallet} />
              <ProfitSection title="مخزون أول المدة" rows={sections.leftOpeningInventoryRows} icon={Box} />
            </div>

            <div className="space-y-5">
              <ProfitSection title="المبيعات والمرتجعات" rows={sections.rightMainRows} icon={BarChart3} />
              <ProfitSection rows={sections.rightModuleRows} />
              <ProfitSection title="مخزون آخر المدة" rows={sections.rightInventoryRows} icon={Box} />
            </div>
          </div>

          <Card className="mt-6 border-[#d6e0e8] bg-white py-0 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-3 px-4 py-4">
              <FormulaCard
                tone="amber"
                title="تكلفة البضاعة المباعة"
                value={summary.costOfGoodsSold}
                formula="تكلفة البضاعة المباعة = مخزون أول المدة بسعر الشراء + صافي المشتريات + تكلفة الإنتاج + تكلفة الهالك والتالف - مخزون آخر المدة بسعر الشراء"
              />
              <FormulaCard
                tone="blue"
                title="إجمالي الربح"
                value={summary.grossProfit}
                formula="إجمالي الربح = إجمالي المبيعات بعد الخصم + الرسوم والإيرادات الإضافية - تكلفة البضاعة المباعة - مرتجعات البيع"
              />
              <FormulaCard
                tone="green"
                title="صافي الربح"
                value={summary.netProfit}
                formula="صافي الربح = إجمالي الربح + خصومات مشتريات مكتسبة + فروقات تقريب السعر + مكاسب الجرد - المصاريف والرواتب وتكاليف التشغيل"
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-bold text-slate-500">
            مبيعات اليوم: {summary.salesCount} — مشتريات اليوم: {summary.purchasesCount} — مصروفات اليوم: {summary.expensesCount} — المعلّق: {summary.pendingSyncCount}
          </p>
          <Button type="button" onClick={() => onOpenChange(false)} className="h-11 rounded-xl bg-slate-900 px-8 text-[13px] font-black text-white hover:bg-slate-800">
            إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
