"use client"

import { useCallback, useEffect, useState } from "react"
import { Edit, Loader2, Plus, RefreshCw, Scale, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SkeletonRows } from "@/components/shared/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Unit = { id: string; unit_name: string }

export function UnitsManagerView() {
  const auth = useAuth()
  const canWrite = auth.can("inventory:create") || auth.isDeveloper
  const canDelete = auth.can("inventory:delete") || auth.isDeveloper
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ mode: "create"; unit: null } | { mode: "edit"; unit: Unit } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null)
  const [unitName, setUnitName] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/items/units", { cache: "no-store" })
      const data = await res.json() as { units?: Unit[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل الوحدات")
      setUnits(data.units ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الوحدات")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() { setUnitName(""); setDialog({ mode: "create", unit: null }) }
  function openEdit(unit: Unit) { setUnitName(unit.unit_name); setDialog({ mode: "edit", unit }) }

  async function save() {
    if (!unitName.trim()) { toast.error("اسم الوحدة مطلوب"); return }
    setSaving(true)
    try {
      const isEdit = dialog?.mode === "edit"
      const method = isEdit ? "PATCH" : "POST"
      const body = isEdit ? { id: (dialog as { mode: "edit"; unit: Unit }).unit.id, unit_name: unitName.trim() } : { unit_name: unitName.trim() }
      const res = await fetch("/api/items/units", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(isEdit ? "تم تعديل الوحدة" : "تم إنشاء الوحدة")
      setDialog(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const res = await fetch(`/api/items/units?id=${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحذف")
      toast.success("تم حذف الوحدة"); setDeleteTarget(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    } finally { setSaving(false) }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-black"><Scale className="size-5 text-brand" /> الوحدات</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              {canWrite ? <Button className="h-9 rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <SkeletonRows count={4} /> : units.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500">لا توجد وحدات. أضف أول وحدة.</div>
            ) : (
              <Table><TableHeader><TableRow><TableHead className="text-right">اسم الوحدة</TableHead><TableHead className="text-center">الإجراءات</TableHead></TableRow></TableHeader>
                <TableBody>{units.map((unit) => (
                  <TableRow key={unit.id}>
                    <TableCell className="font-black">{unit.unit_name}</TableCell>
                    <TableCell className="text-center"><div className="flex justify-center gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" disabled={!canWrite} onClick={() => openEdit(unit)}><Edit className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" className="rounded-xl border-rose-200 text-rose-600" disabled={!canDelete} onClick={() => setDeleteTarget(unit)}><Trash2 className="size-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{dialog?.mode === "edit" ? "تعديل وحدة" : "إضافة وحدة"}</DialogTitle></DialogHeader>
            <div className="space-y-1.5"><Label className="font-black">اسم الوحدة</Label><Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="مثال: علبة، شريط، قرص" className="h-11 rounded-xl" /></div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDialog(null)}>إلغاء</Button><Button className="rounded-xl" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent dir="rtl" className="max-w-sm rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">حذف الوحدة؟</DialogTitle></DialogHeader>
            <p className="text-sm font-bold text-slate-500">هل أنت متأكد من حذف {deleteTarget?.unit_name}؟</p>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDeleteTarget(null)}>إلغاء</Button><Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void remove()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} حذف</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
