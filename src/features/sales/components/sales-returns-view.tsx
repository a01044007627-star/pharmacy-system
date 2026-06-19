"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Receipt, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { calculateReturnSettlement } from "@/features/sales/lib/return-settlement"
import { cn } from "@/lib/utils"

type SaleSearchRow = {
  id: string
  invoice_number: string
  customer_name: string
  total: number
  paid_amount: number
  due_amount: number
  sale_date: string
  branch?: { name: string } | null
}

type ReturnableLine = {
  id: string
  item_name: string
  barcode?: string | null
  unit?: string | null
  quantity: number
  net_total: number
  returned_quantity: number
  returnable_quantity: number
  batch?: { batch_number?: string | null; expiry_date?: string | null } | null
}

type ReturnRow = {
  id: string
  return_number: string
  customer_name: string
  total: number
  refund_amount: number
  return_date: string
  reason?: string | null
  sale?: { invoice_number?: string | null } | null
  branch?: { name?: string | null } | null
}

export function SalesReturnsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [sales, setSales] = useState<SaleSearchRow[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleSearchRow | null>(null)
  const [lines, setLines] = useState<ReturnableLine[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loadingReturns, setLoadingReturns] = useState(true)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const loadReturns = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoadingReturns(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, branch_id: auth.activeBranchId ?? "all" })
      const response = await fetch(`/api/sales/returns?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { returns?: ReturnRow[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المرتجعات")
      setReturns(data.returns ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المرتجعات")
    } finally {
      setLoadingReturns(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId])

  useEffect(() => { void loadReturns() }, [loadReturns])

  useEffect(() => {
    if (!auth.activePharmacyId || search.trim().length < 2 || selectedSale) {
      setSales([])
      return
    }
    const timeout = window.setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({
          pharmacy_id: auth.activePharmacyId!,
          branch_id: auth.activeBranchId ?? "all",
          query: search.trim(),
          page_size: "10",
        })
        const response = await fetch(`/api/sales?${params.toString()}`, { cache: "no-store" })
        const data = await response.json().catch(() => ({})) as { sales?: SaleSearchRow[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل البحث عن الفاتورة")
        setSales(data.sales ?? [])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل البحث عن الفاتورة")
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [auth.activeBranchId, auth.activePharmacyId, search, selectedSale])

  async function chooseSale(sale: SaleSearchRow) {
    setSelectedSale(sale)
    setSearch(`${sale.invoice_number} — ${sale.customer_name}`)
    setSales([])
    try {
      const params = new URLSearchParams({ sale_id: sale.id })
      const response = await fetch(`/api/sales/returns?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { lines?: ReturnableLine[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل بنود الفاتورة")
      setLines(data.lines ?? [])
      setQuantities({})
    } catch (error) {
      setSelectedSale(null)
      setLines([])
      toast.error(error instanceof Error ? error.message : "فشل تحميل بنود الفاتورة")
    }
  }

  function clearSale() {
    setSelectedSale(null)
    setSearch("")
    setLines([])
    setQuantities({})
    setReason("")
  }

  const selectedLines = useMemo(() => lines.flatMap((line) => {
    const quantity = Number(quantities[line.id] ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) return []
    return [{ sale_line_id: line.id, quantity: Math.min(quantity, line.returnable_quantity) }]
  }), [lines, quantities])

  const total = useMemo(() => selectedLines.reduce((sum, selected) => {
    const line = lines.find((row) => row.id === selected.sale_line_id)
    if (!line || line.quantity <= 0) return sum
    return sum + (line.net_total / line.quantity) * selected.quantity
  }, 0), [lines, selectedLines])

  const settlement = calculateReturnSettlement(
    total,
    Number(selectedSale?.due_amount ?? 0),
    Number(selectedSale?.paid_amount ?? 0),
  )

  async function saveReturn() {
    if (!selectedSale || selectedLines.length === 0) {
      toast.error("اختر فاتورة وحدد كمية مرتجعة")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/sales/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          sale_id: selectedSale.id,
          client_request_id: crypto.randomUUID(),
          reason,
          lines: selectedLines,
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ المرتجع")
      toast.success(`تم حفظ المرتجع؛ المبلغ المسترد ${money(settlement.refundAmount)}`)
      clearSale()
      await loadReturns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ المرتجع")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="مرتجعات المبيعات"
          subtitle="مرتجع مرتبط بالفاتورة والتشغيلة الأصلية، مع منع تكرار الكمية وتسوية المديونية والمبلغ المسترد آليًا."
          icon={RotateCcw}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void loadReturns()}>
                <RefreshCw className={cn("size-4", loadingReturns && "animate-spin")} /> تحديث
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/sales" />}>
                <ArrowRight className="size-4" /> فواتير المبيعات
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-black">إنشاء مرتجع من فاتورة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => {
                  if (selectedSale) {
                    setSelectedSale(null)
                    setLines([])
                    setQuantities({})
                    setReason("")
                  }
                  setSearch(event.target.value)
                }}
                placeholder="ابحث برقم الفاتورة أو اسم العميل..."
                className="h-11 rounded-2xl pr-10 font-bold"
              />
              {!selectedSale && search.trim().length >= 2 ? (
                <div className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  {searching ? <div className="p-4 text-center text-sm font-bold text-slate-500">جاري البحث...</div>
                    : sales.length === 0 ? <div className="p-4 text-center text-sm font-bold text-slate-500">لا توجد فواتير مطابقة</div>
                      : sales.map((sale) => (
                        <button key={sale.id} type="button" onClick={() => void chooseSale(sale)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-right last:border-0 hover:bg-slate-50">
                          <span>
                            <strong className="block text-sm text-slate-950">{sale.invoice_number}</strong>
                            <span className="text-xs font-bold text-slate-500">{sale.customer_name} — {sale.branch?.name ?? "الفرع"}</span>
                          </span>
                          <span className="font-black text-brand">{money(sale.total)}</span>
                        </button>
                      ))}
                </div>
              ) : null}
            </div>

            {selectedSale ? (
              <>
                <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-4">
                  <div><span className="text-xs font-black text-slate-400">الفاتورة</span><strong className="mt-1 block">{selectedSale.invoice_number}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">العميل</span><strong className="mt-1 block">{selectedSale.customer_name}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">المدفوع الحالي</span><strong className="mt-1 block text-emerald-700">{money(selectedSale.paid_amount)}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">المديونية الحالية</span><strong className="mt-1 block text-rose-600">{money(selectedSale.due_amount)}</strong></div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">الصنف</TableHead>
                        <TableHead className="text-center">التشغيلة</TableHead>
                        <TableHead className="text-center">المباع</TableHead>
                        <TableHead className="text-center">مرتجع سابق</TableHead>
                        <TableHead className="text-center">المتاح</TableHead>
                        <TableHead className="text-center">كمية المرتجع</TableHead>
                        <TableHead className="text-center">القيمة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => {
                        const quantity = Math.min(Number(quantities[line.id] ?? 0) || 0, line.returnable_quantity)
                        const value = line.quantity > 0 ? (line.net_total / line.quantity) * quantity : 0
                        return (
                          <TableRow key={line.id}>
                            <TableCell><strong>{line.item_name}</strong><span className="block text-xs text-slate-400" dir="ltr">{line.barcode ?? "—"}</span></TableCell>
                            <TableCell className="text-center text-xs font-bold">{line.batch?.batch_number ?? "—"}</TableCell>
                            <TableCell className="text-center font-black">{Number(line.quantity).toLocaleString("ar-EG")} {line.unit ?? ""}</TableCell>
                            <TableCell className="text-center font-black text-amber-700">{Number(line.returned_quantity).toLocaleString("ar-EG")}</TableCell>
                            <TableCell className="text-center font-black text-emerald-700">{Number(line.returnable_quantity).toLocaleString("ar-EG")}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                max={line.returnable_quantity}
                                step="0.001"
                                disabled={line.returnable_quantity <= 0}
                                value={quantities[line.id] ?? ""}
                                onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                                className="mx-auto h-10 w-28 rounded-xl text-center font-black"
                              />
                            </TableCell>
                            <TableCell className="text-center font-black text-brand">{money(value)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                  <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب المرتجع أو ملاحظات المراجعة..." className="min-h-28 rounded-2xl" />
                  <div className="space-y-3 rounded-2xl bg-slate-950 p-4 text-white">
                    <div className="flex justify-between text-sm font-bold"><span>قيمة المرتجع</span><strong>{money(settlement.total)}</strong></div>
                    <div className="flex justify-between text-sm font-bold text-amber-300"><span>تخفيض المديونية</span><strong>{money(settlement.dueReduction)}</strong></div>
                    <div className="flex justify-between border-t border-white/15 pt-3 text-base font-black text-emerald-300"><span>المبلغ المسترد</span><strong>{money(settlement.refundAmount)}</strong></div>
                    <Button className="h-11 w-full rounded-xl font-black" disabled={saving || selectedLines.length === 0} onClick={() => void saveReturn()}>
                      <RotateCcw className="size-4" /> {saving ? "جاري الحفظ..." : "حفظ المرتجع"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">سجل المرتجعات</CardTitle></CardHeader>
          {loadingReturns ? <SkeletonRows count={4} /> : returns.length === 0 ? (
            <EmptyState icon={Receipt} title="لا توجد مرتجعات مبيعات" description="ستظهر هنا المرتجعات المرتبطة بفواتير البيع." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم المرتجع</TableHead>
                  <TableHead className="text-right">الفاتورة</TableHead>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">القيمة</TableHead>
                  <TableHead className="text-center">المسترد</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black text-brand">{row.return_number}</TableCell>
                    <TableCell className="font-black">{row.sale?.invoice_number ?? "—"}</TableCell>
                    <TableCell>{row.customer_name}</TableCell>
                    <TableCell>{row.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center font-black">{money(row.total)}</TableCell>
                    <TableCell className="text-center font-black text-rose-600">{money(row.refund_amount)}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(row.return_date).toLocaleString("ar-EG")}</TableCell>
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
