"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Package, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type SearchItem = { id: string; name_ar: string; sku?: string | null; barcode?: string | null; available_qty?: number; unit?: string | null }
type Alternative = {
  id: string
  item_id: string
  alternative_item_id: string
  reason: string | null
  created_at: string
  item?: { id: string; name_ar: string; sku?: string | null } | null
  alternative?: { id: string; name_ar: string; sku?: string | null } | null
}

function itemName(item?: SearchItem | null) {
  if (!item) return ""
  return `${item.name_ar}${item.sku ? ` - ${item.sku}` : ""}`
}

export function ItemAlternativesView() {
  const auth = useAuth()
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<Alternative[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sourceSearch, setSourceSearch] = useState("")
  const [alternativeSearch, setAlternativeSearch] = useState("")
  const [sourceResults, setSourceResults] = useState<SearchItem[]>([])
  const [alternativeResults, setAlternativeResults] = useState<SearchItem[]>([])
  const [sourceItem, setSourceItem] = useState<SearchItem | null>(null)
  const [alternativeItem, setAlternativeItem] = useState<SearchItem | null>(null)
  const [reason, setReason] = useState("")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query })
      const response = await fetch(`/api/items/alternatives?${params}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { alternatives?: Alternative[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل البدائل")
      setRows(data.alternatives ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل البدائل")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, query])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const searchItems = useCallback(async (needle: string, target: "source" | "alternative") => {
    if (!auth.activePharmacyId || needle.trim().length < 2) {
      target === "source" ? setSourceResults([]) : setAlternativeResults([])
      return
    }
    const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query: needle, limit: "12", include_inactive: "0" })
    const response = await fetch(`/api/inventory/items/search?${params}`, { cache: "no-store" })
    const data = await response.json().catch(() => ({})) as { records?: SearchItem[] }
    const list = data.records ?? []
    target === "source" ? setSourceResults(list) : setAlternativeResults(list.filter((item) => item.id !== sourceItem?.id))
  }, [auth.activePharmacyId, sourceItem?.id])

  useEffect(() => {
    const timeout = window.setTimeout(() => void searchItems(sourceSearch, "source"), 250)
    return () => window.clearTimeout(timeout)
  }, [sourceSearch, searchItems])

  useEffect(() => {
    const timeout = window.setTimeout(() => void searchItems(alternativeSearch, "alternative"), 250)
    return () => window.clearTimeout(timeout)
  }, [alternativeSearch, searchItems])

  const canWrite = auth.isDeveloper || auth.can("inventory:update")
  const sameSelected = sourceItem?.id && sourceItem.id === alternativeItem?.id
  const alreadyExists = useMemo(() => rows.some((row) => row.item_id === sourceItem?.id && row.alternative_item_id === alternativeItem?.id), [alternativeItem?.id, rows, sourceItem?.id])

  async function save() {
    if (!sourceItem || !alternativeItem || !auth.activePharmacyId) return
    if (sameSelected) { toast.error("لا يمكن اختيار نفس الصنف كبديل"); return }
    if (alreadyExists) { toast.error("البديل مسجل بالفعل"); return }
    setSaving(true)
    try {
      const response = await fetch("/api/items/alternatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, item_id: sourceItem.id, alternative_item_id: alternativeItem.id, reason }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ البديل")
      toast.success("تم حفظ بديل الصنف")
      setSourceItem(null); setAlternativeItem(null); setSourceSearch(""); setAlternativeSearch(""); setReason("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ البديل")
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!auth.activePharmacyId) return
    try {
      const params = new URLSearchParams({ id, pharmacy_id: auth.activePharmacyId })
      const response = await fetch(`/api/items/alternatives?${params}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حذف البديل")
      setRows((prev) => prev.filter((row) => row.id !== id))
      toast.success("تم حذف البديل")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف البديل")
    }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="بدائل الأصناف" subtitle="اربط الصنف ببدائل سريعة تظهر للموظف عند نقص المخزون." icon={Package} actions={<Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>} />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">إضافة بديل</CardTitle></CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <ItemSearchBox label="الصنف الأصلي" value={sourceSearch} selected={sourceItem} results={sourceResults} onSearch={(value) => { setSourceSearch(value); setSourceItem(null) }} onSelect={(item) => { setSourceItem(item); setSourceSearch(itemName(item)); setSourceResults([]) }} />
              <ItemSearchBox label="الصنف البديل" value={alternativeSearch} selected={alternativeItem} results={alternativeResults} onSearch={(value) => { setAlternativeSearch(value); setAlternativeItem(null) }} onSelect={(item) => { setAlternativeItem(item); setAlternativeSearch(itemName(item)); setAlternativeResults([]) }} />
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-1.5"><Label className="font-black">سبب البديل</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 rounded-xl" placeholder="مثال: نفس المادة الفعالة أو نفس الاستخدام" /></div>
              <Button className="self-end rounded-xl px-8" disabled={!canWrite || saving || !sourceItem || !alternativeItem || Boolean(sameSelected) || alreadyExists} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} حفظ البديل</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-lg font-black text-slate-950">قائمة البدائل</h2><p className="text-xs font-bold text-slate-500">{rows.length.toLocaleString("ar-EG")} بديل مسجل</p></div>
            <div className="relative max-w-sm flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 rounded-2xl pr-10 font-bold" placeholder="بحث في البدائل" /></div>
          </CardContent>
          <CardContent className="p-4">
            {loading ? <SkeletonRows count={5} /> : rows.length === 0 ? <EmptyState icon={Package} title="لا توجد بدائل" description="ابدأ بربط أول صنف ببديله." /> : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950">{row.item?.name_ar ?? "صنف"}</p>
                        <p className="mt-2 truncate text-sm font-black text-brand">↳ {row.alternative?.name_ar ?? "بديل"}</p>
                        {row.reason ? <p className="mt-2 text-xs font-bold text-slate-500">{row.reason}</p> : null}
                      </div>
                      <Button size="icon" variant="ghost" className="text-rose-600" disabled={!canWrite} onClick={() => void remove(row.id)}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </PageAccess>
  )
}

function ItemSearchBox({ label, value, selected, results, onSearch, onSelect }: { label: string; value: string; selected: SearchItem | null; results: SearchItem[]; onSearch: (value: string) => void; onSelect: (item: SearchItem) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="font-black">{label}</Label>
      <div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={value} onChange={(event) => onSearch(event.target.value)} className="h-11 rounded-2xl pr-10 font-bold" placeholder="ابحث بالاسم أو SKU أو الباركود" /></div>
      {selected ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">تم اختيار: {selected.name_ar}</p> : null}
      {results.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-lg">
          {results.map((item) => (
            <button key={item.id} type="button" className="block w-full rounded-xl px-3 py-2 text-right hover:bg-slate-50" onClick={() => onSelect(item)}>
              <span className="block text-sm font-black text-slate-900">{item.name_ar}</span>
              <span className="text-xs font-bold text-slate-400">{item.sku ?? item.barcode ?? "بدون كود"} · {Number(item.available_qty ?? 0).toLocaleString("ar-EG")} {item.unit ?? ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
