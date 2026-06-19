"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, RefreshCw, Search, Users, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Employee = {
  id: string
  name: string
  phone: string | null
  email: string | null
  position: string | null
  salary: number
  salary_type: string | null
  hire_date: string
  is_active: boolean
  national_id: string | null
  address: string | null
  notes: string | null
}

const defaultForm = {
  name: "", phone: "", email: "", position: "", salary: "0", salary_type: "monthly", hire_date: new Date().toISOString().split("T")[0], national_id: "", address: "", notes: "",
}

export function EmployeesView() {
  const auth = useAuth()
  const [rows, setRows] = useState<Employee[]>([])
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState(defaultForm)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query, is_active: statusFilter, page: String(page), page_size: "25" })
      const response = await fetch(`/api/hr/employees?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { employees?: Employee[]; pagination?: { totalPages: number } }
      if (!response.ok) throw new Error("فشل تحميل الموظفين")
      setRows(data.employees ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الموظفين")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, page, query, statusFilter])

  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t) }, [load])

  const resetForm = () => { setForm(defaultForm); setEditing(null) }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("اسم الموظف مطلوب"); return }
    try {
      const body = { ...form, pharmacy_id: auth.activePharmacyId, salary: Number(form.salary) || 0 }
      if (editing) {
        const response = await fetch("/api/hr/employees", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: editing.id }) })
        if (!response.ok) throw new Error("فشل تحديث الموظف")
        toast.success("تم تحديث الموظف")
      } else {
        const response = await fetch("/api/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        if (!response.ok) throw new Error("فشل إضافة الموظف")
        toast.success("تم إضافة الموظف")
      }
      setOpen(false); resetForm(); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("تأكيد حذف الموظف؟")) return
    try {
      const response = await fetch(`/api/hr/employees?id=${id}&pharmacy_id=${auth.activePharmacyId}`, { method: "DELETE" })
      if (!response.ok) throw new Error("فشل حذف الموظف")
      toast.success("تم حذف الموظف"); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    }
  }

  const openEdit = (emp: Employee) => {
    setEditing(emp)
    setForm({ name: emp.name, phone: emp.phone ?? "", email: emp.email ?? "", position: emp.position ?? "", salary: String(emp.salary), salary_type: emp.salary_type ?? "monthly", hire_date: emp.hire_date?.split("T")[0] ?? "", national_id: emp.national_id ?? "", address: emp.address ?? "", notes: emp.notes ?? "" })
    setOpen(true)
  }

  const stats = useMemo(() => [
    ["إجمالي الموظفين", rows.length.toLocaleString("ar-EG"), "text-slate-950"],
    ["النشطاء", rows.filter((r) => r.is_active).length.toLocaleString("ar-EG"), "text-emerald-700"],
    ["غير النشطاء", rows.filter((r) => !r.is_active).length.toLocaleString("ar-EG"), "text-rose-600"],
  ], [rows])

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="إدارة الموظفين" subtitle="إدارة بيانات الموظفين والرواتب والإجازات." icon={Users} actions={
          <Button className="h-10 rounded-xl" onClick={() => { resetForm(); setOpen(true) }}><Plus className="size-4" /> إضافة موظف</Button>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="اسم أو وظيفة أو هاتف..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="active">نشط</NativeSelectOption>
              <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          {stats.map(([label, value, tone]) => (
            <Card key={label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone)}>{value}</p></CardContent></Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Users} title="لا يوجد موظفون" description="أضف أول موظف للبدء في إدارة الموارد البشرية." />
          ) : (
            <Table className="min-w-[1000px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الاسم</TableHead><TableHead className="text-right">الوظيفة</TableHead><TableHead className="text-right">الهاتف</TableHead>
                <TableHead className="text-center">الراتب</TableHead><TableHead className="text-center">النوع</TableHead><TableHead className="text-center">الحالة</TableHead>
                <TableHead className="text-center">تاريخ التوظيف</TableHead><TableHead className="text-center">تعديل</TableHead><TableHead className="text-center">حذف</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.name}</TableCell>
                  <TableCell className="font-bold">{row.position ?? "—"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-bold">{row.phone ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{Number(row.salary || 0).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{row.salary_type === "monthly" ? "شهري" : row.salary_type === "daily" ? "يومي" : row.salary_type === "hourly" ? "ساعي" : "—"}</Badge></TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", row.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{row.is_active ? "نشط" : "غير نشط"}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">{row.hire_date ? new Date(row.hire_date).toLocaleDateString("ar-EG") : "—"}</TableCell>
                  <TableCell className="text-center"><Button size="icon" variant="ghost" onClick={() => openEdit(row)}><Pencil className="size-4" /></Button></TableCell>
                  <TableCell className="text-center"><Button size="icon" variant="ghost" onClick={() => void handleDelete(row.id)}><Trash2 className="size-4 text-rose-500" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>التالي</Button></div>
          </div>
        </Card>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-black text-lg">{editing ? "تعديل موظف" : "إضافة موظف"}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">الاسم *</label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-black text-slate-700">الهاتف</label><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="h-10 rounded-xl" /></div>
                <div><label className="mb-1 block text-xs font-black text-slate-700">البريد</label><Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="h-10 rounded-xl" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-black text-slate-700">الوظيفة</label><Input value={form.position} onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))} className="h-10 rounded-xl" /></div>
                <div><label className="mb-1 block text-xs font-black text-slate-700">الراتب</label><Input type="number" value={form.salary} onChange={(e) => setForm((p) => ({ ...p, salary: e.target.value }))} className="h-10 rounded-xl" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-black text-slate-700">نوع الراتب</label>
                  <NativeSelect value={form.salary_type} onChange={(e) => setForm((p) => ({ ...p, salary_type: e.target.value }))}>
                    <NativeSelectOption value="monthly">شهري</NativeSelectOption><NativeSelectOption value="daily">يومي</NativeSelectOption><NativeSelectOption value="hourly">ساعي</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div><label className="mb-1 block text-xs font-black text-slate-700">تاريخ التوظيف</label><Input type="date" value={form.hire_date} onChange={(e) => setForm((p) => ({ ...p, hire_date: e.target.value }))} className="h-10 rounded-xl" /></div>
              </div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">الرقم القومي</label><Input value={form.national_id} onChange={(e) => setForm((p) => ({ ...p, national_id: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">العنوان</label><Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">ملاحظات</label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="h-10 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>إلغاء</Button><Button onClick={() => void handleSave()}>{editing ? "حفظ التعديلات" : "إضافة"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
