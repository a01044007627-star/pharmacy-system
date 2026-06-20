"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, Save, Search, Tag } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { money } from "@/features/inventory/lib/items-helpers"

export function PriceUpdateView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [items, setItems] = useState<PharmacyItemListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [newPrice, setNewPrice] = useState("")
  const [keepOld, setKeepOld] = useState(true)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/items?pharmacy_id=${auth.activePharmacyId}&branch_id=${auth.activeBranchId ?? "all"}`, { cache: "no-store" })
      const data = await res.json() as { items?: PharmacyItemListRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل التحميل")
      setItems(data.items ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل التحميل")
    } finally { setLoading(false) }
  }, [auth.activeBranchId, auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.name_ar} ${item.name_en ?? ""} ${item.sku ?? ""}`.toLowerCase().includes(q))
  }, [items, search])

  const toggleAll = (checked: boolean) => {
    setSelected(new Set(checked ? filtered.map((item) => item.id) : []))
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function updatePrices() {
    const price = Number(newPrice)
    if (!price || price <= 0) { toast.error("أدخل سعر بيع صحيح"); return }
    if (selected.size === 0) { toast.error("اختر صنفاً واحداً على الأقل"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/items/price-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: Array.from(selected), new_sell_price: price, keep_old_price: keepOld, pharmacy_id: auth.activePharmacyId }),
      })
      const data = await res.json() as { error?: string; updated?: number }
      if (!res.ok) throw new Error(data.error ?? "فشل التحديث")
      toast.success(`تم تحديث ${data.updated ?? 0} صنف`)
      setSelected(new Set()); setNewPrice(""); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث الأسعار")
    } finally { setSaving(false) }
  }

  const formatMoney = (v: unknown) => `${money(v)} ${currency}`

  return (
    <PageAccess permission="inventory:update">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-black"><Tag className="size-5 text-brand" /> تحديث أسعار البيع</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="number" min="0" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="سعر البيع الجديد" className="h-10 w-44 rounded-xl" />
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"><Checkbox checked={keepOld} onCheckedChange={(c) => setKeepOld(Boolean(c))} /> حفظ السعر القديم</label>
                <Button className="h-10 rounded-xl font-black" disabled={saving || !selected.size || !newPrice} onClick={() => void updatePrices()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  تطبيق على {selected.size.toLocaleString("ar-EG")} صنف
                </Button>
                <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم الصنف أو SKU..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table className="min-w-[700px]">
                <TableHeader><TableRow>
                  <TableHead className="w-12 text-center"><Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={(c) => toggleAll(Boolean(c))} /></TableHead>
                  <TableHead className="text-right">الصنف</TableHead><TableHead className="text-center">السعر الحالي</TableHead><TableHead className="text-center">السعر القديم</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={4} className="h-32 text-center"><Loader2 className="mx-auto size-6 animate-spin text-brand" /></TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="h-32 text-center font-bold text-slate-500">لا توجد أصناف مطابقة</TableCell></TableRow>
                  ) : filtered.map((item) => (
                    <TableRow key={item.id} className={cn(selected.has(item.id) && "bg-brand/5")}>
                      <TableCell className="text-center"><Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} /></TableCell>
                      <TableCell className="font-black">{item.name_ar}{item.sku ? <span className="mr-2 text-xs font-bold text-slate-400">({item.sku})</span> : null}</TableCell>
                      <TableCell className="text-center font-black text-brand">{formatMoney(item.sell_price)}</TableCell>
                      <TableCell className="text-center font-bold text-slate-500">{formatMoney(item.old_sell_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </PageAccess>
  )
}
