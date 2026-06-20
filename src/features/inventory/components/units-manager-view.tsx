"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Edit, Loader2, Plus, RefreshCw, Scale, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { QuantityMode, UnitCategory } from "@/domain/inventory/units/unit-types"
import { PageAccess } from "@/components/auth/page-access"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/lib/http/api-client"
import { cn } from "@/lib/utils"

type Unit = {
  id: string
  code?: string | null
  unit_name: string
  symbol?: string | null
  category: UnitCategory
  quantity_mode: QuantityMode
  quantity_scale: number
  allows_fraction: boolean
  description?: string | null
  is_active: boolean
  is_system?: boolean
  sort_order?: number
}

type CatalogUnit = {
  code: string
  nameAr: string
  symbol?: string
  category: UnitCategory
  quantityMode: QuantityMode
  quantityScale: number
  sortOrder: number
}

type UnitsResponse = { units: Unit[]; catalog: CatalogUnit[] }

type UnitForm = {
  code: string
  unit_name: string
  symbol: string
  category: UnitCategory
  quantity_mode: QuantityMode
  quantity_scale: string
  description: string
  is_active: boolean
  sort_order: string
}

const CATEGORY_LABELS: Record<UnitCategory, string> = {
  [UnitCategory.Package]: "عبوات رئيسية",
  [UnitCategory.Dosage]: "وحدات دوائية",
  [UnitCategory.Volume]: "حجم وسوائل",
  [UnitCategory.Mass]: "وزن وكتلة",
  [UnitCategory.Length]: "طول",
  [UnitCategory.Service]: "خدمات",
  [UnitCategory.Other]: "أخرى",
}

const EMPTY_FORM: UnitForm = {
  code: "",
  unit_name: "",
  symbol: "",
  category: UnitCategory.Dosage,
  quantity_mode: QuantityMode.Discrete,
  quantity_scale: "0",
  description: "",
  is_active: true,
  sort_order: "1000",
}

function toForm(unit?: Unit | null): UnitForm {
  if (!unit) return { ...EMPTY_FORM }
  return {
    code: unit.code ?? "",
    unit_name: unit.unit_name,
    symbol: unit.symbol ?? "",
    category: unit.category ?? UnitCategory.Other,
    quantity_mode: unit.quantity_mode ?? QuantityMode.Discrete,
    quantity_scale: String(unit.quantity_scale ?? 0),
    description: unit.description ?? "",
    is_active: unit.is_active !== false,
    sort_order: String(unit.sort_order ?? 1000),
  }
}

export function UnitsManagerView() {
  const auth = useAuth()
  const canWrite = auth.can("inventory:create") || auth.can("inventory:update") || auth.isDeveloper
  const canDelete = auth.can("inventory:delete") || auth.isDeveloper
  const [units, setUnits] = useState<Unit[]>([])
  const [catalog, setCatalog] = useState<CatalogUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Unit | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null)
  const [form, setForm] = useState<UnitForm>(EMPTY_FORM)

  const groupedCount = useMemo(() => {
    const counts = new Map<UnitCategory, number>()
    for (const unit of units) counts.set(unit.category, (counts.get(unit.category) ?? 0) + 1)
    return counts
  }, [units])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.get<UnitsResponse>("/api/items/units", {
        fallbackMessage: "فشل تحميل الوحدات",
      })
      setUnits(data.units ?? [])
      setCatalog(data.catalog ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الوحدات")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setForm({ ...EMPTY_FORM })
    setEditing(null)
  }

  function openEdit(unit: Unit) {
    setForm(toForm(unit))
    setEditing(unit)
  }

  function applyCatalog(code: string) {
    const entry = catalog.find((unit) => unit.code === code)
    if (!entry) return
    setForm((current) => ({
      ...current,
      code: entry.code,
      unit_name: entry.nameAr,
      symbol: entry.symbol ?? "",
      category: entry.category,
      quantity_mode: entry.quantityMode,
      quantity_scale: String(entry.quantityScale),
      sort_order: String(entry.sortOrder),
    }))
  }

  function changeMode(mode: QuantityMode) {
    setForm((current) => ({
      ...current,
      quantity_mode: mode,
      quantity_scale: mode === QuantityMode.Discrete ? "0" : current.quantity_scale === "0" ? "3" : current.quantity_scale,
    }))
  }

  async function save() {
    if (!form.unit_name.trim()) {
      toast.error("اسم الوحدة مطلوب")
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        ...form,
        quantity_scale: Number(form.quantity_scale) || 0,
        sort_order: Number(form.sort_order) || 0,
      }
      if (editing) {
        await apiClient.patch("/api/items/units", payload, { fallbackMessage: "فشل تعديل الوحدة" })
      } else {
        await apiClient.post("/api/items/units", payload, { fallbackMessage: "فشل إنشاء الوحدة" })
      }
      toast.success(editing ? "تم تعديل الوحدة" : "تم إنشاء الوحدة")
      setEditing(undefined)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ الوحدة")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await apiClient.delete("/api/items/units", {
        query: { id: deleteTarget.id },
        fallbackMessage: "فشل حذف الوحدة",
      })
      toast.success("تم حذف الوحدة")
      setDeleteTarget(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف الوحدة")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-black"><Scale className="size-5" /> وحدات الأصناف</CardTitle>
              <p className="mt-1 text-sm font-bold text-slate-500">تعريف الوحدات المعدودة والمقاسة وسياسة الكسور لكل وحدة.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? <Button className="rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة وحدة</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {Object.values(UnitCategory).map((category) => (
                <Badge key={category} variant="outline" className="rounded-full px-3 py-1 font-black">
                  {CATEGORY_LABELS[category]}: {(groupedCount.get(category) ?? 0).toLocaleString("ar-EG")}
                </Badge>
              ))}
            </div>

            {loading ? <SkeletonRows count={6} /> : units.length === 0 ? (
              <EmptyState icon={Scale} title="لا توجد وحدات" description="أضف الوحدات الأساسية والفرعية المستخدمة في الصيدلية." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الوحدة</TableHead>
                      <TableHead className="text-right">المجموعة</TableHead>
                      <TableHead className="text-center">نوع الكمية</TableHead>
                      <TableHead className="text-center">الدقة</TableHead>
                      <TableHead className="text-center">الحالة</TableHead>
                      <TableHead className="text-center">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell>
                          <div className="font-black">{unit.unit_name}{unit.symbol ? ` (${unit.symbol})` : ""}</div>
                          <div className="text-xs font-bold text-slate-400">{unit.code ?? "وحدة مخصصة"}</div>
                        </TableCell>
                        <TableCell className="font-bold">{CATEGORY_LABELS[unit.category] ?? CATEGORY_LABELS[UnitCategory.Other]}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={unit.quantity_mode === QuantityMode.Discrete ? "border-blue-200 bg-blue-50 text-blue-700" : "border-violet-200 bg-violet-50 text-violet-700"}>
                            {unit.quantity_mode === QuantityMode.Discrete ? "عدد صحيح" : "تقبل كسور"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-black">{unit.quantity_scale}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={unit.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                            {unit.is_active ? "نشطة" : "موقوفة"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            {canWrite ? <Button size="icon" variant="ghost" onClick={() => openEdit(unit)}><Edit className="size-4" /></Button> : null}
                            {canDelete && !unit.is_system ? <Button size="icon" variant="ghost" className="text-rose-600" onClick={() => setDeleteTarget(unit)}><Trash2 className="size-4" /></Button> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
          <DialogContent dir="rtl" className="max-w-2xl rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{editing ? "تعديل الوحدة" : "إضافة وحدة"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              {!editing ? (
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="font-black">اختيار سريع من كتالوج الصيدلية</Label>
                  <NativeSelect value={form.code} onChange={(event) => applyCatalog(event.target.value)}>
                    <NativeSelectOption value="">وحدة مخصصة</NativeSelectOption>
                    {catalog.map((unit) => <NativeSelectOption key={unit.code} value={unit.code}>{unit.nameAr}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
              ) : null}
              <div className="space-y-1.5"><Label className="font-black">اسم الوحدة</Label><Input value={form.unit_name} onChange={(event) => setForm((current) => ({ ...current, unit_name: event.target.value }))} placeholder="مثال: علبة، شريط، قرص" /></div>
              <div className="space-y-1.5"><Label className="font-black">الرمز</Label><Input value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} placeholder="مثال: ml" dir="ltr" /></div>
              <div className="space-y-1.5"><Label className="font-black">المجموعة الرئيسية</Label><NativeSelect value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as UnitCategory }))}>{Object.values(UnitCategory).map((category) => <NativeSelectOption key={category} value={category}>{CATEGORY_LABELS[category]}</NativeSelectOption>)}</NativeSelect></div>
              <div className="space-y-1.5"><Label className="font-black">نوع الكمية</Label><NativeSelect value={form.quantity_mode} onChange={(event) => changeMode(event.target.value as QuantityMode)}><NativeSelectOption value={QuantityMode.Discrete}>معدودة — أعداد صحيحة</NativeSelectOption><NativeSelectOption value={QuantityMode.Continuous}>مقاسة — تقبل كسور</NativeSelectOption></NativeSelect></div>
              <div className="space-y-1.5"><Label className="font-black">عدد المنازل العشرية</Label><Input type="number" min="0" max="6" disabled={form.quantity_mode === QuantityMode.Discrete} value={form.quantity_scale} onChange={(event) => setForm((current) => ({ ...current, quantity_scale: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label className="font-black">ترتيب العرض</Label><Input type="number" min="0" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} /></div>
              <div className="space-y-1.5 md:col-span-2"><Label className="font-black">الوصف</Label><Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="استخدام الوحدة أو ملاحظات عليها" /></div>
              <div className="flex items-center justify-between rounded-2xl border p-3 md:col-span-2"><div><div className="font-black">الوحدة نشطة</div><div className="text-xs font-bold text-slate-500">الوحدات الموقوفة لا تظهر للاستخدام الجديد.</div></div><Switch checked={form.is_active} onCheckedChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))} /></div>
            </div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setEditing(undefined)}>إلغاء</Button><Button className="rounded-xl" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent dir="rtl" className="max-w-sm rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">حذف الوحدة؟</DialogTitle></DialogHeader>
            <p className="text-sm font-bold text-slate-500">لن تُحذف الوحدة إذا كانت مرتبطة بأصناف. الأفضل إيقافها للحفاظ على السجل التاريخي.</p>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDeleteTarget(null)}>إلغاء</Button><Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void remove()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} حذف</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
