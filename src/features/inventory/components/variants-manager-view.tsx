"use client"

import * as React from "react"
import { Loader2, Package, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"

type VariantRow = {
  id?: string
  name: string
  value: string
  sku: string
  sell_price: string
  purchase_price: string
  barcode: string
}

type ItemLookup = { id: string; name_ar: string; name_en?: string | null; sku?: string | null }

export function VariantsManagerView() {
  const auth = useAuth()
  const [items, setItems] = React.useState<ItemLookup[]>([])
  const [selectedItemId, setSelectedItemId] = React.useState("")
  const [variants, setVariants] = React.useState<VariantRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const filteredItems = React.useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.name_ar.toLowerCase().includes(q) || i.name_en?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q))
  }, [items, search])

  React.useEffect(() => {
    if (!auth.activePharmacyId) return
    async function load() {
      try {
        const res = await fetch("/api/items?mode=active&page_size=1000&pharmacy_id=" + auth.activePharmacyId, { cache: "no-store" })
        const data = await res.json()
        if (res.ok) setItems((data.items ?? []).map((i: Record<string, unknown>) => ({ id: i.id as string, name_ar: i.name_ar as string, name_en: i.name_en as string | null, sku: i.sku as string | null })))
      } catch { /* ignore */ }
    }
    void load()
  }, [auth.activePharmacyId])

  React.useEffect(() => {
    if (!selectedItemId) { setVariants([]); return }
    setLoading(true)
    async function load() {
      try {
        const res = await fetch("/api/items/variants?item_id=" + selectedItemId, { cache: "no-store" })
        const data = await res.json()
        if (res.ok) {
          setVariants((data.variants ?? []).map((v: Record<string, unknown>) => ({
            id: v.id as string,
            name: v.name as string || "",
            value: v.value as string || "",
            sku: v.sku as string || "",
            sell_price: String(v.sell_price ?? ""),
            purchase_price: String(v.purchase_price ?? ""),
            barcode: v.barcode as string || "",
          })))
        }
      } catch { toast.error("فشل تحميل المتغيرات") }
      finally { setLoading(false) }
    }
    void load()
  }, [selectedItemId])

  const selectedItem = items.find((i) => i.id === selectedItemId)

  function addRow() {
    setVariants((prev) => [...prev, { name: "", value: "", sku: "", sell_price: "", purchase_price: "", barcode: "" }])
  }

  function removeRow(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof VariantRow, value: string) {
    setVariants((prev) => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  async function save() {
    if (!selectedItemId) { toast.error("اختر صنفاً أولاً"); return }
    const valid = variants.filter((v) => v.value.trim())
    if (valid.length === 0) { toast.error("أضف متغيراً واحداً على الأقل بقيمة"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/items/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: selectedItemId,
          pharmacy_id: auth.activePharmacyId,
          variants: valid.map((v) => ({
            name: v.name || "variation",
            value: v.value,
            sku: v.sku || null,
            sell_price: Number(v.sell_price) || null,
            purchase_price: Number(v.purchase_price) || 0,
            barcode: v.barcode || null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(`تم حفظ ${data.count} متغير`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  return (
    <PageAccess permission="inventory:update">
      <section dir="rtl" className="page-container space-y-5 py-4 text-right sm:py-6">
        <DashboardPageHeader title="إدارة متغيرات الأصناف" subtitle="أضف، عدل، واحذف المتغيرات (مقاس، لون، نكهة) لكل صنف" icon={Package} />

        <Card className="rounded-2xl border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <Label className="mb-2 block font-black text-slate-700">اختر الصنف</Label>
          <div className="relative">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم الصنف..." className="mb-2 h-11 rounded-xl" />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              {filteredItems.length === 0 ? (
                <div className="p-3 text-sm font-bold text-slate-400">لا توجد نتائج</div>
              ) : filteredItems.slice(0, 50).map((item) => (
                <button key={item.id} type="button" onClick={() => { setSelectedItemId(item.id); setSearch("") }}
                  className={`w-full px-4 py-2.5 text-right text-sm font-bold transition hover:bg-sky-50 ${selectedItemId === item.id ? "bg-sky-100 text-brand" : "text-slate-700"}`}>
                  {item.name_ar} {item.sku ? <span className="text-xs text-slate-400">({item.sku})</span> : null}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {selectedItemId ? (
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-black text-slate-900">
                متغيرات: {selectedItem?.name_ar}
              </h2>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={addRow}>
                  <Plus className="size-4" /> إضافة متغير
                </Button>
                <Button type="button" className="h-10 rounded-xl" disabled={saving || variants.length === 0} onClick={() => void save()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  حفظ
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-10 text-slate-500">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : variants.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-400">
                لا توجد متغيرات. اضف متغيراً جديداً.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-black text-slate-600">
                      <th className="border-b border-slate-200 px-4 py-3 text-right">#</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">اسم المتغير</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">القيمة</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">SKU</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">سعر البيع</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">سعر الشراء</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">باركود</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((variant, index) => (
                      <tr key={index} className="transition hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-4 py-2 text-sm font-bold text-slate-400">{index + 1}</td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={variant.name} onChange={(e) => updateRow(index, "name", e.target.value)} placeholder="مثال: الحجم" className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={variant.value} onChange={(e) => updateRow(index, "value", e.target.value)} placeholder="مثال: Large" className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={variant.sku} onChange={(e) => updateRow(index, "sku", e.target.value)} className="h-10 rounded-xl text-sm" dir="ltr" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input type="number" min="0" value={variant.sell_price} onChange={(e) => updateRow(index, "sell_price", e.target.value)} className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input type="number" min="0" value={variant.purchase_price} onChange={(e) => updateRow(index, "purchase_price", e.target.value)} className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={variant.barcode} onChange={(e) => updateRow(index, "barcode", e.target.value)} className="h-10 rounded-xl text-sm" dir="ltr" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2 text-center">
                          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl text-rose-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => removeRow(index)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : (
          <Card className="rounded-2xl border-slate-200 bg-white p-8 text-center shadow-sm">
            <Package className="mx-auto mb-3 size-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-500">اختر صنفاً من القائمة لإدارة متغيراته</p>
          </Card>
        )}
      </section>
    </PageAccess>
  )
}
