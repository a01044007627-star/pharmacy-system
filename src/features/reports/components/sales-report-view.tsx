"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Calendar, Download, RefreshCw, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { downloadCsv as saveCsv } from "@/lib/csv-utils"
import { cn } from "@/lib/utils"

type DailyRow = {
  date: string
  count: number
  total: number
}

type ReportData = {
  summary: { total_sales: number; sales_count: number; average_sale: number; paid_amount: number; due_amount: number }
  daily: DailyRow[]
  error?: string
}

function exportSalesReportCsv(daily: DailyRow[], summary: ReportData["summary"]) {
  const header = ["التاريخ", "عدد الفواتير", "الإجمالي"]
  const rows = daily.map((d) => [d.date, String(d.count), String(d.total)])
  const footer = ["الإجمالي", String(summary.sales_count), String(summary.total_sales)]
  saveCsv("تقرير_المبيعات.csv", [header, ...rows, footer])
}

export function SalesReportView() {
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
  const [branchId, setBranchId] = useState("all")

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
        branch_id: branchId,
        date_from: dateFrom,
        date_to: dateTo,
      })
      const response = await fetch(`/api/reports/sales?${params.toString()}`, { cache: "no-store" })
      const json = (await response.json().catch(() => ({}))) as ReportData
      if (!response.ok) throw new Error(json.error ?? "فشل تحميل التقرير")
      setData(json)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل التقرير")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, branchId, dateFrom, dateTo])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const summary = data?.summary
  const daily = data?.daily ?? []

  const cards = useMemo(() => {
    if (!summary) return []
    return [
      { label: "إجمالي المبيعات", value: money(summary.total_sales), tone: "text-brand" },
      { label: "عدد الفواتير", value: summary.sales_count.toLocaleString("ar-EG"), tone: "text-slate-950" },
      { label: "متوسط الفاتورة", value: money(summary.average_sale), tone: "text-blue-700" },
      { label: "المدفوع", value: money(summary.paid_amount), tone: "text-emerald-700" },
    ]
  }, [summary, money])

  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  return (
    <PageAccess permission="reports:read" message="ليست لديك صلاحية عرض تقارير المبيعات">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="تقرير المبيعات"
          subtitle="تحليل يومي لحركة المبيعات والإيرادات."
          icon={BarChart3}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => exportSalesReportCsv(daily, summary!)} disabled={!data}>
                <Download className="size-4" /> تصدير CSV
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">من تاريخ</p>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setLoading(true) }} className="h-11 rounded-2xl font-bold" />
            </div>
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">إلى تاريخ</p>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setLoading(true) }} className="h-11 rounded-2xl font-bold" />
            </div>
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">الفرع</p>
              <NativeSelect value={branchId} onChange={(e) => { setBranchId(e.target.value); setLoading(true) }}>
                {canChooseAllBranches ? <NativeSelectOption value="all">كل الفروع</NativeSelectOption> : null}
                {auth.branches.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="flex items-end">
              <Button className="h-11 w-full rounded-2xl" onClick={() => void load()} disabled={loading}>
                <TrendingUp className="size-4" /> عرض التقرير
              </Button>
            </div>
          </CardContent>
        </Card>

        {cards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs font-black text-slate-400">{card.label}</p>
                  <p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? (
            <SkeletonRows count={6} />
          ) : daily.length === 0 ? (
            <EmptyState icon={Calendar} title="لا توجد بيانات" description="لم يتم العثور على مبيعات في النطاق المحدد." />
          ) : (
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-center">عدد الفواتير</TableHead>
                  <TableHead className="text-center">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-bold">{new Date(row.date).toLocaleDateString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-black">{row.count.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-black text-brand">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {daily.length > 0 ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <span className="text-xs font-black text-slate-500">إجمالي الأيام: {daily.length.toLocaleString("ar-EG")}</span>
            </div>
          ) : null}
        </Card>
      </section>
    </PageAccess>
  )
}
