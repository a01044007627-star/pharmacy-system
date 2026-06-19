"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, Edit, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
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

type Brand = { id: string; name: string; logo_url: string | null }

export function BrandsManagerView() {
  const auth = useAuth()
  const canWrite = auth.can("inventory:create") || auth.isDeveloper
  const canDelete = auth.can("inventory:delete") || auth.isDeveloper
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<{ mode: "create"; brand: null } | { mode: "edit"; brand: Brand } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null)
  const [name, setName] = useState("")
  const [logoUrl, setLogoUrl] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/items/brands", { cache: "no-store" })
      const data = await res.json() as { brands?: Brand[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل الماركات")
      setBrands(data.brands ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الماركات")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() { setName(""); setLogoUrl(""); setDialog({ mode: "create", brand: null }) }
  function openEdit(brand: Brand) { setName(brand.name); setLogoUrl(brand.logo_url ?? ""); setDialog({ mode: "edit", brand }) }

  async function save() {
    if (!name.trim()) { toast.error("اسم الماركة مطلوب"); return }
    setSaving(true)
    try {
      const isEdit = dialog?.mode === "edit"
      const method = isEdit ? "PATCH" : "POST"
      const body = isEdit ? { id: (dialog as { mode: "edit"; brand: Brand }).brand.id, name: name.trim(), logo_url: logoUrl.trim() || null } : { name: name.trim(), logo_url: logoUrl.trim() || null }
      const res = await fetch("/api/items/brands", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(isEdit ? "تم تعديل الماركة" : "تم إنشاء الماركة")
      setDialog(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const res = await fetch(`/api/items/brands?id=${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحذف")
      toast.success("تم حذف الماركة"); setDeleteTarget(null); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    } finally { setSaving(false) }
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-black"><Building2 className="size-5 text-brand" /> الماركات</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              {canWrite ? <Button className="h-9 rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة</Button> : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <SkeletonRows count={4} /> : brands.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500">لا توجد ماركات. أضف أول ماركة.</div>
            ) : (
              <Table><TableHeader><TableRow><TableHead className="text-right">الاسم</TableHead><TableHead className="text-center">الشعار</TableHead><TableHead className="text-center">الإجراءات</TableHead></TableRow></TableHeader>
                <TableBody>{brands.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-black">{brand.name}</TableCell>
                    <TableCell className="text-center">{brand.logo_url ? <img src={brand.logo_url} alt={brand.name} className="mx-auto size-8 rounded-lg object-contain" /> : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-center"><div className="flex justify-center gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" disabled={!canWrite} onClick={() => openEdit(brand)}><Edit className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" className="rounded-xl border-rose-200 text-rose-600" disabled={!canDelete} onClick={() => setDeleteTarget(brand)}><Trash2 className="size-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{dialog?.mode === "edit" ? "تعديل ماركة" : "إضافة ماركة"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5"><Label className="font-black">الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الماركة" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">رابط الشعار</Label><Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." className="h-11 rounded-xl" dir="ltr" /></div>
            </div>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDialog(null)}>إلغاء</Button><Button className="rounded-xl" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent dir="rtl" className="max-w-sm rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">حذف الماركة؟</DialogTitle></DialogHeader>
            <p className="text-sm font-bold text-slate-500">هل أنت متأكد من حذف {deleteTarget?.name}؟</p>
            <DialogFooter><Button variant="outline" className="rounded-xl" onClick={() => setDeleteTarget(null)}>إلغاء</Button><Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void remove()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} حذف</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
