"use client"

import { useCallback, useEffect, useState } from "react"
import { FileText, Plus, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Prescription = {
  id: string
  patient_name: string
  doctor_name: string | null
  diagnosis: string | null
  notes: string | null
  created_at: string
}

export default function PrescriptionsPage() {
  const auth = useAuth()
  const [rows, setRows] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ patient_name: "", doctor_name: "", diagnosis: "", notes: "" })

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/prescriptions?pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { prescriptions?: Prescription[] }
      if (!response.ok) throw new Error("فشل تحميل الوصفات")
      setRows(data.prescriptions ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الوصفات")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const handleAdd = async () => {
    if (!form.patient_name.trim()) { toast.error("اسم المريض مطلوب"); return }
    try {
      const response = await fetch("/api/prescriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, pharmacy_id: auth.activePharmacyId }) })
      if (!response.ok) throw new Error("فشل إضافة الوصفة")
      toast.success("تمت إضافة الوصفة"); setOpen(false); setForm({ patient_name: "", doctor_name: "", diagnosis: "", notes: "" }); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إضافة الوصفة")
    }
  }

  const filtered = rows.filter((r) => !query || r.patient_name.includes(query) || (r.doctor_name?.includes(query)))

  return (
    <PageAccess permission="prescriptions:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="الوصفات الطبية" subtitle="إدارة الوصفات الطبية للمرضى." icon={FileText} actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {auth.can("hr:write") ? <Button className="h-10 rounded-xl" onClick={() => setOpen(true)}><Plus className="size-4" /> وصفة جديدة</Button> : null}
          </>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم المريض أو الطبيب..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : filtered.length === 0 ? (
            <EmptyState icon={FileText} title="لا توجد وصفات طبية" description="أضف أول وصفة طبية للمتابعة." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">المريض</TableHead><TableHead className="text-right">الطبيب</TableHead><TableHead className="text-right">التشخيص</TableHead>
                <TableHead className="text-center">ملاحظات</TableHead><TableHead className="text-center">التاريخ</TableHead>
              </TableRow></TableHeader>
              <TableBody>{filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.patient_name}</TableCell>
                  <TableCell className="font-bold">{row.doctor_name ?? "—"}</TableCell>
                  <TableCell className="text-xs font-bold max-w-[200px] truncate">{row.diagnosis ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs max-w-[200px] truncate">{row.notes ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleDateString("ar-EG")}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-black text-lg">إضافة وصفة طبية</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">اسم المريض *</label><Input value={form.patient_name} onChange={(e) => setForm((p) => ({ ...p, patient_name: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">اسم الطبيب</label><Input value={form.doctor_name} onChange={(e) => setForm((p) => ({ ...p, doctor_name: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">التشخيص</label><Input value={form.diagnosis} onChange={(e) => setForm((p) => ({ ...p, diagnosis: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">ملاحظات</label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="h-10 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button onClick={() => void handleAdd()}>إضافة</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
