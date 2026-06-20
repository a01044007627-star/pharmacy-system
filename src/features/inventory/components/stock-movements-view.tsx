"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Download, RefreshCw, Search } from "lucide-react"
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

type MovementRow = {
  id: string
  item_id: string
  branch_id: string
  direction: string
  quantity: number
  unit_price: number
  total_value: number
  movement_type: string
  source_table: string | null
  source_id: string | null
  created_at: string
  item: { id: string; name_ar: string; sku: string | null; unit: string | null } | null
  branch: { id: string; name: string; code: string | null } | null
}

type ResponseData = {
  records?: MovementRow[]
  summary?: { total_movements: number; total_in: number; total_out: number; net_quantity: number; total_value_in: number; total_value_out: number }
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

const EMPTY_SUMMARY = { total_movements: 0, total_in: 0, total_out: 0, net_quantity: 0, total_value_in: 0, total_value_out: 0 }

function movementTypeLabel(type: string) {
  const map: Record<string, string> = {
    purchase: "شراء",
    sale: "بيع",
    transfer: "تحويل",
    adjustment: "تسوية",
    damaged: "تالف",
    return: "مرتجع",
    opening: "افتتاحي",
  }
  return map[type] ?? type
}

function directionLabel(dir: string) {
  if (dir === "in") return "وارد"
  if (dir === "out") return "صادر"
  return "تسوية"
}

function exportMovementsCsv(rows: MovementRow[]) {
  const data = [
    ["التاريخ", "الصنف", "SKU", "الفرع", "الاتجاه", "الكمية", "سعر الوحدة", "القيمة", "نوع الحركة", "المصدر"],
    ...rows.map((row) => [row.created_at, row.item?.name_ar ?? "", row.item?.sku ?? "", row.branch?.name ?? "", directionLabel(row.direction), String(row.quantity), String(row.unit_price), String(row.total_value), movementTypeLabel(row.movement_type), row.source_table ?? ""]),
  ]
  saveCsv("حركة_المخزون.csv", data)
}

export function StockMovementsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<MovementRow[]>([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [movementType, setMovementType] = useState("all")
  const [direction, setDirection] = useState("all")
  const [sourceTable, setSourceTable] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const money = useCallback((v: number) => `${Number(v || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRows([])
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId ?? "all",
        page: String(page),
        page_size: "50",
      })
      if (search.trim()) params.set("query", search.trim())
      if (movementType !== "all") params.set("movement_type", movementType)
      if (direction !== "all") params.set("direction", direction)
      if (sourceTable !== "all") params.set("source_table", sourceTable)
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const response = await fetch(`/api/inventory/stock-movements?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الحركة")
      setRows(data.records ?? [])
      setSummary(data.summary ?? EMPTY_SUMMARY)
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل حركة المخزون")
    } finally { setLoading(false) }
  }, [auth.activeBranchId, auth.activePharmacyId, auth.loading, dateFrom, dateTo, direction, movementType, page, search, sourceTable])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const cards = useMemo(() => [
    { label: "إجمالي الحركات", value: summary.total_movements.toLocaleString("ar-EG"), tone: "text-slate-950" },
    { label: "إجمالي الوارد", value: summary.total_in.toLocaleString("ar-EG"), tone: "text-emerald-700" },
    { label: "إجمالي الصادر", value: summary.total_out.toLocaleString("ar-EG"), tone: "text-rose-600" },
    { label: "صافي الكمية", value: summary.net_quantity.toLocaleString("ar-EG"), tone: summary.net_quantity >= 0 ? "text-blue-700" : "text-rose-600" },
    { label: "قيمة الوارد", value: money(summary.total_value_in), tone: "text-emerald-700" },
    { label: "قيمة الصادر", value: money(summary.total_value_out), tone: "text-rose-600" },
  ], [money, summary])

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="حركة المخزون"
          subtitle="سجل حركة الأصناف (وارد/صادر) مع التفاصيل."
icon={ArrowRight}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => exportMovementsCsv(rows)} disabled={!rows.length}>
                <Download className="size-4" /> تصدير الصفحة
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="ابحث باسم الصنف أو SKU..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={movementType} onChange={(e) => { setMovementType(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل أنواع الحركة</NativeSelectOption>
              <NativeSelectOption value="purchase">شراء</NativeSelectOption>
              <NativeSelectOption value="sale">بيع</NativeSelectOption>
              <NativeSelectOption value="transfer">تحويل</NativeSelectOption>
              <NativeSelectOption value="adjustment">تسوية</NativeSelectOption>
              <NativeSelectOption value="damaged">تالف</NativeSelectOption>
              <NativeSelectOption value="return">مرتجع</NativeSelectOption>
              <NativeSelectOption value="opening">افتتاحي</NativeSelectOption>
            </NativeSelect>
            <NativeSelect value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الاتجاهات</NativeSelectOption>
              <NativeSelectOption value="in">وارد</NativeSelectOption>
              <NativeSelectOption value="out">صادر</NativeSelectOption>
            </NativeSelect>
            <NativeSelect value={sourceTable} onChange={(e) => { setSourceTable(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل المصادر</NativeSelectOption>
              <NativeSelectOption value="pharmacy_sales">فواتير البيع</NativeSelectOption>
              <NativeSelectOption value="pharmacy_purchases">فواتير الشراء</NativeSelectOption>
              <NativeSelectOption value="pharmacy_sales_returns">مرتجعات البيع</NativeSelectOption>
              <NativeSelectOption value="pharmacy_purchase_returns">مرتجعات الشراء</NativeSelectOption>
              <NativeSelectOption value="pharmacy_stock_transfers">تحويلات مخزنية</NativeSelectOption>
              <NativeSelectOption value="pharmacy_stock_counts">الجرد</NativeSelectOption>
            </NativeSelect>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="h-11 rounded-2xl font-bold" />
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="h-11 rounded-2xl font-bold" />
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {cards.map((card) => (
            <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-black text-slate-400">{card.label}</p>
                <p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={ArrowRight} title="لا توجد حركات مخزون" description="لم يتم تسجيل أي حركة بعد." />
          ) : (
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الصنف</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">الاتجاه</TableHead>
                  <TableHead className="text-center">الكمية</TableHead>
                  <TableHead className="text-center">سعر الوحدة</TableHead>
                  <TableHead className="text-center">القيمة</TableHead>
                  <TableHead className="text-center">نوع الحركة</TableHead>
                  <TableHead className="text-center">المصدر</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black">{row.item?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-bold">{row.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", row.direction === "in" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                        {directionLabel(row.direction)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-black">{Number(row.quantity).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center font-bold">{money(row.unit_price)}</TableCell>
                    <TableCell className="text-center font-black">{money(row.total_value)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 font-black">
                        {movementTypeLabel(row.movement_type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs text-slate-500">{row.source_table ?? "—"}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((v) => Math.max(1, v - 1))}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
