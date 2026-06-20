"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Package, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type PurchaseSearchRow = {
  id: string
  purchase_number: string
  supplier_name: string
  total: number
  paid_amount: number
  due_amount: number
  purchase_date: string
  branch?: { name: string } | null
}

type ReturnableLine = {
  id: string
  item_name: string
  unit?: string | null
  batch_number?: string | null
  expiry_date?: string | null
  quantity: number
  buy_price: number
  net_total: number
  returned_quantity: number
  returnable_quantity: number
}

type ReturnRow = {
  id: string
  return_number: string
  supplier_name: string
  total: number
  refund_amount: number
  stock_mode?: string | null
  reason?: string | null
  created_at: string
  branch?: { name?: string | null } | null
}

export function PurchaseReturnsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [purchases, setPurchases] = useState<PurchaseSearchRow[]>([])
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseSearchRow | null>(null)
  const [lines, setLines] = useState<ReturnableLine[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [stockMode, setStockMode] = useState("restock")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loadingReturns, setLoadingReturns] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const loadReturns = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoadingReturns(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, branch_id: auth.activeBranchId ?? "all", page: String(page), page_size: "25" })
      const response = await fetch(`/api/purchases/returns?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { returns?: ReturnRow[]; pagination?: { totalPages: number }; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل مرتجعات المشتريات")
      setReturns(data.returns ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل مرتجعات المشتريات")
    } finally {
      setLoadingReturns(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, page])

  useEffect(() => { void loadReturns() }, [loadReturns])

  useEffect(() => {
    if (!auth.activePharmacyId || search.trim().length < 2 || selectedPurchase) {
      setPurchases([])
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
        const response = await fetch(`/api/purchases?${params.toString()}`, { cache: "no-store" })
        const data = await response.json().catch(() => ({})) as { purchases?: PurchaseSearchRow[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل البحث عن الفاتورة")
        setPurchases(data.purchases ?? [])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل البحث عن الفاتورة")
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [auth.activeBranchId, auth.activePharmacyId, search, selectedPurchase])

  async function choosePurchase(purchase: PurchaseSearchRow) {
    setSelectedPurchase(purchase)
    setSearch(`${purchase.purchase_number} — ${purchase.supplier_name}`)
    setPurchases([])
    try {
      const params = new URLSearchParams({ purchase_id: purchase.id })
      const response = await fetch(`/api/purchases/returns?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { lines?: ReturnableLine[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل بنود الفاتورة")
      setLines(data.lines ?? [])
      setQuantities({})
    } catch (error) {
      setSelectedPurchase(null)
      setLines([])
      toast.error(error instanceof Error ? error.message : "فشل تحميل بنود الفاتورة")
    }
  }

  function clearPurchase() {
    setSelectedPurchase(null)
    setSearch("")
    setLines([])
    setQuantities({})
    setReason("")
  }

  const selectedLines = useMemo(() => lines.flatMap((line) => {
    const quantity = Number(quantities[line.id] ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) return []
    return [{ purchase_line_id: line.id, quantity: Math.min(quantity, line.returnable_quantity) }]
  }), [lines, quantities])

  const totalRefund = useMemo(() => selectedLines.reduce((sum, sl) => {
    const line = lines.find((l) => l.id === sl.purchase_line_id)
    if (!line || line.quantity <= 0) return sum
    return sum + (line.buy_price) * sl.quantity
  }, 0), [lines, selectedLines])

  async function saveReturn() {
    if (!selectedPurchase || selectedLines.length === 0) {
      toast.error("اختر فاتورة وحدد كمية مرتجعة")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/purchases/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          purchase_id: selectedPurchase.id,
          client_request_id: crypto.randomUUID(),
          stock_mode: stockMode,
          reason,
          lines: selectedLines,
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ المرتجع")
      toast.success(`تم حفظ مرتجع الشراء بقيمة ${money(totalRefund)}`)
      clearPurchase()
      await loadReturns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ المرتجع")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageAccess permission="purchases:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="مرتجعات المشتريات"
          subtitle="مرتجع أصناف للمورد مع إعادة المخزون أو استبعاده."
          icon={RotateCcw}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void loadReturns()}>
                <RefreshCw className={cn("size-4", loadingReturns && "animate-spin")} /> تحديث
              </Button>
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-black">إنشاء مرتجع من فاتورة شراء</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => {
                  if (selectedPurchase) { clearPurchase(); return }
                  setSearch(e.target.value)
                }}
                placeholder="ابحث برقم الفاتورة أو اسم المورد..."
                className="h-11 rounded-2xl pr-10 font-bold"
              />
              {!selectedPurchase && search.trim().length >= 2 ? (
                <div className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  {searching ? <div className="p-4 text-center text-sm font-bold text-slate-500">جاري البحث...</div>
                    : purchases.length === 0 ? <div className="p-4 text-center text-sm font-bold text-slate-500">لا توجد فواتير مطابقة</div>
                      : purchases.map((p) => (
                        <button key={p.id} type="button" onClick={() => void choosePurchase(p)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-right last:border-0 hover:bg-slate-50">
                          <span>
                            <strong className="block text-sm text-slate-950">{p.purchase_number}</strong>
                            <span className="text-xs font-bold text-slate-500">{p.supplier_name} — {p.branch?.name ?? "الفرع"}</span>
                          </span>
                          <span className="font-black text-brand">{money(p.total)}</span>
                        </button>
                      ))}
                </div>
              ) : null}
            </div>

            {selectedPurchase ? (
              <>
                <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-4">
                  <div><span className="text-xs font-black text-slate-400">الفاتورة</span><strong className="mt-1 block">{selectedPurchase.purchase_number}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">المورد</span><strong className="mt-1 block">{selectedPurchase.supplier_name}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">الإجمالي</span><strong className="mt-1 block">{money(selectedPurchase.total)}</strong></div>
                  <div><span className="text-xs font-black text-slate-400">المدفوع</span><strong className="mt-1 block text-emerald-700">{money(selectedPurchase.paid_amount)}</strong></div>
                </div>

                <div className="grid gap-2">
                  <Label className="font-bold">نظام المخزون</Label>
                  <NativeSelect value={stockMode} onChange={(e) => setStockMode(e.target.value)}>
                    <NativeSelectOption value="restock">إعادة المخزون (زيادة المخزون)</NativeSelectOption>
                    <NativeSelectOption value="write-off">استبعاد (لا يعاد للمخزون)</NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <Table className="min-w-[900px]">
                    <TableHeader><TableRow>
                      <TableHead className="text-right">الصنف</TableHead><TableHead className="text-center">التشغيلة</TableHead><TableHead className="text-center">المستلم</TableHead>
                      <TableHead className="text-center">مرتجع سابق</TableHead><TableHead className="text-center">المتاح</TableHead>
                      <TableHead className="text-center">كمية المرتجع</TableHead><TableHead className="text-center">سعر الشراء</TableHead><TableHead className="text-center">القيمة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{lines.map((line) => {
                      const quantity = Math.min(Number(quantities[line.id] ?? 0) || 0, line.returnable_quantity)
                      const value = quantity * line.buy_price
                      return <TableRow key={line.id}>
                        <TableCell><strong>{line.item_name}</strong></TableCell>
                        <TableCell className="text-center text-xs font-bold">{line.batch_number ?? "—"}</TableCell>
                        <TableCell className="text-center font-black">{Number(line.quantity).toLocaleString("ar-EG")} {line.unit ?? ""}</TableCell>
                        <TableCell className="text-center font-black text-amber-700">{Number(line.returned_quantity).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="text-center font-black text-emerald-700">{Number(line.returnable_quantity).toLocaleString("ar-EG")}</TableCell>
                        <TableCell>
                          <Input type="number" min="0" max={line.returnable_quantity} step="0.001" disabled={line.returnable_quantity <= 0}
                            value={quantities[line.id] ?? ""}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                            className="mx-auto h-10 w-28 rounded-xl text-center font-black" />
                        </TableCell>
                        <TableCell className="text-center font-black">{money(line.buy_price)}</TableCell>
                        <TableCell className="text-center font-black text-brand">{money(value)}</TableCell>
                      </TableRow>
                    })}</TableBody>
                  </Table>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                  <div className="space-y-3">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب المرتجع..." className="min-h-28 rounded-2xl" />
                  </div>
                  <div className="space-y-3 rounded-2xl bg-slate-950 p-4 text-white">
                    <div className="flex justify-between text-sm font-bold"><span>قيمة المرتجع</span><strong>{money(totalRefund)}</strong></div>
                    <div className="flex justify-between border-t border-white/15 pt-3 text-base font-black text-emerald-300"><span>المبلغ المسترد (تقديري)</span><strong>{money(totalRefund)}</strong></div>
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
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">سجل مرتجعات المشتريات</CardTitle></CardHeader>
          {loadingReturns ? <SkeletonRows count={4} /> : returns.length === 0 ? (
            <EmptyState icon={Package} title="لا توجد مرتجعات مشتريات" description="ستظهر هنا مرتجعات فواتير الشراء." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">رقم المرتجع</TableHead><TableHead className="text-right">المورد</TableHead><TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-center">القيمة</TableHead><TableHead className="text-center">المسترد</TableHead><TableHead className="text-center">نظام المخزون</TableHead><TableHead className="text-center">التاريخ</TableHead>
              </TableRow></TableHeader>
              <TableBody>{returns.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.return_number}</TableCell>
                  <TableCell className="font-black">{row.supplier_name}</TableCell>
                  <TableCell>{row.branch?.name ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{money(row.total)}</TableCell>
                  <TableCell className="text-center font-black text-rose-600">{money(row.refund_amount)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{row.stock_mode === "restock" ? "إعادة مخزون" : "استبعاد"}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((v) => v + 1)}>التالي</Button></div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
