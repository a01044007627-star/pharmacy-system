"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Calendar, Download, RefreshCw, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { downloadCsv as saveCsv } from "@/lib/csv-utils"
import { cn } from "@/lib/utils"

type SummaryRow = {
  date: string
  sales_total: number
  sales_profit: number
  purchases_total: number
  expenses_total: number
  net_profit: number
}

type ReportData = {
  summary: {
    total_sales: number
    total_purchases: number
    gross_sales?: number
    returns_total?: number
    net_sales?: number
    cost_of_goods?: number
    gross_profit: number
    profit_margin: number
    total_expenses: number
    net_profit: number
    sales_count: number
    returns_count?: number
    purchases_count: number
    expenses_count: number
  }
  daily_summary: SummaryRow[]
  summary_totals: { sales_total: number; sales_profit: number; purchases_total: number; expenses_total: number; net_profit: number }
  error?: string
}

function exportProfitLossCsv(rows: SummaryRow[]) {
  const header = ["التاريخ", "المبيعات", "الأرباح", "المشتريات", "المصروفات", "صافي الربح"]
  const data = [header, ...rows.map((r) => [r.date, String(r.sales_total), String(r.sales_profit), String(r.purchases_total), String(r.expenses_total), String(r.net_profit)])]
  saveCsv("تقرير_الأرباح_والخسائر.csv", data)
}

export function ProfitLossView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const money = useCallback(
    (value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
    [currency],
  )

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        date_from: dateFrom,
        date_to: dateTo,
      })
      const response = await fetch(`/api/reports/profit-loss?${params.toString()}`, { cache: "no-store" })
      const json = (await response.json().catch(() => ({}))) as ReportData
      if (!response.ok) throw new Error(json.error ?? "فشل تحميل التقرير")
      setData(json)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل التقرير")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, dateFrom, dateTo])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const summary = data?.summary
  const daily = data?.daily_summary ?? []

  const summaryCards = useMemo(() => {
    if (!summary) return []
    return [
      { label: "إجمالي المبيعات", value: money(summary.total_sales), tone: "text-brand" },
      { label: "مرتجعات المبيعات", value: money(summary.returns_total ?? 0), tone: "text-rose-600" },
      { label: "صافي المبيعات", value: money(summary.net_sales ?? summary.total_sales), tone: "text-blue-700" },
      { label: "تكلفة البضاعة المباعة", value: money(summary.cost_of_goods ?? 0), tone: "text-slate-950" },
      { label: "إجمالي المصروفات", value: money(summary.total_expenses), tone: "text-rose-600" },
      { label: "هامش الربح", value: `${summary.profit_margin.toFixed(1)}%`, tone: "text-blue-700" },
    ]
  }, [summary, money])

  const profitCards = useMemo(() => {
    if (!summary) return []
    return [
      { label: "إجمالي الربح", value: money(summary.gross_profit), tone: summary.gross_profit >= 0 ? "text-emerald-700" : "text-rose-600" },
      { label: "صافي الربح", value: money(summary.net_profit), tone: summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600" },
    ]
  }, [summary, money])

  return (
    <PageAccess permission="reports:read" message="ليست لديك صلاحية عرض تقارير الأرباح والخسائر">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="الأرباح والخسائر"
          subtitle="صافي المبيعات ناقص تكلفة البضاعة المباعة والمصروفات؛ المشتريات تظهر كمؤشر ولا تُخصم مباشرة من الربح."
          icon={BarChart3}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => exportProfitLossCsv(daily)} disabled={!data}>
                <Download className="size-4" /> تصدير CSV
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">من تاريخ</p>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setLoading(true) }} className="h-11 rounded-2xl font-bold" />
            </div>
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">إلى تاريخ</p>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setLoading(true) }} className="h-11 rounded-2xl font-bold" />
            </div>
            <div className="flex items-end">
              <Button className="h-11 w-full rounded-2xl" onClick={() => void load()} disabled={loading}>
                <TrendingUp className="size-4" /> عرض التقرير
              </Button>
            </div>
          </CardContent>
        </Card>

        {summaryCards.length > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-black text-slate-400">{card.label}</p>
                    <p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {profitCards.map((card) => (
                <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-black text-slate-400">{card.label}</p>
                    <p className={cn("mt-2 text-2xl font-black", card.tone)}>{card.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? (
            <SkeletonRows count={6} />
          ) : daily.length === 0 ? (
            <EmptyState icon={Calendar} title="لا توجد بيانات" description="لم يتم العثور على بيانات في النطاق المحدد." />
          ) : (
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-center">المبيعات</TableHead>
                  <TableHead className="text-center">أرباح المبيعات</TableHead>
                  <TableHead className="text-center">المشتريات</TableHead>
                  <TableHead className="text-center">المصروفات</TableHead>
                  <TableHead className="text-center">صافي الربح</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-bold">{new Date(row.date).toLocaleDateString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-black text-brand">{money(row.sales_total)}</TableCell>
                    <TableCell className="text-center font-black text-emerald-700">{money(row.sales_profit)}</TableCell>
                    <TableCell className="text-center font-black">{money(row.purchases_total)}</TableCell>
                    <TableCell className="text-center font-black text-rose-600">{money(row.expenses_total)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn(
                        "font-black",
                        row.net_profit >= 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-rose-200 bg-rose-50 text-rose-700",
                      )}>
                        {money(row.net_profit)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
