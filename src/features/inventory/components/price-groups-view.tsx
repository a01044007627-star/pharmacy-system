"use client"

import { useCallback, useEffect, useState } from "react"
import { Edit, Layers, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
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

type PriceGroup = { id: string; name: string; markup_percent: number | null; description: string | null }

export function PriceGroupsView() {
  const auth = useAuth()
  const canWrite = auth.can("inventory:create") || auth.isDeveloper
  const canDelete = auth.can("inventory:delete") || auth.isDeveloper
  const [groups, setGroups] = useState<PriceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ mode: "create"; group: null } | { mode: "edit"; group: PriceGroup } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PriceGroup | null>(null)
  const [name, setName] = useState("")
  const [markup, setMarkup] = useState("")
  const [description, setDescription] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/entities?entity=price-groups&pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = await res.json() as { rows?: PriceGroup[]; error?: string }
      if (!res.ok) {
        setGroups([])
        return
      }
      setGroups(data.rows ?? [])
    } catch { setGroups([]) }
    finally { setLoading(false) }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  function openCreate() { setName(""); setMarkup(""); setDescription(""); setDialog({ mode: "create", group: null }) }
  function openEdit(group: PriceGroup) { setName(group.name); setMarkup(String(group.markup_percent ?? "")); setDescription(group.description ?? ""); setDialog({ mode: "edit", group }) }

  async function save() {
    if (!name.trim()) { toast.error("اسم المجموعة السعرية مطلوب"); return }
    setSaving(true)
    try {
      const isEdit = dialog?.mode === "edit"
      const res = await fetch("/api/settings/entities?entity=price-groups", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "price-groups",
          ...(isEdit ? { id: (dialog as { mode: "edit"; group: PriceGroup }).group.id } : {}),
          values: { name: name.trim(), markup_percent: markup ? Math.max(0, Number(markup)) : null, description: description.trim() || null },
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(isEdit ? "تم تعديل المجموعة" : "تم إنشاء المجموعة")
      setDialog(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const res = await fetch(`/api/settings/entities?entity=price-groups&id=${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحذف")
      toast.success("تم حذف المجموعة"); setDeleteTarget(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    } finally { setSaving(false) }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-black"><Layers className="size-5 text-brand" /> المجموعات السعرية</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              {canWrite ? <Button className="h-9 rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <SkeletonRows count={4} /> : groups.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500">لا توجد مجموعات سعرية.</div>
            ) : (
              <Table><TableHeader><TableRow><TableHead className="text-right">الاسم</TableHead><TableHead className="text-center">نسبة الربح</TableHead><TableHead className="text-right">الوصف</TableHead><TableHead className="text-center">الإجراءات</TableHead></TableRow></TableHeader>
                <TableBody>{groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-black">{group.name}</TableCell>
                    <TableCell className="text-center font-bold text-brand">{group.markup_percent != null ? `${group.markup_percent}%` : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-sm text-slate-600">{group.description ?? <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-center"><div className="flex justify-center gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" disabled={!canWrite} onClick={() => openEdit(group)}><Edit className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" className="rounded-xl border-rose-200 text-rose-600" disabled={!canDelete} onClick={() => setDeleteTarget(group)}><Trash2 className="size-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{dialog?.mode === "edit" ? "تعديل مجموعة سعرية" : "إضافة مجموعة سعرية"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5"><Label className="font-black">الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تجار، نصف جملة" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">نسبة الربح (%)</Label><Input type="number" min="0" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="مثال: 15" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">الوصف</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف اختياري" className="h-11 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDialog(null)}>إلغاء</Button><Button className="rounded-xl" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent dir="rtl" className="max-w-sm rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">حذف المجموعة السعرية؟</DialogTitle></DialogHeader>
            <p className="text-sm font-bold text-slate-500">هل أنت متأكد من حذف {deleteTarget?.name}؟</p>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDeleteTarget(null)}>إلغاء</Button><Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void remove()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} حذف</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
