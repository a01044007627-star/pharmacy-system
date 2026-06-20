"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Calendar, Download, RefreshCw, TrendingUp, Users } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { downloadCsv as saveCsv } from "@/lib/csv-utils"
import { cn } from "@/lib/utils"

type CustomerRow = {
  rank: number
  customer_name: string
  customer_phone: string
  total_sales: number
  transaction_count: number
  total_paid: number
  total_due: number
}

type ReportData = {
  customers: CustomerRow[]
  summary: { total_customers: number; total_sales: number; total_transactions: number }
  error?: string
}

function exportCustomerActivityCsv(customers: CustomerRow[]) {
  const header = ["الترتيب", "اسم العميل", "رقم الهاتف", "إجمالي المشتريات", "عدد الفواتير", "المدفوع", "المتبقي"]
  const data = [header, ...customers.map((r) => [String(r.rank), r.customer_name, r.customer_phone, String(r.total_sales), String(r.transaction_count), String(r.total_paid), String(r.total_due)])]
  saveCsv("تقرير_نشاط_العملاء.csv", data)
}

export function CustomerActivityView() {
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
      const response = await fetch(`/api/reports/customer-activity?${params.toString()}`, { cache: "no-store" })
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

  const customers = data?.customers ?? []
  const reportSummary = data?.summary

  const summaryCards = useMemo(() => {
    if (!reportSummary) return []
    return [
      { label: "عدد العملاء", value: reportSummary.total_customers.toLocaleString("ar-EG"), tone: "text-brand" },
      { label: "إجمالي المبيعات", value: money(reportSummary.total_sales), tone: "text-slate-950" },
      { label: "إجمالي المعاملات", value: reportSummary.total_transactions.toLocaleString("ar-EG"), tone: "text-blue-700" },
    ]
  }, [reportSummary, money])

  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  return (
    <PageAccess permission="reports:read" message="ليست لديك صلاحية عرض تقارير العملاء">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="نشاط العملاء"
          subtitle="أفضل العملاء حسب إجمالي المشتريات وعدد الفواتير."
          icon={Users}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => exportCustomerActivityCsv(customers)} disabled={customers.length === 0}>
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

        {summaryCards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {summaryCards.map((card) => (
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
          ) : customers.length === 0 ? (
            <EmptyState icon={Calendar} title="لا توجد بيانات" description="لم يتم العثور على معاملات في النطاق المحدد." />
          ) : (
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-right">اسم العميل</TableHead>
                  <TableHead className="text-right">رقم الهاتف</TableHead>
                  <TableHead className="text-center">إجمالي المشتريات</TableHead>
                  <TableHead className="text-center">عدد الفواتير</TableHead>
                  <TableHead className="text-center">المدفوع</TableHead>
                  <TableHead className="text-center">المتبقي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={`${customer.customer_name}-${customer.rank}`}>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-black border-slate-200 bg-white text-slate-500">
                        {customer.rank}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-black text-brand">{customer.customer_name}</TableCell>
                    <TableCell className="font-bold" dir="ltr">{customer.customer_phone || "—"}</TableCell>
                    <TableCell className="text-center font-black">{money(customer.total_sales)}</TableCell>
                    <TableCell className="text-center font-black">{customer.transaction_count.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-black text-emerald-700">{money(customer.total_paid)}</TableCell>
                    <TableCell className="text-center font-black text-rose-600">{money(customer.total_due)}</TableCell>
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
