"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Eye, Plus, RefreshCw, Search, Truck } from "lucide-react"
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

type PurchaseRow = {
  id: string
  purchase_number: string
  supplier_name: string
  payment_status: string
  payment_method: string
  total: number
  paid_amount: number
  due_amount: number
  purchase_date: string
  branch?: { name: string } | null
}

type ResponseData = {
  purchases?: PurchaseRow[]
  summary?: { count: number; total: number; paid: number; due: number }
  pagination?: { totalPages: number }
  error?: string
}

function statusLabel(value: string) {
  if (value === "paid") return "مدفوعة"
  if (value === "partial") return "جزئية"
  return "غير مدفوعة"
}

function exportPurchasesCsv(rows: PurchaseRow[]) {
  const data = [
    ["رقم الفاتورة", "المورد", "الفرع", "الإجمالي", "المدفوع", "المتبقي", "التاريخ"],
    ...rows.map((row) => [row.purchase_number, row.supplier_name, row.branch?.name ?? "", String(row.total), String(row.paid_amount), String(row.due_amount), row.purchase_date]),
  ]
  saveCsv("المشتريات.csv", data)
}

export function PurchasesListView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [summary, setSummary] = useState({ count: 0, total: 0, paid: 0, due: 0 })
  const [query, setQuery] = useState("")
  const [paymentStatus, setPaymentStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

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
        query,
        payment_status: paymentStatus,
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/purchases?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المشتريات")
      setRows(data.purchases ?? [])
      setSummary(data.summary ?? { count: 0, total: 0, paid: 0, due: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المشتريات")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, auth.loading, page, paymentStatus, query])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const cards = useMemo(() => [
    ["عدد الفواتير", summary.count.toLocaleString("ar-EG"), "text-slate-950"],
    ["إجمالي الصفحة", money(summary.total), "text-brand"],
    ["المدفوع", money(summary.paid), "text-emerald-700"],
    ["المتبقي للموردين", money(summary.due), "text-rose-600"],
  ], [money, summary])

  return (
    <PageAccess permission="purchases:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="فواتير المشتريات"
          subtitle="متابعة الفواتير المستلمة والمدفوع والمتبقي للموردين."
          icon={Truck}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
              <Button variant="outline" className="h-10 rounded-xl" disabled={!rows.length} onClick={() => exportPurchasesCsv(rows)}><Download className="size-4" /> تصدير</Button>
              {(auth.isDeveloper || auth.can("purchases:write")) ? (
                <Button className="h-10 rounded-xl" render={<Link href="/dashboard/purchases/new" />}><Plus className="size-4" /> فاتورة شراء</Button>
              ) : null}
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="رقم الفاتورة أو اسم المورد..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل حالات الدفع</NativeSelectOption>
              <NativeSelectOption value="paid">مدفوعة</NativeSelectOption>
              <NativeSelectOption value="partial">جزئية</NativeSelectOption>
              <NativeSelectOption value="unpaid">غير مدفوعة</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, tone]) => (
            <Card key={label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone)}>{value}</p></CardContent></Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Truck} title="لا توجد فواتير مشتريات" description="ابدأ باستلام أول فاتورة شراء وإضافة أصنافها للمخزون." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">رقم الفاتورة</TableHead><TableHead className="text-right">المورد</TableHead><TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-center">الإجمالي</TableHead><TableHead className="text-center">المدفوع</TableHead><TableHead className="text-center">المتبقي</TableHead>
                <TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">التاريخ</TableHead><TableHead className="text-center">عرض</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.purchase_number}</TableCell><TableCell className="font-bold">{row.supplier_name}</TableCell><TableCell>{row.branch?.name ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{money(row.total)}</TableCell><TableCell className="text-center font-black text-emerald-700">{money(row.paid_amount)}</TableCell><TableCell className="text-center font-black text-rose-600">{money(row.due_amount)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", row.payment_status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : row.payment_status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{statusLabel(row.payment_status)}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.purchase_date).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center"><Button size="icon" variant="ghost" render={<Link href={`/dashboard/purchases/${row.id}`} />}><Eye className="size-4" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
