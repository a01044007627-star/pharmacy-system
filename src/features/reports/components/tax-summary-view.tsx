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

type TaxRateRow = {
  tax_group_id: string
  tax_name: string
  tax_rate: number
  is_active: boolean
  estimated_tax: number
}

type ReportData = {
  summary: { total_sales_count: number; total_sales_amount: number; total_discount: number; total_tax_collected: number; effective_tax_rate: number }
  tax_rates: TaxRateRow[]
  error?: string
}

function exportTaxSummaryCsv(summary: ReportData["summary"], taxRates: TaxRateRow[]) {
  const lines = [
    ["البيان", "القيمة"],
    ["عدد الفواتير", String(summary.total_sales_count)],
    ["إجمالي المبيعات", String(summary.total_sales_amount)],
    ["إجمالي الخصم", String(summary.total_discount)],
    ["إجمالي الضريبة المحصلة", String(summary.total_tax_collected)],
    ["معدل الضريبة الفعلي", `${summary.effective_tax_rate.toFixed(2)}%`],
    [],
    ["شريحة الضريبة", "المعدل", "الضريبة المقدرة", "نشط"],
    ...taxRates.map((r) => [r.tax_name, `${r.tax_rate}%`, String(r.estimated_tax), r.is_active ? "نعم" : "لا"]),
  ]
  saveCsv("تقرير_الضرائب.csv", lines)
}

export function TaxSummaryView() {
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
      const response = await fetch(`/api/reports/tax-summary?${params.toString()}`, { cache: "no-store" })
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
  const taxRates = data?.tax_rates ?? []

  const summaryCards = useMemo(() => {
    if (!summary) return []
    return [
      { label: "عدد الفواتير", value: summary.total_sales_count.toLocaleString("ar-EG"), tone: "text-slate-950" },
      { label: "إجمالي المبيعات", value: money(summary.total_sales_amount), tone: "text-brand" },
      { label: "إجمالي الخصم", value: money(summary.total_discount), tone: "text-amber-700" },
      { label: "ضريبة محصلة", value: money(summary.total_tax_collected), tone: "text-emerald-700" },
    ]
  }, [summary, money])

  return (
    <PageAccess permission="reports:read" message="ليست لديك صلاحية عرض تقارير الضرائب">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="ملخص الضرائب"
          subtitle="الضرائب المحصلة على المبيعات حسب الشرائح الضريبية."
          icon={BarChart3}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => exportTaxSummaryCsv(summary!, taxRates)} disabled={!data}>
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

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-black text-slate-400">معدل الضريبة الفعلي</p>
                <p className={cn("mt-2 text-2xl font-black",
                  (summary?.effective_tax_rate ?? 0) > 0 ? "text-brand" : "text-slate-500"
                )}>
                  {(summary?.effective_tax_rate ?? 0).toFixed(2)}%
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? (
            <SkeletonRows count={4} />
          ) : taxRates.length === 0 ? (
            <EmptyState icon={Calendar} title="لا توجد شرائح ضريبية" description="لم يتم إعداد أي شرائح ضريبية بعد." />
          ) : (
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشريحة الضريبية</TableHead>
                  <TableHead className="text-center">المعدل</TableHead>
                  <TableHead className="text-center">الضريبة المقدرة</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxRates.map((rate) => (
                  <TableRow key={rate.tax_group_id}>
                    <TableCell className="font-black">{rate.tax_name}</TableCell>
                    <TableCell className="text-center font-black">{rate.tax_rate}%</TableCell>
                    <TableCell className="text-center font-black text-brand">{money(rate.estimated_tax)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn(
                        "font-black",
                        rate.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500",
                      )}>
                        {rate.is_active ? "نشط" : "غير نشط"}
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
