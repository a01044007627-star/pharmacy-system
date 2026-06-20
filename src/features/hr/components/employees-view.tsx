"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, Search, UserCheck, UserX, Users } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { SalaryType } from "@/domain/hr/payroll/payroll-types"
import { apiClient } from "@/lib/http/api-client"
import { cn } from "@/lib/utils"

type Employee = {
  id: string
  name: string
  phone: string | null
  email: string | null
  position: string | null
  salary: number
  salary_type: SalaryType
  hire_date: string
  is_active: boolean
  national_id: string | null
  address: string | null
  notes: string | null
}

type EmployeesResponse = {
  employees: Employee[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

type EmployeeForm = {
  name: string
  phone: string
  email: string
  position: string
  salary: string
  salary_type: SalaryType
  hire_date: string
  national_id: string
  address: string
  notes: string
  is_active: boolean
}

const salaryLabels: Record<SalaryType, string> = {
  [SalaryType.Monthly]: "شهري",
  [SalaryType.Weekly]: "أسبوعي",
  [SalaryType.Daily]: "يومي",
  [SalaryType.Hourly]: "بالساعة",
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm(): EmployeeForm {
  return {
    name: "",
    phone: "",
    email: "",
    position: "",
    salary: "0.00",
    salary_type: SalaryType.Monthly,
    hire_date: todayKey(),
    national_id: "",
    address: "",
    notes: "",
    is_active: true,
  }
}

export function EmployeesView() {
  const auth = useAuth()
  const canWrite = auth.isDeveloper || auth.isOwner || auth.can("hr:write")
  const [rows, setRows] = useState<Employee[]>([])
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<EmployeesResponse["pagination"]>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<EmployeeForm>(() => emptyForm())

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRows([])
      setLoading(auth.loading)
      return
    }

    setLoading(true)
    try {
      const data = await apiClient.get<EmployeesResponse>("/api/hr/employees", {
        query: {
          pharmacy_id: auth.activePharmacyId,
          query,
          is_active: statusFilter,
          page,
          page_size: 25,
        },
        fallbackMessage: "فشل تحميل الموظفين",
      })
      setRows(data.employees ?? [])
      setPagination(data.pagination)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الموظفين")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, auth.loading, page, query, statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const closeDialog = () => {
    setOpen(false)
    setEditing(null)
    setForm(emptyForm())
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  const openEdit = (employee: Employee) => {
    setEditing(employee)
    setForm({
      name: employee.name,
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      position: employee.position ?? "",
      salary: Number(employee.salary ?? 0).toFixed(2),
      salary_type: employee.salary_type ?? SalaryType.Monthly,
      hire_date: employee.hire_date?.slice(0, 10) || todayKey(),
      national_id: employee.national_id ?? "",
      address: employee.address ?? "",
      notes: employee.notes ?? "",
      is_active: employee.is_active,
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الموظف مطلوب")
    if (!form.position.trim()) return toast.error("الوظيفة مطلوبة")
    if (!Number.isFinite(Number(form.salary)) || Number(form.salary) < 0) return toast.error("الراتب غير صالح")
    if (!auth.activePharmacyId) return toast.error("اختر صيدلية أولًا")

    setSaving(true)
    try {
      const payload = {
        ...form,
        salary: form.salary,
        pharmacy_id: auth.activePharmacyId,
        ...(editing ? { id: editing.id } : {}),
      }
      if (editing) {
        await apiClient.patch<Employee>("/api/hr/employees", payload, { fallbackMessage: "فشل تحديث الموظف" })
        toast.success("تم تحديث بيانات الموظف")
      } else {
        await apiClient.post<Employee>("/api/hr/employees", payload, { fallbackMessage: "فشل إضافة الموظف" })
        toast.success("تمت إضافة الموظف")
      }
      closeDialog()
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ الموظف")
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (employee: Employee) => {
    if (!auth.activePharmacyId || !window.confirm(`تعطيل الموظف «${employee.name}»؟ سيظل تاريخه محفوظًا في الحضور والرواتب.`)) return
    try {
      await apiClient.delete("/api/hr/employees", {
        query: { id: employee.id, pharmacy_id: auth.activePharmacyId },
        fallbackMessage: "فشل تعطيل الموظف",
      })
      toast.success("تم تعطيل الموظف مع الاحتفاظ بسجلاته")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تعطيل الموظف")
    }
  }

  const reactivate = async (employee: Employee) => {
    if (!auth.activePharmacyId) return
    try {
      await apiClient.patch("/api/hr/employees", {
        id: employee.id,
        pharmacy_id: auth.activePharmacyId,
        is_active: true,
      }, { fallbackMessage: "فشل إعادة تفعيل الموظف" })
      toast.success("تمت إعادة تفعيل الموظف")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إعادة تفعيل الموظف")
    }
  }

  const pageSummary = useMemo(() => ({
    active: rows.filter((row) => row.is_active).length,
    inactive: rows.filter((row) => !row.is_active).length,
  }), [rows])

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="إدارة الموظفين"
          subtitle="بيانات الموظفين، حالة العمل، وأنواع الأجر المرتبطة بكشوف الرواتب."
          icon={Users}
          actions={canWrite ? <Button className="h-10 rounded-xl" onClick={openCreate}><Plus className="size-4" /> إضافة موظف</Button> : null}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="اسم أو وظيفة أو هاتف أو بريد..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="active">نشط</NativeSelectOption>
              <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="إجمالي النتائج" value={pagination.total} />
          <Summary label="النشطاء في الصفحة" value={pageSummary.active} tone="text-emerald-700" />
          <Summary label="غير النشطاء في الصفحة" value={pageSummary.inactive} tone="text-rose-600" />
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Users} title="لا يوجد موظفون" description="لا توجد نتائج مطابقة أو لم تتم إضافة موظفين بعد." />
          ) : (
            <Table className="min-w-[1040px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-right">الوظيفة</TableHead>
                <TableHead className="text-right">الهاتف</TableHead>
                <TableHead className="text-center">الأجر</TableHead>
                <TableHead className="text-center">النوع</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="text-center">تاريخ التوظيف</TableHead>
                {canWrite ? <TableHead className="text-center">الإجراءات</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.name}</TableCell>
                  <TableCell className="font-bold">{row.position ?? "—"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-bold">{row.phone ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{Number(row.salary || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{salaryLabels[row.salary_type] ?? "—"}</Badge></TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", row.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{row.is_active ? "نشط" : "غير نشط"}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">{row.hire_date ? new Date(`${row.hire_date.slice(0, 10)}T00:00:00`).toLocaleDateString("ar-EG") : "—"}</TableCell>
                  {canWrite ? (
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button size="icon" variant="ghost" aria-label="تعديل الموظف" onClick={() => openEdit(row)}><Pencil className="size-4" /></Button>
                        {row.is_active ? (
                          <Button size="icon" variant="ghost" aria-label="تعطيل الموظف" onClick={() => void deactivate(row)}><UserX className="size-4 text-rose-500" /></Button>
                        ) : (
                          <Button size="icon" variant="ghost" aria-label="إعادة تفعيل الموظف" onClick={() => void reactivate(row)}><UserCheck className="size-4 text-emerald-600" /></Button>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {pagination.page.toLocaleString("ar-EG")} من {pagination.totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <Button size="sm" variant="outline" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </div>
        </Card>

        <Dialog open={open} onOpenChange={(value) => { if (!value) closeDialog(); else setOpen(true) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="text-lg font-black">{editing ? "تعديل موظف" : "إضافة موظف"}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <Field label="الاسم *"><Input value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="الوظيفة *"><Input value={form.position} onChange={(event) => setForm((previous) => ({ ...previous, position: event.target.value }))} /></Field>
                <Field label="الأجر"><Input type="number" min="0" step="0.01" value={form.salary} onChange={(event) => setForm((previous) => ({ ...previous, salary: event.target.value }))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="نوع الأجر">
                  <NativeSelect value={form.salary_type} onChange={(event) => setForm((previous) => ({ ...previous, salary_type: event.target.value as SalaryType }))}>
                    {Object.values(SalaryType).map((type) => <NativeSelectOption key={type} value={type}>{salaryLabels[type]}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
                <Field label="تاريخ التوظيف"><Input type="date" value={form.hire_date} onChange={(event) => setForm((previous) => ({ ...previous, hire_date: event.target.value }))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="الهاتف"><Input value={form.phone} onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))} /></Field>
                <Field label="البريد"><Input type="email" value={form.email} onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))} /></Field>
              </div>
              <Field label="الرقم القومي"><Input value={form.national_id} onChange={(event) => setForm((previous) => ({ ...previous, national_id: event.target.value }))} /></Field>
              <Field label="العنوان"><Input value={form.address} onChange={(event) => setForm((previous) => ({ ...previous, address: event.target.value }))} /></Field>
              <Field label="ملاحظات"><Input value={form.notes} onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))} /></Field>
              {editing ? (
                <Field label="حالة الموظف">
                  <NativeSelect value={form.is_active ? "active" : "inactive"} onChange={(event) => setForm((previous) => ({ ...previous, is_active: event.target.value === "active" }))}>
                    <NativeSelectOption value="active">نشط</NativeSelectOption>
                    <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
                  </NativeSelect>
                </Field>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={closeDialog}>إلغاء</Button>
              <Button disabled={saving} onClick={() => void save()}>{saving ? "جارٍ الحفظ..." : editing ? "حفظ التعديلات" : "إضافة"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}

function Summary({ label, value, tone = "text-slate-950" }: { label: string; value: number; tone?: string }) {
  return <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone)}>{value.toLocaleString("ar-EG")}</p></CardContent></Card>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-black text-slate-700">{label}</label><div className="[&_input]:h-10 [&_input]:rounded-xl">{children}</div></div>
}
