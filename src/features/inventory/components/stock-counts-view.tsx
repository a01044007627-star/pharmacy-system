"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, ClipboardList, Loader2, Plus, RefreshCw, Search } from "lucide-react"
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

type StockCountRow = {
  id: string
  item_id: string
  branch_id: string
  expected_qty: number
  counted_qty: number
  variance: number
  unit: string | null
  notes: string | null
  status: string
  created_at: string
  item: { id: string; name_ar: string; sku: string | null; unit: string | null } | null
  branch: { id: string; name: string; code: string | null } | null
}

type ResponseData = {
  records?: StockCountRow[]
  summary?: { total_count: number; total_expected: number; total_counted: number; total_variance: number }
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

type ItemSearchRow = {
  id: string
  name_ar: string
  sku: string | null
  unit: string | null
  available_qty: number
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { matched: "مطابق", variance: "فروقات", approved: "معتمد", void: "ملغي" }
  return labels[status] ?? status
}

function statusColor(status: string) {
  if (status === "matched") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "approved") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "void") return "border-rose-200 bg-rose-50 text-rose-700"
  return "border-amber-200 bg-amber-50 text-amber-700"
}

function numberLabel(value: unknown) {
  return Number(value || 0).toLocaleString("ar-EG")
}

export function StockCountsView() {
  const auth = useAuth()
  const [rows, setRows] = useState<StockCountRow[]>([])
  const [summary, setSummary] = useState({ total_count: 0, total_expected: 0, total_counted: 0, total_variance: 0 })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [branchId, setBranchId] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [itemSearch, setItemSearch] = useState("")
  const [itemOptions, setItemOptions] = useState<ItemSearchRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState("")
  const [selectedItemName, setSelectedItemName] = useState("")
  const [selectedBranchId, setSelectedBranchId] = useState("")
  const [expectedQty, setExpectedQty] = useState("0")
  const [countedQty, setCountedQty] = useState("0")
  const [unit, setUnit] = useState("")
  const [notes, setNotes] = useState("")
  const loadControllerRef = useRef<AbortController | null>(null)

  const canWrite = auth.can("inventory:stocktake") || auth.isDeveloper
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
        branch_id: branchId,
        query: query.trim(),
        status: statusFilter,
        page: String(page),
        page_size: "25",
      })
      const data = await apiRequest<ResponseData>(`/api/inventory/stock-counts?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
        timeoutMs: 20000,
        retries: 1,
      })
      setRows(data.records ?? [])
      setSummary(data.summary ?? { total_count: 0, total_expected: 0, total_counted: 0, total_variance: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      if (!isRequestAbort(error)) toast.error(error instanceof Error ? error.message : "فشل تحميل الجرد")
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null
        setLoading(false)
      }
    }
  }, [auth.activePharmacyId, branchId, page, query, statusFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  useEffect(() => {
    if (!showAdd || !auth.activePharmacyId || !selectedBranchId || itemSearch.trim().length < 2 || selectedItemId) {
      setItemOptions([])
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setItemsLoading(true)
      try {
        const params = new URLSearchParams({
          pharmacy_id: auth.activePharmacyId ?? "",
          branch_id: selectedBranchId,
          query: itemSearch.trim(),
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
  }, [auth.activePharmacyId, itemSearch, selectedBranchId, selectedItemId, showAdd])

  const cards = useMemo(() => [
    { label: "عدد الجرد", value: summary.total_count.toLocaleString("ar-EG"), tone: "text-slate-950" },
    { label: "المتوقع", value: summary.total_expected.toLocaleString("ar-EG"), tone: "text-blue-700" },
    { label: "المعدود", value: summary.total_counted.toLocaleString("ar-EG"), tone: "text-emerald-700" },
    { label: "الفرق", value: summary.total_variance.toLocaleString("ar-EG"), tone: summary.total_variance !== 0 ? "text-rose-600" : "text-slate-500" },
  ], [summary])

  function resetForm() {
    setSelectedBranchId(auth.activeBranchId ?? "")
    setSelectedItemId("")
    setSelectedItemName("")
    setExpectedQty("0")
    setCountedQty("0")
    setUnit("")
    setNotes("")
    setItemSearch("")
    setItemOptions([])
  }

  function selectItem(item: ItemSearchRow) {
    setSelectedItemId(item.id)
    setSelectedItemName(item.name_ar)
    setItemSearch(item.name_ar)
    setExpectedQty(String(Number(item.available_qty ?? 0)))
    setCountedQty(String(Number(item.available_qty ?? 0)))
    setUnit(item.unit ?? "")
    setItemOptions([])
  }

  async function addRecord() {
    if (!selectedBranchId) { toast.error("اختر الفرع"); return }
    if (!selectedItemId) { toast.error("اختر صنفًا من نتائج البحث"); return }
    setSaving(true)
    try {
      await apiRequest<{ error?: string }>("/api/inventory/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId ?? "",
          branch_id: selectedBranchId,
          item_id: selectedItemId,
          expected_qty: Number(expectedQty) || 0,
          counted_qty: Number(countedQty) || 0,
          unit: unit.trim() || null,
          notes: notes.trim() || null,
        }),
        timeoutMs: 25000,
      })
      toast.success("تم تسجيل الجرد")
      setShowAdd(false)
      resetForm()
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الجرد")
    } finally { setSaving(false) }
  }

  async function approve(row: StockCountRow) {
    setApprovingId(row.id)
    try {
      await apiRequest<{ error?: string }>("/api/inventory/stock-counts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", count_id: row.id, pharmacy_id: auth.activePharmacyId }),
        timeoutMs: 25000,
      })
      toast.success("تم اعتماد الجرد وتسوية المخزون")
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل اعتماد الجرد")
    } finally { setApprovingId(null) }
  }

  return (
    <PageAccess permission="inventory:stocktake">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="جرد المخزون"
          subtitle="تسجيل الجرد ومقارنة الكمية الفعلية بالرصيد الحالي مع اعتماد التسوية بأمان."
          icon={ClipboardList}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? (
                <Button className="h-10 rounded-xl" onClick={() => { resetForm(); setShowAdd(true) }}>
                  <Plus className="size-4" /> جرد جديد
                </Button>
              ) : null}
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 lg:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="ابحث باسم الصنف / SKU / باركود..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1) }}>
              {canChooseAllBranches ? <NativeSelectOption value="all">كل الفروع</NativeSelectOption> : null}
              {auth.branches.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="matched">مطابق</NativeSelectOption>
              <NativeSelectOption value="variance">فروقات</NativeSelectOption>
              <NativeSelectOption value="approved">معتمد</NativeSelectOption>
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

        <Card className="relative overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading && rows.length > 0 ? <div className="absolute left-4 top-3 z-20 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/95 px-3 py-1 text-xs font-black text-blue-700 shadow"><Loader2 className="size-3 animate-spin" /> تحديث النتائج...</div> : null}
          {loading && rows.length === 0 ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title="لا توجد سجلات جرد" description="ابدأ بإجراء أول جرد للمخزون." />
          ) : (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الصنف</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">المتوقع</TableHead>
                  <TableHead className="text-center">المعدود</TableHead>
                  <TableHead className="text-center">الفرق</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">ملاحظات</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                  {canWrite ? <TableHead className="text-center">إجراء</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black">{row.item?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-bold">{row.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center font-black">{numberLabel(row.expected_qty)}</TableCell>
                    <TableCell className="text-center font-black text-emerald-700">{numberLabel(row.counted_qty)}</TableCell>
                    <TableCell className={cn("text-center font-black", Number(row.variance) !== 0 ? "text-rose-600" : "text-slate-500")}>
                      {numberLabel(row.variance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", statusColor(row.status))}>{statusLabel(row.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-500">{row.notes ?? "—"}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</TableCell>
                    {canWrite ? (
                      <TableCell className="text-center">
                        {row.status === "variance" || row.status === "matched" ? (
                          <Button size="sm" variant="outline" className="h-8 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50" disabled={approvingId === row.id} onClick={() => void approve(row)}>
                            {approvingId === row.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} اعتماد
                          </Button>
                        ) : <span className="text-xs font-black text-slate-400">—</span>}
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
          <DialogContent dir="rtl" className="w-[min(760px,calc(100vw-2rem))] max-w-none rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">تسجيل جرد</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="font-black">الفرع</Label>
                <NativeSelect value={selectedBranchId} onChange={(e) => { setSelectedBranchId(e.target.value); setSelectedItemId(""); setSelectedItemName(""); setItemSearch(""); setExpectedQty("0"); setCountedQty("0") }}>
                  <NativeSelectOption value="">اختر الفرع</NativeSelectOption>
                  {auth.branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="relative space-y-1.5">
                <Label className="font-black">الصنف</Label>
                <Input
                  value={itemSearch}
                  onChange={(e) => { setItemSearch(e.target.value); setSelectedItemId(""); setSelectedItemName("") }}
                  placeholder={selectedBranchId ? "ابحث عن الصنف بالاسم أو الباركود..." : "اختر الفرع أولًا"}
                  disabled={!selectedBranchId}
                  className="h-11 rounded-xl"
                />
                {selectedItemName ? <p className="text-xs font-black text-emerald-700">الصنف المختار: {selectedItemName}</p> : null}
                {(itemOptions.length > 0 || itemsLoading) && !selectedItemId ? (
                  <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                    {itemsLoading ? <div className="px-3 py-2 text-xs font-black text-slate-400">جاري البحث...</div> : null}
                    {itemOptions.map((item) => (
                      <button key={item.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-right hover:bg-slate-50" onClick={() => selectItem(item)}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-slate-900">{item.name_ar}</span>
                          <span className="block text-xs font-bold text-slate-400">{item.sku ?? "بدون SKU"} — رصيد حالي {numberLabel(item.available_qty)}</span>
                        </span>
                        <Badge variant="outline" className="shrink-0 font-black">اختيار</Badge>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="font-black">الكمية المتوقعة</Label><Input type="number" min="0" value={expectedQty} onChange={(e) => setExpectedQty(e.target.value)} className="h-11 rounded-xl text-center font-black" /></div>
                <div className="space-y-1.5"><Label className="font-black">الكمية المعدودة</Label><Input type="number" min="0" value={countedQty} onChange={(e) => setCountedQty(e.target.value)} className="h-11 rounded-xl text-center font-black" /></div>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                <div className="space-y-1.5"><Label className="font-black">الفرق</Label><Input value={String((Number(countedQty) || 0) - (Number(expectedQty) || 0))} readOnly className="h-11 rounded-xl bg-slate-50 text-center font-black" /></div>
                <div className="space-y-1.5"><Label className="font-black">الوحدة</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="مثال: كرتونة، شريط..." className="h-11 rounded-xl" /></div>
              </div>
              <div className="space-y-1.5"><Label className="font-black">ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري..." className="min-h-20 rounded-xl" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setShowAdd(false)}>إلغاء</Button>
              <Button className="rounded-xl" disabled={saving || !selectedItemId || !selectedBranchId} onClick={() => void addRecord()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} تسجيل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
