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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { downloadCsv } from "@/lib/csv-utils"
import { cn } from "@/lib/utils"

type ItemRow = {
  rank: number
  item_id: string
  item_name: string
  quantity_sold: number
  total_revenue: number
  total_cost: number
  total_profit: number
  transaction_count: number
  margin: number
}

type ReportData = {
  items: ItemRow[]
  total_items: number
  error?: string
}

const rankBadgeClass = [
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-slate-200 bg-slate-100 text-slate-600",
  "border-orange-200 bg-orange-50 text-orange-700",
]

function downloadCsv(items: ItemRow[]) {
  const header = ["الترتيب", "اسم الصنف", "الكمية", "الإيرادات", "التكلفة", "الربح", "عدد المعاملات", "نسبة الربح"]
  const data = [header, ...items.map((r) => [String(r.rank), r.item_name, String(r.quantity_sold), String(r.total_revenue), String(r.total_cost), String(r.total_profit), String(r.transaction_count), `${r.margin.toFixed(1)}%`])]
  downloadCsv("تقرير_أفضل_الأصناف.csv", data)
}

export function TopItemsView() {
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
  const [limit, setLimit] = useState("20")

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
        limit,
      })
      const response = await fetch(`/api/reports/top-items?${params.toString()}`, { cache: "no-store" })
      const json = (await response.json().catch(() => ({}))) as ReportData
      if (!response.ok) throw new Error(json.error ?? "فشل تحميل التقرير")
      setData(json)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل التقرير")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, branchId, dateFrom, dateTo, limit])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const items = data?.items ?? []
  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  return (
    <PageAccess permission="reports:read" message="ليست لديك صلاحية عرض تقارير الأصناف">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="أفضل الأصناف مبيعاً"
          subtitle="ترتيب الأصناف حسب الكمية المباعة والإيرادات والأرباح."
          icon={BarChart3}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => downloadCsv(items)} disabled={items.length === 0}>
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
            <div>
              <p className="mb-1 text-xs font-black text-slate-500">عدد الأصناف</p>
              <NativeSelect value={limit} onChange={(e) => { setLimit(e.target.value); setLoading(true) }}>
                <NativeSelectOption value="10">10</NativeSelectOption>
                <NativeSelectOption value="20">20</NativeSelectOption>
                <NativeSelectOption value="50">50</NativeSelectOption>
                <NativeSelectOption value="100">100</NativeSelectOption>
              </NativeSelect>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? (
            <SkeletonRows count={6} />
          ) : items.length === 0 ? (
            <EmptyState icon={Calendar} title="لا توجد بيانات" description="لم يتم العثور على مبيعات في النطاق المحدد." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-right">اسم الصنف</TableHead>
                  <TableHead className="text-center">الكمية المباعة</TableHead>
                  <TableHead className="text-center">الإيرادات</TableHead>
                  <TableHead className="text-center">التكلفة</TableHead>
                  <TableHead className="text-center">الربح</TableHead>
                  <TableHead className="text-center">نسبة الربح</TableHead>
                  <TableHead className="text-center">عدد المعاملات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.item_id}>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", rankBadgeClass[item.rank - 1] ?? "border-slate-200 bg-white text-slate-500")}>
                        {item.rank}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-black text-brand">{item.item_name}</TableCell>
                    <TableCell className="text-center font-black text-lg">{item.quantity_sold.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-black">{money(item.total_revenue)}</TableCell>
                    <TableCell className="text-center font-black text-slate-500">{money(item.total_cost)}</TableCell>
                    <TableCell className="text-center font-black text-emerald-700">{money(item.total_profit)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn(
                        "font-black",
                        item.margin >= 30 ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : item.margin >= 15 ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-rose-200 bg-rose-50 text-rose-700",
                      )}>
                        {item.margin.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-bold">{item.transaction_count.toLocaleString("ar-EG")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {items.length > 0 ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <span className="text-xs font-black text-slate-500">إجمالي الأصناف المعروضة: {data?.total_items.toLocaleString("ar-EG")}</span>
            </div>
          ) : null}
        </Card>
      </section>
    </PageAccess>
  )
}
