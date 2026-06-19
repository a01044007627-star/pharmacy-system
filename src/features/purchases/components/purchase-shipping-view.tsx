"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Search, Truck } from "lucide-react"
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
import { cn } from "@/lib/utils"

type ShippingRow = {
  id: string
  purchase_number: string
  supplier_name: string
  total: number
  shipping_fee: number
  purchase_date: string
  status: string
  branch?: { name: string } | null
}

export function PurchaseShippingView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<ShippingRow[]>([])
  const [summary, setSummary] = useState({ count: 0, total_shipping: 0, total_purchases: 0 })
  const [query, setQuery] = useState("")
  const [branchId, setBranchId] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: branchId,
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/purchases/shipping?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { shipping?: ShippingRow[]; summary?: { count: number; total_shipping: number; total_purchases: number }; pagination?: { totalPages: number }; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل تكاليف الشحن")
      setRows(data.shipping ?? [])
      setSummary(data.summary ?? { count: 0, total_shipping: 0, total_purchases: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل تكاليف الشحن")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, branchId, page])

  useEffect(() => { void load() }, [load])

  return (
    <PageAccess permission="purchases:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="تكاليف الشحن"
          subtitle="متابعة تكاليف الشحن المرتبطة بفواتير الشراء."
          icon={Truck}
          actions={<Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="بحث برقم الفاتورة أو المورد..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الفروع</NativeSelectOption>
              {auth.branches.map((br) => <NativeSelectOption key={br.id} value={br.id}>{br.name}</NativeSelectOption>)}
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">عدد الفواتير</p><p className="mt-2 text-xl font-black">{summary.count.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي الشحن</p><p className="mt-2 text-xl font-black text-brand">{money(summary.total_shipping)}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي المشتريات</p><p className="mt-2 text-xl font-black text-slate-950">{money(summary.total_purchases)}</p></CardContent></Card>
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Truck} title="لا توجد تكاليف شحن" description="تظهر هنا فواتير الشراء التي تحتوي على تكاليف شحن." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">رقم الفاتورة</TableHead><TableHead className="text-right">المورد</TableHead><TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-center">إجمالي الفاتورة</TableHead><TableHead className="text-center">تكلفة الشحن</TableHead><TableHead className="text-center">التاريخ</TableHead><TableHead className="text-center">الحالة</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.purchase_number}</TableCell><TableCell className="font-bold">{row.supplier_name}</TableCell><TableCell>{row.branch?.name ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{money(row.total)}</TableCell><TableCell className="text-center font-black text-amber-700">{money(row.shipping_fee)}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.purchase_date).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center"><span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">مستلمة</span></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>التالي</Button></div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
