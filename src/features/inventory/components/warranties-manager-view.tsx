"use client"

import * as React from "react"
import { Loader2, Package, Plus, Save, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"

type WarrantyRow = {
  id?: string
  name: string
  duration_days: string
  description: string
}

type ItemLookup = { id: string; name_ar: string; name_en?: string | null }

export function WarrantiesManagerView() {
  const auth = useAuth()
  const [items, setItems] = React.useState<ItemLookup[]>([])
  const [selectedItemId, setSelectedItemId] = React.useState("")
  const [warranties, setWarranties] = React.useState<WarrantyRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const filteredItems = React.useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.name_ar.toLowerCase().includes(q) || i.name_en?.toLowerCase().includes(q))
  }, [items, search])

  React.useEffect(() => {
    if (!auth.activePharmacyId) return
    async function load() {
      try {
        const res = await fetch("/api/items?mode=active&page_size=1000&pharmacy_id=" + auth.activePharmacyId, { cache: "no-store" })
        const data = await res.json()
        if (res.ok) setItems((data.items ?? []).map((i: Record<string, unknown>) => ({ id: i.id as string, name_ar: i.name_ar as string, name_en: i.name_en as string | null })))
      } catch { /* ignore */ }
    }
    void load()
  }, [auth.activePharmacyId])

  React.useEffect(() => {
    if (!selectedItemId) { setWarranties([]); return }
    setLoading(true)
    async function load() {
      try {
        const res = await fetch("/api/items/warranties?item_id=" + selectedItemId, { cache: "no-store" })
        const data = await res.json()
        if (res.ok) {
          setWarranties((data.warranties ?? []).map((w: Record<string, unknown>) => ({
            id: w.id as string,
            name: w.name as string || "",
            duration_days: String(w.duration_days ?? "0"),
            description: w.description as string || "",
          })))
        }
      } catch { toast.error("فشل تحميل الضمانات") }
      finally { setLoading(false) }
    }
    void load()
  }, [selectedItemId])

  const selectedItem = items.find((i) => i.id === selectedItemId)

  function addRow() {
    setWarranties((prev) => [...prev, { name: "", duration_days: "0", description: "" }])
  }

  function removeRow(index: number) {
    setWarranties((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof WarrantyRow, value: string) {
    setWarranties((prev) => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  async function save() {
    if (!selectedItemId) { toast.error("اختر صنفاً أولاً"); return }
    const valid = warranties.filter((w) => Number(w.duration_days) > 0)
    if (valid.length === 0) { toast.error("أضف ضماناً واحداً على الأقل بمدة"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/items/warranties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: selectedItemId,
          pharmacy_id: auth.activePharmacyId,
          warranties: valid.map((w) => ({
            name: w.name || "ضمان",
            duration_days: Number(w.duration_days),
            description: w.description || null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(`تم حفظ ${data.count} ضمان`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  const totalDays = warranties.reduce((sum, w) => sum + (Number(w.duration_days) || 0), 0)

  return (
    <PageAccess permission="inventory:update">
      <section dir="rtl" className="page-container space-y-5 py-4 text-right sm:py-6">
        <DashboardPageHeader title="إدارة ضمانات الأصناف" subtitle="حدد فترات الضمان (بالأيام) لكل صنف" icon={ShieldCheck} />

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
                  {item.name_ar}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {selectedItemId ? (
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">ضمانات: {selectedItem?.name_ar}</h2>
                <p className="text-xs font-bold text-slate-500">إجمالي مدة الضمان: {totalDays.toLocaleString("ar-EG")} يوم</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={addRow}>
                  <Plus className="size-4" /> إضافة ضمان
                </Button>
                <Button type="button" className="h-10 rounded-xl" disabled={saving || warranties.length === 0} onClick={() => void save()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  حفظ
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-10 text-slate-500">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : warranties.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-400">
                لا توجد ضمانات. أضف ضماناً جديداً.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[550px] border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-black text-slate-600">
                      <th className="border-b border-slate-200 px-4 py-3 text-right">#</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">اسم الضمان</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">المدة (أيام)</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right">الوصف</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warranties.map((warranty, index) => (
                      <tr key={index} className="transition hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-4 py-2 text-sm font-bold text-slate-400">{index + 1}</td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={warranty.name} onChange={(e) => updateRow(index, "name", e.target.value)} placeholder="مثال: ضمان المصنع" className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input type="number" min="0" value={warranty.duration_days} onChange={(e) => updateRow(index, "duration_days", e.target.value)} className="h-10 rounded-xl text-sm w-28" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2">
                          <Input value={warranty.description} onChange={(e) => updateRow(index, "description", e.target.value)} placeholder="وصف اختياري" className="h-10 rounded-xl text-sm" />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-2 text-center">
                          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl text-rose-500 hover:bg-rose-50" onClick={() => removeRow(index)}>
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
            <ShieldCheck className="mx-auto mb-3 size-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-500">اختر صنفاً من القائمة لإدارة ضماناته</p>
          </Card>
        )}
      </section>
    </PageAccess>
  )
}
