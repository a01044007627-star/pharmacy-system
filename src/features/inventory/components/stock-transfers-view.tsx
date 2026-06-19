"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CheckCircle2, Loader2, Plus, RefreshCw, Search, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { apiRequest, isRequestAbort } from "@/lib/api-client"

type TransferLine = { item_id: string; item_name?: string | null; sku?: string | null; quantity: number; unit?: string | null }

type TransferRow = {
  id: string
  transfer_number: string
  from_branch_id: string
  to_branch_id: string
  lines: TransferLine[]
  total_items: number
  status: string
  notes: string | null
  created_at: string
  from_branch: { id: string; name: string; code: string | null } | null
  to_branch: { id: string; name: string; code: string | null } | null
}

type ResponseData = {
  records?: TransferRow[]
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

type ItemSearchRow = {
  id: string
  name_ar: string
  sku: string | null
  unit: string | null
  available_qty: number
  buy_price: number
  sell_price: number
}

type TransferFormLine = {
  item_id: string
  item_name: string
  sku: string
  unit: string
  available_qty: number
  quantity: string
  search: string
}

function statusLabel(status: string) {
  const map: Record<string, string> = { draft: "مسودة", pending: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي", void: "باطل" }
  return map[status] ?? status
}

function statusColor(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "cancelled" || status === "void") return "border-rose-200 bg-rose-50 text-rose-700"
  if (status === "draft") return "border-blue-200 bg-blue-50 text-blue-700"
  return "border-amber-200 bg-amber-50 text-amber-700"
}

const emptyLine = (): TransferFormLine => ({ item_id: "", item_name: "", sku: "", unit: "", available_qty: 0, quantity: "1", search: "" })

function numberLabel(value: number) {
  return Number(value || 0).toLocaleString("ar-EG")
}

export function StockTransfersView() {
  const auth = useAuth()
  const [rows, setRows] = useState<TransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [branchFilter, setBranchFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [fromBranchId, setFromBranchId] = useState("")
  const [toBranchId, setToBranchId] = useState("")
  const [transferLines, setTransferLines] = useState<TransferFormLine[]>([emptyLine()])
  const [transferNotes, setTransferNotes] = useState("")
  const [autoComplete, setAutoComplete] = useState(true)
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null)
  const [itemOptions, setItemOptions] = useState<ItemSearchRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const loadControllerRef = useRef<AbortController | null>(null)

  const canWrite = auth.can("inventory:transfer.write") || auth.isDeveloper
  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        page: String(page),
        page_size: "25",
        query: search.trim(),
        status: statusFilter,
        branch_id: branchFilter,
      })
      const data = await apiRequest<ResponseData>(`/api/inventory/stock-transfers?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
        timeoutMs: 20000,
        retries: 1,
      })
      setRows(data.records ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      if (!isRequestAbort(error)) toast.error(error instanceof Error ? error.message : "فشل تحميل التحويلات")
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null
        setLoading(false)
      }
    }
  }, [auth.activePharmacyId, branchFilter, page, search, statusFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  useEffect(() => {
    if (!showAdd || activeLineIndex === null || !auth.activePharmacyId || !fromBranchId) {
      setItemOptions([])
      return
    }
    const term = transferLines[activeLineIndex]?.search.trim() ?? ""
    if (term.length < 2) {
      setItemOptions([])
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setItemsLoading(true)
      try {
        const params = new URLSearchParams({
          pharmacy_id: auth.activePharmacyId ?? "",
          branch_id: fromBranchId,
          query: term,
          limit: "12",
        })
        const data = await apiRequest<{ records?: ItemSearchRow[]; error?: string }>(`/api/inventory/items/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
          timeoutMs: 15000,
          retries: 1,
        })
        setItemOptions(data.records ?? [])
      } catch (error) {
        if (!isRequestAbort(error)) {
          toast.error(error instanceof Error ? error.message : "فشل البحث عن الأصناف")
        }
      } finally {
        setItemsLoading(false)
      }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [activeLineIndex, auth.activePharmacyId, fromBranchId, showAdd, transferLines])

  const cards = useMemo(() => {
    const completed = rows.filter((row) => row.status === "completed").length
    const pending = rows.filter((row) => ["draft", "pending"].includes(row.status)).length
    const totalQty = rows.reduce((sum, row) => sum + Number(row.total_items ?? 0), 0)
    return [
      { label: "التحويلات المعروضة", value: rows.length.toLocaleString("ar-EG"), tone: "text-slate-950" },
      { label: "مكتملة", value: completed.toLocaleString("ar-EG"), tone: "text-emerald-700" },
      { label: "معلقة", value: pending.toLocaleString("ar-EG"), tone: "text-amber-700" },
      { label: "إجمالي الكميات", value: totalQty.toLocaleString("ar-EG"), tone: "text-blue-700" },
    ]
  }, [rows])

  function addLine() {
    setTransferLines((prev) => [...prev, emptyLine()])
  }

  function removeLine(index: number) {
    setTransferLines((prev) => prev.filter((_, i) => i !== index))
    setActiveLineIndex(null)
  }

  function updateLine(index: number, field: keyof TransferFormLine, value: string | number) {
    setTransferLines((prev) => {
      const next = [...prev]
      const current = next[index] ?? emptyLine()
      next[index] = {
        ...current,
        [field]: value,
        ...(field === "search" ? { item_id: "", item_name: "", sku: "", unit: "", available_qty: 0 } : {}),
      } as TransferFormLine
      return next
    })
  }

  function selectItem(index: number, item: ItemSearchRow) {
    setTransferLines((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        item_id: item.id,
        item_name: item.name_ar,
        sku: item.sku ?? "",
        unit: item.unit ?? "",
        available_qty: Number(item.available_qty ?? 0),
        search: item.name_ar,
      }
      return next
    })
    setItemOptions([])
    setActiveLineIndex(null)
  }

  function resetForm() {
    setFromBranchId(auth.activeBranchId ?? "")
    setToBranchId("")
    setTransferLines([emptyLine()])
    setTransferNotes("")
    setAutoComplete(true)
    setActiveLineIndex(null)
    setItemOptions([])
  }

  async function addTransfer() {
    if (!fromBranchId) { toast.error("اختر فرع المصدر"); return }
    if (!toBranchId) { toast.error("اختر فرع الوجهة"); return }
    if (fromBranchId === toBranchId) { toast.error("فرع المصدر والوجهة متطابقان"); return }
    const validLines = transferLines.filter((line) => line.item_id && Number(line.quantity) > 0)
    if (validLines.length === 0) { toast.error("اختر الأصناف من نتائج البحث وأدخل كمية صحيحة"); return }
    const overQty = validLines.find((line) => Number(line.quantity) > Number(line.available_qty))
    if (overQty && autoComplete) {
      toast.error(`الكمية المطلوبة من ${overQty.item_name} أكبر من المتاح في فرع المصدر`)
      return
    }

    setSaving(true)
    try {
      await apiRequest<{ error?: string }>("/api/inventory/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId ?? "",
          from_branch_id: fromBranchId,
          to_branch_id: toBranchId,
          auto_complete: autoComplete,
          lines: validLines.map((line) => ({ item_id: line.item_id, item_name: line.item_name, quantity: Number(line.quantity), unit: line.unit || null })),
          notes: transferNotes.trim() || null,
        }),
        timeoutMs: 25000,
      })
      toast.success(autoComplete ? "تم إنشاء وتنفيذ التحويل بنجاح" : "تم إنشاء التحويل كمسودة")
      setShowAdd(false)
      resetForm()
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إنشاء التحويل")
    } finally { setSaving(false) }
  }

  async function runAction(row: TransferRow, action: "complete" | "cancel") {
    setActingId(row.id)
    try {
      await apiRequest<{ error?: string }>("/api/inventory/stock-transfers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, transfer_id: row.id, pharmacy_id: auth.activePharmacyId }),
        timeoutMs: 25000,
      })
      toast.success(action === "complete" ? "تم تنفيذ التحويل" : "تم إلغاء التحويل")
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تعديل التحويل")
    } finally { setActingId(null) }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="التحويل المخزني"
          subtitle="نقل الأصناف بين الفروع مع خصم وإضافة المخزون بحركة Atomic آمنة."
          icon={ArrowLeft}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? (
                <Button
                  className="h-10 rounded-xl"
                  disabled={auth.branches.length < 2}
                  onClick={() => {
                    if (auth.branches.length < 2) { toast.error("أضف فرعين على الأقل لإجراء تحويل مخزني"); return }
                    resetForm()
                    setShowAdd(true)
                  }}
                >
                  <Plus className="size-4" /> تحويل جديد
                </Button>
              ) : null}
            </>
          )}
        />

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

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="رقم التحويل أو ملاحظات..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="draft">مسودة</NativeSelectOption>
              <NativeSelectOption value="pending">قيد التنفيذ</NativeSelectOption>
              <NativeSelectOption value="completed">مكتمل</NativeSelectOption>
              <NativeSelectOption value="cancelled">ملغي</NativeSelectOption>
            </NativeSelect>
            <NativeSelect value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1) }}>
              {canChooseAllBranches ? <NativeSelectOption value="all">كل الفروع</NativeSelectOption> : null}
              {auth.branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading && rows.length > 0 ? <div className="absolute left-4 top-3 z-20 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/95 px-3 py-1 text-xs font-black text-blue-700 shadow"><Loader2 className="size-3 animate-spin" /> تحديث النتائج...</div> : null}
          {loading && rows.length === 0 ? <SkeletonRows count={5} /> : rows.length === 0 ? (
            <EmptyState icon={ArrowLeft} title="لا توجد تحويلات" description="ابدأ أول تحويل بين الفروع من زر تحويل جديد." />
          ) : (
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم التحويل</TableHead>
                  <TableHead className="text-right">من فرع</TableHead>
                  <TableHead className="text-right">إلى فرع</TableHead>
                  <TableHead className="text-right">الأصناف</TableHead>
                  <TableHead className="text-center">إجمالي الكميات</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                  {canWrite ? <TableHead className="text-center">إجراء</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black text-brand">{row.transfer_number}</TableCell>
                    <TableCell className="font-bold">{row.from_branch?.name ?? "—"}</TableCell>
                    <TableCell className="font-bold">{row.to_branch?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-[320px]">
                      <div className="space-y-1">
                        {(row.lines ?? []).slice(0, 3).map((line) => (
                          <div key={`${row.id}-${line.item_id}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                            <span className="truncate">{line.item_name ?? line.item_id}</span>
                            <span className="shrink-0 text-slate-950">{numberLabel(line.quantity)} {line.unit ?? ""}</span>
                          </div>
                        ))}
                        {(row.lines ?? []).length > 3 ? <span className="text-xs font-black text-slate-400">+ {(row.lines.length - 3).toLocaleString("ar-EG")} أصناف أخرى</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-black">{Number(row.total_items).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", statusColor(row.status))}>{statusLabel(row.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</TableCell>
                    {canWrite ? (
                      <TableCell className="text-center">
                        <div className="flex justify-center gap-2">
                          {["draft", "pending"].includes(row.status) ? (
                            <Button size="sm" variant="outline" className="h-8 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50" disabled={actingId === row.id} onClick={() => void runAction(row, "complete")}>
                              {actingId === row.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} تنفيذ
                            </Button>
                          ) : null}
                          {!["completed", "cancelled", "void"].includes(row.status) ? (
                            <Button size="sm" variant="ghost" className="h-8 rounded-xl text-rose-600 hover:bg-rose-50" disabled={actingId === row.id} onClick={() => void runAction(row, "cancel")}>
                              <XCircle className="size-3" /> إلغاء
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
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

        <Dialog open={showAdd} onOpenChange={(open) => { if (!open) setShowAdd(false) }}>
          <DialogContent dir="rtl" className="w-[min(980px,calc(100vw-1rem))] max-w-none max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl p-3 text-right sm:p-5">
            <DialogHeader><DialogTitle className="text-lg font-black">تحويل مخزني جديد</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="font-black">من فرع</Label>
                  <NativeSelect value={fromBranchId} onChange={(e) => { setFromBranchId(e.target.value); setTransferLines([emptyLine()]) }}>
                    <NativeSelectOption value="">اختر الفرع</NativeSelectOption>
                    {auth.branches.filter((branch) => branch.id !== toBranchId).map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-black">إلى فرع</Label>
                  <NativeSelect value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
                    <NativeSelectOption value="">اختر الفرع</NativeSelectOption>
                    {auth.branches.filter((branch) => branch.id !== fromBranchId).map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-black">طريقة التنفيذ</Label>
                  <NativeSelect value={autoComplete ? "1" : "0"} onChange={(e) => setAutoComplete(e.target.value === "1")}>
                    <NativeSelectOption value="1">إنشاء وتنفيذ فورًا</NativeSelectOption>
                    <NativeSelectOption value="0">حفظ كمسودة فقط</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="font-black">الأصناف</Label>
                  <Button variant="outline" size="sm" className="rounded-xl" disabled={!fromBranchId} onClick={addLine}>+ إضافة صنف</Button>
                </div>
                <div className="space-y-3">
                  {transferLines.map((line, index) => (
                    <div key={index} className="grid gap-2 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_130px_110px_44px]">
                      <div className="relative space-y-1">
                        <Label className="text-xs font-black">الصنف</Label>
                        <Input
                          value={line.search}
                          onFocus={() => setActiveLineIndex(index)}
                          onChange={(event) => { setActiveLineIndex(index); updateLine(index, "search", event.target.value) }}
                          placeholder={fromBranchId ? "ابحث بالاسم / SKU / الباركود..." : "اختر فرع المصدر أولًا"}
                          disabled={!fromBranchId}
                          className="h-10 rounded-xl font-bold"
                        />
                        {line.item_id ? (
                          <div className="flex flex-wrap gap-2 text-[11px] font-black text-slate-500">
                            <span>SKU: {line.sku || "—"}</span>
                            <span>المتاح: {numberLabel(line.available_qty)}</span>
                            <span>الوحدة: {line.unit || "—"}</span>
                          </div>
                        ) : null}
                        {activeLineIndex === index && (itemOptions.length > 0 || itemsLoading) ? (
                          <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                            {itemsLoading ? <div className="px-3 py-2 text-xs font-black text-slate-400">جاري البحث...</div> : null}
                            {itemOptions.map((item) => (
                              <button key={item.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-right hover:bg-slate-50" onClick={() => selectItem(index, item)}>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-black text-slate-900">{item.name_ar}</span>
                                  <span className="block text-xs font-bold text-slate-400">{item.sku ?? "بدون SKU"} — متاح {numberLabel(item.available_qty)}</span>
                                </span>
                                <Badge variant="outline" className="shrink-0 font-black">اختيار</Badge>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-black">الكمية</Label>
                        <Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="h-10 rounded-xl text-center font-black" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-black">الوحدة</Label>
                        <Input value={line.unit} onChange={(event) => updateLine(index, "unit", event.target.value)} className="h-10 rounded-xl text-center font-bold" placeholder="تلقائي" />
                      </div>
                      <div className="flex items-end justify-center">
                        {transferLines.length > 1 ? (
                          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-rose-500" onClick={() => removeLine(index)}>×</Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5"><Label className="font-black">ملاحظات</Label><Textarea value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} placeholder="اختياري..." className="min-h-20 rounded-xl" /></div>
            </div>
            <DialogFooter className="sticky bottom-0 -mx-3 -mb-3 border-t border-slate-100 bg-white/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5">
              <Button variant="outline" className="rounded-xl" onClick={() => setShowAdd(false)}>إلغاء</Button>
              <Button className="rounded-xl" disabled={saving || !fromBranchId || !toBranchId || fromBranchId === toBranchId || !transferLines.some((line) => line.item_id && Number(line.quantity) > 0)} onClick={() => void addTransfer()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} {autoComplete ? "إنشاء وتنفيذ" : "حفظ مسودة"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
