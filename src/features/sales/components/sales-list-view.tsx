"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Eye, Receipt, RefreshCw, Search, XCircle } from "lucide-react"
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

type SaleRow = {
  id: string
  branch_id: string
  invoice_number: string
  customer_name: string
  payment_status: string
  payment_method: string
  total: number
  paid_amount: number
  due_amount: number
  sale_date: string
  branch?: { id: string; name: string; code?: string | null } | null
}

type SalesResponse = {
  sales?: SaleRow[]
  summary?: { count: number; total: number; paid: number; due: number }
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

function paymentStatusLabel(value: string) {
  if (value === "paid") return "مدفوعة"
  if (value === "partial") return "جزئية"
  return "غير مدفوعة"
}

function paymentMethodLabel(value: string) {
  return {
    cash: "نقدي",
    card: "بطاقة",
    wallet: "محفظة",
    mixed: "متعدد",
    credit: "آجل",
  }[value] ?? value
}

function downloadCsv(rows: SaleRow[]) {
  const header = ["رقم الفاتورة", "العميل", "الفرع", "الإجمالي", "المدفوع", "المتبقي", "طريقة الدفع", "التاريخ"]
  const body = rows.map((sale) => [
    String(sale.invoice_number),
    sale.customer_name,
    sale.branch?.name ?? "",
    String(sale.total),
    String(sale.paid_amount),
    String(sale.due_amount),
    paymentMethodLabel(sale.payment_method),
    sale.sale_date,
  ])
  downloadCsv("المبيعات.csv", [header, ...body])
}

export function SalesListView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<SaleRow[]>([])
  const [summary, setSummary] = useState({ count: 0, total: 0, paid: 0, due: 0 })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [branchId, setBranchId] = useState("all")
  const [paymentStatus, setPaymentStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: branchId,
        payment_status: paymentStatus,
        query,
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/sales?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as SalesResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المبيعات")
      setRows(data.sales ?? [])
      setSummary(data.summary ?? { count: 0, total: 0, paid: 0, due: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المبيعات")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, branchId, page, paymentStatus, query])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const canVoid = auth.isDeveloper || auth.can("sales:void")
  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  const voidSale = useCallback(async (sale: SaleRow) => {
    const reason = window.prompt(`سبب إلغاء الفاتورة ${sale.invoice_number}:`, "إلغاء من سجل المبيعات")
    if (reason === null) return
    try {
      const response = await fetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إلغاء الفاتورة")
      toast.success("تم إلغاء الفاتورة وعكس المخزون وحساب الوردية")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إلغاء الفاتورة")
    }
  }, [load])

  const cards = useMemo(() => [
    { label: "عدد الفواتير", value: summary.count.toLocaleString("ar-EG"), tone: "text-slate-950" },
    { label: "إجمالي الصفحة", value: money(summary.total), tone: "text-brand" },
    { label: "المدفوع", value: money(summary.paid), tone: "text-emerald-700" },
    { label: "المتبقي", value: money(summary.due), tone: "text-rose-600" },
  ], [money, summary])

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="فواتير المبيعات"
          subtitle="متابعة الفواتير والمدفوع والمتبقي، مع عرض التفاصيل والإلغاء الآمن."
          icon={Receipt}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
                <Download className="size-4" /> تصدير الصفحة
              </Button>
              <Button className="h-10 rounded-xl" render={<Link href="/dashboard/sales/cashier" />}>
                فتح الكاشير
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                placeholder="رقم الفاتورة أو اسم العميل..."
                className="h-11 rounded-2xl pr-10 font-bold"
              />
            </div>
            <NativeSelect value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1) }}>
              {canChooseAllBranches ? <NativeSelectOption value="all">كل الفروع</NativeSelectOption> : null}
              {auth.branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل حالات الدفع</NativeSelectOption>
              <NativeSelectOption value="paid">مدفوعة</NativeSelectOption>
              <NativeSelectOption value="partial">جزئية</NativeSelectOption>
              <NativeSelectOption value="unpaid">غير مدفوعة</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

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

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Receipt} title="لا توجد فواتير مبيعات" description="ابدأ أول عملية بيع من شاشة الكاشير." />
          ) : (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم الفاتورة</TableHead>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">الإجمالي</TableHead>
                  <TableHead className="text-center">المدفوع</TableHead>
                  <TableHead className="text-center">المتبقي</TableHead>
                  <TableHead className="text-center">الدفع</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-black text-brand">{sale.invoice_number}</TableCell>
                    <TableCell className="font-bold">{sale.customer_name}</TableCell>
                    <TableCell>{sale.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center font-black">{money(sale.total)}</TableCell>
                    <TableCell className="text-center font-black text-emerald-700">{money(sale.paid_amount)}</TableCell>
                    <TableCell className="text-center font-black text-rose-600">{money(sale.due_amount)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn(
                        "font-black",
                        sale.payment_status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : sale.payment_status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-rose-200 bg-rose-50 text-rose-700",
                      )}>
                        {paymentStatusLabel(sale.payment_status)} — {paymentMethodLabel(sale.payment_method)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(sale.sale_date).toLocaleString("ar-EG")}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button size="icon" variant="ghost" render={<Link href={`/dashboard/sales/${sale.id}`} />} title="عرض الفاتورة">
                          <Eye className="size-4" />
                        </Button>
                        {canVoid ? (
                          <Button size="icon" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => void voidSale(sale)} title="إلغاء الفاتورة">
                            <XCircle className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
