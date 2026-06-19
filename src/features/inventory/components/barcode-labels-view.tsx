"use client"

import { useCallback, useEffect, useState } from "react"
import { Barcode, Edit, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SkeletonRows } from "@/components/shared/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Paper = {
  id: string; name: string; width_mm: number; height_mm: number
  columns_count: number; rows_count: number; margin_top_mm: number
  margin_bottom_mm: number; margin_left_mm: number; margin_right_mm: number
  is_default: boolean
}

const defaultPaper = {
  name: "", width_mm: 50, height_mm: 30, columns_count: 2, rows_count: 5,
  margin_top_mm: 5, margin_bottom_mm: 5, margin_left_mm: 5, margin_right_mm: 5,
}

export function BarcodeLabelsView() {
  const auth = useAuth()
  const canWrite = auth.can("settings:barcode.write") || auth.isDeveloper
  const canDelete = auth.can("settings:barcode.write") || auth.isDeveloper
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ mode: "create"; paper: null } | { mode: "edit"; paper: Paper } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Paper | null>(null)
  const [form, setForm] = useState(defaultPaper)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/settings/entities?entity=barcode-papers", { cache: "no-store" })
      const data = await res.json() as { rows?: Paper[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل إعدادات الباركود")
      setPapers(data.rows ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الإعدادات")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() { setForm(defaultPaper); setDialog({ mode: "create", paper: null }) }
  function openEdit(paper: Paper) { setForm(paper); setDialog({ mode: "edit", paper }) }

  const setField = (key: string, value: string | number) => setForm((prev) => ({ ...prev, [key]: value }))

  async function save() {
    if (!form.name.trim()) { toast.error("اسم الورقة مطلوب"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/settings/entities?entity=barcode-papers", {
        method: dialog?.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "barcode-papers",
          ...(dialog?.mode === "edit" ? { id: (dialog as { mode: "edit"; paper: Paper }).paper.id } : {}),
          values: {
            name: form.name.trim(),
            width_mm: Math.max(1, Number(form.width_mm) || 50),
            height_mm: Math.max(1, Number(form.height_mm) || 30),
            columns_count: Math.max(1, Number(form.columns_count) || 2),
            rows_count: Math.max(1, Number(form.rows_count) || 5),
            margin_top_mm: Math.max(0, Number(form.margin_top_mm) || 0),
            margin_bottom_mm: Math.max(0, Number(form.margin_bottom_mm) || 0),
            margin_left_mm: Math.max(0, Number(form.margin_left_mm) || 0),
            margin_right_mm: Math.max(0, Number(form.margin_right_mm) || 0),
            is_default: false,
          },
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(dialog?.mode === "edit" ? "تم تعديل الورقة" : "تم إنشاء الورقة")
      setDialog(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const res = await fetch(`/api/settings/entities?entity=barcode-papers&id=${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحذف")
      toast.success("تم حذف الورقة"); setDeleteTarget(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    } finally { setSaving(false) }
  }

  return (
    <PageAccess permission="settings:barcode.read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-black"><Barcode className="size-5 text-brand" /> إعدادات ورق الباركود</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              {canWrite ? <Button className="h-9 rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <SkeletonRows count={4} /> : papers.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500">لا توجد مقاسات ورق. أضف أول مقاس.</div>
            ) : (
              <Table><TableHeader><TableRow><TableHead className="text-right">الاسم</TableHead><TableHead className="text-center">المقاس (مم)</TableHead><TableHead className="text-center">الأعمدة × الصفوف</TableHead><TableHead className="text-center">الهوامش</TableHead><TableHead className="text-center">افتراضي</TableHead><TableHead className="text-center">الإجراءات</TableHead></TableRow></TableHeader>
                <TableBody>{papers.map((paper) => (
                  <TableRow key={paper.id}>
                    <TableCell className="font-black">{paper.name}</TableCell>
                    <TableCell className="text-center font-bold">{paper.width_mm} × {paper.height_mm}</TableCell>
                    <TableCell className="text-center font-bold">{paper.columns_count} × {paper.rows_count}</TableCell>
                    <TableCell className="text-center text-xs font-bold text-slate-500">أعلى {paper.margin_top_mm} / أسفل {paper.margin_bottom_mm} / يمين {paper.margin_right_mm} / يسار {paper.margin_left_mm}</TableCell>
                    <TableCell className="text-center">{paper.is_default ? <span className="text-emerald-600 font-black">نعم</span> : <span className="text-slate-400">لا</span>}</TableCell>
                    <TableCell className="text-center"><div className="flex justify-center gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" disabled={!canWrite} onClick={() => openEdit(paper)}><Edit className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" className="rounded-xl border-rose-200 text-rose-600" disabled={!canDelete} onClick={() => setDeleteTarget(paper)}><Trash2 className="size-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent dir="rtl" className="max-w-lg rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{dialog?.mode === "edit" ? "تعديل مقاس الورق" : "إضافة مقاس ورق"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2"><Label className="font-black">الاسم</Label><Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="مثال: A4 2×5, بطاقة 50×30" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">العرض (مم)</Label><Input type="number" min="1" value={form.width_mm} onChange={(e) => setField("width_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">الارتفاع (مم)</Label><Input type="number" min="1" value={form.height_mm} onChange={(e) => setField("height_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">عدد الأعمدة</Label><Input type="number" min="1" value={form.columns_count} onChange={(e) => setField("columns_count", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">عدد الصفوف</Label><Input type="number" min="1" value={form.rows_count} onChange={(e) => setField("rows_count", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">هامش أعلى</Label><Input type="number" min="0" value={form.margin_top_mm} onChange={(e) => setField("margin_top_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">هامش أسفل</Label><Input type="number" min="0" value={form.margin_bottom_mm} onChange={(e) => setField("margin_bottom_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">هامش يمين</Label><Input type="number" min="0" value={form.margin_left_mm} onChange={(e) => setField("margin_left_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">هامش يسار</Label><Input type="number" min="0" value={form.margin_right_mm} onChange={(e) => setField("margin_right_mm", Number(e.target.value))} className="h-11 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDialog(null)}>إلغاء</Button><Button className="rounded-xl" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent dir="rtl" className="max-w-sm rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">حذف مقاس الورق؟</DialogTitle></DialogHeader>
            <p className="text-sm font-bold text-slate-500">هل أنت متأكد من حذف {deleteTarget?.name}؟</p>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDeleteTarget(null)}>إلغاء</Button><Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void remove()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} حذف</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
