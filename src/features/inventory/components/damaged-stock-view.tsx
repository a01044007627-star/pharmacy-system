"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Plus, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SkeletonRows } from "@/components/shared/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"

type DamagedRecord = {
  id: string; item_id: string; branch_id: string; quantity: number; reason: string
  notes: string | null; created_at: string
  item: { id: string; name_ar: string; sku: string | null; unit: string | null } | null
  branch: { id: string; name: string; code: string | null } | null
}

export function DamagedStockView() {
  const auth = useAuth()
  const canWrite = auth.can("inventory:create") || auth.isDeveloper
  const [records, setRecords] = useState<DamagedRecord[]>([])
  const [items, setItems] = useState<PharmacyItemListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [itemSearch, setItemSearch] = useState("")
  const [selectedItemId, setSelectedItemId] = useState("")
  const [selectedItemName, setSelectedItemName] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [reason, setReason] = useState("تالف")
  const [notes, setNotes] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [recRes, itemRes] = await Promise.all([
        fetch("/api/inventory/damaged", { cache: "no-store" }),
        fetch(`/api/items?pharmacy_id=${auth.activePharmacyId}&branch_id=${auth.activeBranchId ?? "all"}`, { cache: "no-store" }),
      ])
      const [recData, itemData] = await Promise.all([recRes.json(), itemRes.json()]) as [Record<string, unknown>, Record<string, unknown>]
      if (recRes.ok) setRecords((recData.records ?? []) as DamagedRecord[])
      if (itemRes.ok) setItems((itemData.items ?? []) as PharmacyItemListRow[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل التحميل")
    } finally { setLoading(false) }
  }, [auth.activeBranchId, auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return []
    return items.filter((item) => `${item.name_ar} ${item.sku ?? ""}`.toLowerCase().includes(q)).slice(0, 10)
  }, [items, itemSearch])

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records
    return records.filter((r) => (r.item?.name_ar ?? "").toLowerCase().includes(q) || (r.reason ?? "").toLowerCase().includes(q))
  }, [records, search])

  function selectItem(item: PharmacyItemListRow) {
    setSelectedItemId(item.id); setSelectedItemName(item.name_ar); setItemSearch("")
  }

  async function addRecord() {
    if (!selectedItemId) { toast.error("اختر صنفاً"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/inventory/damaged", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          item_id: selectedItemId,
          quantity: Math.max(1, Number(quantity) || 1),
          reason: reason.trim() || "تالف",
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل التسجيل")
      toast.success("تم تسجيل التالف")
      setShowAdd(false); resetForm(); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل التسجيل")
    } finally { setSaving(false) }
  }

  function resetForm() {
    setSelectedItemId(""); setSelectedItemName(""); setQuantity("1"); setReason("تالف"); setNotes(""); setItemSearch("")
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-black"><AlertTriangle className="size-5 text-amber-600" /> التوالف</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              {canWrite ? <Button className="h-9 rounded-xl" onClick={() => { resetForm(); setShowAdd(true) }}><Plus className="size-4" /> تسجيل تالف</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم الصنف..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            {loading ? <SkeletonRows count={4} /> : filteredRecords.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500">لا توجد سجلات توالف.</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table className="min-w-[700px]">
                  <TableHeader><TableRow>
                    <TableHead className="text-right">الصنف</TableHead><TableHead className="text-center">الفرع</TableHead><TableHead className="text-center">الكمية</TableHead><TableHead className="text-center">السبب</TableHead><TableHead className="text-center">ملاحظات</TableHead><TableHead className="text-center">التاريخ</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{filteredRecords.map((rec) => (
                    <TableRow key={rec.id}>
                      <TableCell className="font-black">{rec.item?.name_ar ?? "—"}</TableCell>
                      <TableCell className="text-center font-bold">{rec.branch?.name ?? "—"}</TableCell>
                      <TableCell className="text-center font-black text-rose-600">{Number(rec.quantity).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="text-center"><Badge variant="outline" className="bg-amber-50 text-amber-700 font-black">{rec.reason}</Badge></TableCell>
                      <TableCell className="text-center text-sm text-slate-500">{rec.notes ?? "—"}</TableCell>
                      <TableCell className="text-center text-xs font-bold">{new Date(rec.created_at).toLocaleString("ar-EG")}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={showAdd} onOpenChange={(open) => !open && setShowAdd(false)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">تسجيل تالف</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="font-black">الصنف</Label>
                <div className="relative">
                  <Input value={selectedItemName || itemSearch} onChange={(e) => { setItemSearch(e.target.value); if (!e.target.value) { setSelectedItemId(""); setSelectedItemName("") } }} placeholder="ابحث عن الصنف..." className="h-11 rounded-xl" />
                  {itemSearch.trim() && !selectedItemId && filteredItems.length > 0 ? (
                    <div className="absolute inset-x-0 top-12 z-20 max-h-48 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
                      {filteredItems.map((item) => (
                        <button key={item.id} type="button" onClick={() => selectItem(item)} className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-right last:border-0 hover:bg-slate-50">
                          <span><strong>{item.name_ar}</strong>{item.sku ? <small className="mr-2 text-slate-400">{item.sku}</small> : null}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5"><Label className="font-black">الكمية</Label><Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">السبب</Label><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)} className="h-11"><NativeSelectOption value="تالف">تالف</NativeSelectOption><NativeSelectOption value="منتهي الصلاحية">منتهي الصلاحية</NativeSelectOption><NativeSelectOption value="كسر">كسر</NativeSelectOption><NativeSelectOption value="فقدان">فقدان</NativeSelectOption><NativeSelectOption value="أخرى">أخرى</NativeSelectOption></NativeSelect></div>
              <div className="space-y-1.5"><Label className="font-black">ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري..." className="min-h-20 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setShowAdd(false)}>إلغاء</Button><Button className="rounded-xl" disabled={saving || !selectedItemId} onClick={() => void addRecord()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} تسجيل</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
