"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Printer, Sparkles, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { BarcodeLabelService } from "@/features/settings/services/barcode-label-service"
import { Loader2 } from "lucide-react"
import type { BarcodePaperSetting } from "@/features/settings/types"

function BarcodeContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("barcode")
  const [papers, setPapers] = useState<BarcodePaperSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    page_width: 297,
    page_height: 210,
    left_margin: 10,
    right_margin: 10,
    top_margin: 10,
    bottom_margin: 10,
    label_width: 70,
    label_height: 40,
    columns: 3,
    rows: 4,
    gap_horizontal: 2,
    gap_vertical: 2,
    is_default: false,
  })
  const [saving, setSaving] = useState(false)

  const canWritePapers = can("settings:write") && canWrite

  const loadPapers = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const data = await BarcodeLabelService.getBarcodePapers()
      setPapers(data)
    } catch {
      toast.error("فشل تحميل إعدادات الباركود")
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadPapers() }, [loadPapers])

  function resetForm() {
    setForm({
      name: "",
      page_width: 297,
      page_height: 210,
      left_margin: 10,
      right_margin: 10,
      top_margin: 10,
      bottom_margin: 10,
      label_width: 70,
      label_height: 40,
      columns: 3,
      rows: 4,
      gap_horizontal: 2,
      gap_vertical: 2,
      is_default: false,
    })
    setEditingId(null)
    setShowForm(false)
  }

  async function handleSubmit() {
    if (!canWritePapers) { toast.error("ليست لديك صلاحية تعديل إعدادات الباركود"); return }
    if (!form.name.trim()) { toast.error("اسم الورق مطلوب"); return }

    setSaving(true)
    try {
      if (editingId) {
        await BarcodeLabelService.saveBarcodePaper({ ...form, id: editingId })
        toast.success("تم تحديث إعدادات الورق")
      } else {
        await BarcodeLabelService.saveBarcodePaper(form)
        toast.success("تم إضافة إعدادات الورق")
      }
      resetForm()
      await loadPapers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الإعدادات")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, isDefault: boolean) {
    if (!canWritePapers) { toast.error("ليست لديك صلاحية حذف الإعدادات"); return }
    if (isDefault) { toast.error("لا يمكن حذف الإعدادات الافتراضية"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذه الإعدادات؟")) return
    try {
      await BarcodeLabelService.deleteBarcodePaper(id)
      toast.success("تم حذف الإعدادات")
      await loadPapers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حذف الإعدادات")
    }
  }

  async function setAsDefault(id: string) {
    if (!canWritePapers) return
    try {
      await BarcodeLabelService.setDefault(id)
      toast.success("تم تعيين الإعدادات كافتراضية")
      await loadPapers()
    } catch {
      toast.error("فشل تحديث الإعدادات الافتراضية")
    }
  }

  function startEdit(paper: BarcodePaperSetting) {
    setForm({
      name: paper.name,
      page_width: paper.page_width,
      page_height: paper.page_height,
      left_margin: paper.left_margin,
      right_margin: paper.right_margin,
      top_margin: paper.top_margin,
      bottom_margin: paper.bottom_margin,
      label_width: paper.label_width,
      label_height: paper.label_height,
      columns: paper.columns,
      rows: paper.rows,
      gap_horizontal: paper.gap_horizontal,
      gap_vertical: paper.gap_vertical,
      is_default: paper.is_default,
    })
    setEditingId(paper.id)
    setShowForm(true)
  }

  if (!canRead) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm font-bold text-slate-500">ليس لديك صلاحية الوصول</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-right">
          <h1 className="text-lg font-black text-slate-900">إعدادات الباركود</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">إدارة أحجام ورق الباركود وتنسيقات الطباعة</p>
        </div>
        {canWritePapers ? (
          <Button variant="default" size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="size-4" />
            إضافة ورق
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-base font-black text-slate-900">
              {editingId ? "تعديل إعدادات الورق" : "إضافة ورق باركود جديد"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="grid gap-1.5 text-right sm:col-span-2">
              <span className="text-xs font-black text-slate-700">اسم الورق</span>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="ورق باركود 3×4" className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">عرض الصفحة (مم)</span>
              <Input type="number" value={form.page_width} onChange={(e) => setForm((p) => ({ ...p, page_width: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">ارتفاع الصفحة (مم)</span>
              <Input type="number" value={form.page_height} onChange={(e) => setForm((p) => ({ ...p, page_height: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">عرض الملصق (مم)</span>
              <Input type="number" value={form.label_width} onChange={(e) => setForm((p) => ({ ...p, label_width: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">ارتفاع الملصق (مم)</span>
              <Input type="number" value={form.label_height} onChange={(e) => setForm((p) => ({ ...p, label_height: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الأعمدة</span>
              <Input type="number" value={form.columns} onChange={(e) => setForm((p) => ({ ...p, columns: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الصفوف</span>
              <Input type="number" value={form.rows} onChange={(e) => setForm((p) => ({ ...p, rows: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الهامش العلوي (مم)</span>
              <Input type="number" value={form.top_margin} onChange={(e) => setForm((p) => ({ ...p, top_margin: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الهامش السفلي (مم)</span>
              <Input type="number" value={form.bottom_margin} onChange={(e) => setForm((p) => ({ ...p, bottom_margin: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الهامش الأيمن (مم)</span>
              <Input type="number" value={form.right_margin} onChange={(e) => setForm((p) => ({ ...p, right_margin: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">الهامش الأيسر (مم)</span>
              <Input type="number" value={form.left_margin} onChange={(e) => setForm((p) => ({ ...p, left_margin: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">المسافة الأفقية (مم)</span>
              <Input type="number" value={form.gap_horizontal} onChange={(e) => setForm((p) => ({ ...p, gap_horizontal: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">المسافة الرأسية (مم)</span>
              <Input type="number" value={form.gap_vertical} onChange={(e) => setForm((p) => ({ ...p, gap_vertical: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-right sm:col-span-2">
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm((p) => ({ ...p, is_default: v }))} />
              <span className="text-sm font-bold text-slate-800">ورق افتراضي</span>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button variant="default" size="sm" onClick={handleSubmit} disabled={saving}>
                {saving ? "جاري الحفظ…" : editingId ? "تحديث" : "إضافة"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetForm}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {papers.length === 0 ? (
          <Card className="col-span-full rounded-xl border-slate-200 bg-white py-8 text-center shadow-sm sm:col-span-2 xl:col-span-3">
            <Printer className="mx-auto mb-2 size-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">لا توجد إعدادات باركود بعد</p>
            {canWritePapers ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { resetForm(); setShowForm(true) }}>
                <Plus className="size-4" />
                إضافة ورق
              </Button>
            ) : null}
          </Card>
        ) : papers.map((paper) => (
          <Card key={paper.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                    <Sparkles className="size-5" />
                  </span>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">{paper.name}</span>
                      {paper.is_default ? (
                        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-black text-brand">افتراضي</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">{paper.columns}×{paper.rows} ملصق · {paper.label_width}×{paper.label_height} مم</p>
                  </div>
                </div>
                <CheckCircle2 className="size-4 text-emerald-500" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-0.5">صفحة {paper.page_width}×{paper.page_height} مم</span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5">هامش {paper.top_margin}-{paper.bottom_margin}-{paper.right_margin}-{paper.left_margin}</span>
              </div>
              {canWritePapers ? (
                <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
                  <Button variant="ghost" size="icon-xs" onClick={() => startEdit(paper)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  {!paper.is_default ? (
                    <>
                      <Button variant="ghost" size="icon-xs" onClick={() => setAsDefault(paper.id)}>
                        <CheckCircle2 className="size-3.5 text-brand" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(paper.id, paper.is_default)}>
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function BarcodePage() {
  return (
    <SettingsLayout>
      <BarcodeContent />
    </SettingsLayout>
  )
}
