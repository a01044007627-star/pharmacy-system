"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Ban, CalendarClock, Check, RefreshCw, X } from "lucide-react"
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
import { LeaveStatus, LeaveType } from "@/domain/hr/hr-types"
import { leaveWorkflow } from "@/domain/hr/leave-workflow"
import { apiClient } from "@/lib/http/api-client"
import { cn } from "@/lib/utils"

type LeaveRecord = {
  id: string
  employee_id: string
  type: LeaveType
  start_date: string
  end_date: string
  days_used: number
  reason: string | null
  status: LeaveStatus
  employee: { id: string; name: string; position: string | null } | null
}

type EmployeeOption = { id: string; name: string }
type EmployeeResponse = { employees: EmployeeOption[] }

type LeaveForm = {
  employee_id: string
  type: LeaveType
  start_date: string
  end_date: string
  reason: string
}

const leaveTypeLabels: Record<LeaveType, string> = {
  [LeaveType.Annual]: "سنوية",
  [LeaveType.Sick]: "مرضية",
  [LeaveType.Emergency]: "عارضة",
  [LeaveType.Unpaid]: "بدون راتب",
}

const leaveStatusLabels: Record<LeaveStatus, string> = {
  [LeaveStatus.Pending]: "قيد الانتظار",
  [LeaveStatus.Approved]: "معتمد",
  [LeaveStatus.Rejected]: "مرفوض",
  [LeaveStatus.Cancelled]: "ملغي",
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function defaultForm(): LeaveForm {
  const today = todayKey()
  return { employee_id: "", type: LeaveType.Annual, start_date: today, end_date: today, reason: "" }
}

export function LeaveView() {
  const auth = useAuth()
  const canWrite = auth.isDeveloper || auth.isOwner || auth.can("hr:write")
  const [records, setRecords] = useState<LeaveRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | LeaveStatus>("all")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LeaveForm>(() => defaultForm())

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRecords([])
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.get<{ records: LeaveRecord[] }>("/api/hr/leave", {
        query: { pharmacy_id: auth.activePharmacyId, status: statusFilter },
        fallbackMessage: "فشل تحميل الإجازات",
      })
      setRecords(data.records ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الإجازات")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, auth.loading, statusFilter])

  const loadEmployees = useCallback(async () => {
    if (!auth.activePharmacyId) return setEmployees([])
    try {
      const data = await apiClient.get<EmployeeResponse>("/api/hr/employees", {
        query: { pharmacy_id: auth.activePharmacyId, is_active: "active", page_size: 100 },
        fallbackMessage: "فشل تحميل الموظفين",
      })
      setEmployees(data.employees ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الموظفين")
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadEmployees() }, [loadEmployees])

  const createLeave = async () => {
    if (!form.employee_id) return toast.error("اختر الموظف")
    if (!form.start_date || !form.end_date) return toast.error("حدد فترة الإجازة")
    if (form.end_date < form.start_date) return toast.error("تاريخ النهاية يجب ألا يسبق البداية")
    if (!auth.activePharmacyId) return toast.error("اختر صيدلية أولًا")

    setSaving(true)
    try {
      await apiClient.post("/api/hr/leave", {
        ...form,
        pharmacy_id: auth.activePharmacyId,
      }, { fallbackMessage: "فشل تسجيل الإجازة" })
      toast.success("تم إنشاء طلب الإجازة كطلب قيد المراجعة")
      setOpen(false)
      setForm(defaultForm())
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الإجازة")
    } finally {
      setSaving(false)
    }
  }

  const transition = async (record: LeaveRecord, status: LeaveStatus) => {
    if (!auth.activePharmacyId) return
    try {
      await apiClient.patch("/api/hr/leave", {
        id: record.id,
        status,
        pharmacy_id: auth.activePharmacyId,
      }, { fallbackMessage: "فشل تحديث الإجازة" })
      toast.success(status === LeaveStatus.Approved ? "تم اعتماد الإجازة" : status === LeaveStatus.Rejected ? "تم رفض الإجازة" : "تم إلغاء الإجازة")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث الإجازة")
    }
  }

  const summary = useMemo(() => ({
    pending: records.filter((record) => record.status === LeaveStatus.Pending).length,
    approved: records.filter((record) => record.status === LeaveStatus.Approved).length,
    totalDays: records.filter((record) => record.status === LeaveStatus.Approved).reduce((sum, record) => sum + Number(record.days_used || 0), 0),
  }), [records])

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="إدارة الإجازات"
          subtitle="طلبات إجازة متعددة الأيام مع دورة اعتماد وإلغاء مضبوطة."
          icon={CalendarClock}
          actions={<>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {canWrite ? <Button className="h-10 rounded-xl" onClick={() => setOpen(true)}>طلب إجازة</Button> : null}
          </>}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="قيد المراجعة" value={summary.pending} />
          <Summary label="المعتمدة في النتائج" value={summary.approved} tone="text-emerald-700" />
          <Summary label="أيام الإجازات المعتمدة" value={summary.totalDays} tone="text-brand" />
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-4">
          <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="max-w-xs">
            <NativeSelectOption value="all">كل الإجازات</NativeSelectOption>
            {Object.values(LeaveStatus).map((status) => <NativeSelectOption key={status} value={status}>{leaveStatusLabels[status]}</NativeSelectOption>)}
          </NativeSelect>
        </CardContent></Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : records.length === 0 ? (
            <EmptyState icon={CalendarClock} title="لا توجد إجازات" description="لا توجد طلبات مطابقة للحالة المختارة." />
          ) : (
            <Table className="min-w-[1050px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الموظف</TableHead>
                <TableHead className="text-right">الوظيفة</TableHead>
                <TableHead className="text-center">النوع</TableHead>
                <TableHead className="text-center">الفترة</TableHead>
                <TableHead className="text-center">الأيام</TableHead>
                <TableHead className="text-center">السبب</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                {canWrite ? <TableHead className="text-center">الإجراء</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>{records.map((record) => {
                const next = leaveWorkflow.next(record.status)
                return <TableRow key={record.id}>
                  <TableCell className="font-black text-brand">{record.employee?.name ?? "—"}</TableCell>
                  <TableCell className="font-bold">{record.employee?.position ?? "—"}</TableCell>
                  <TableCell className="text-center font-bold">{leaveTypeLabels[record.type] ?? record.type}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{formatDate(record.start_date)} — {formatDate(record.end_date)}</TableCell>
                  <TableCell className="text-center font-black">{Number(record.days_used || 0).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-center text-xs font-bold">{record.reason ?? "—"}</TableCell>
                  <TableCell className="text-center"><StatusBadge status={record.status} /></TableCell>
                  {canWrite ? <TableCell className="text-center"><div className="flex items-center justify-center gap-1">
                    {next.includes(LeaveStatus.Approved) ? <Button size="icon" variant="ghost" aria-label="اعتماد" className="text-emerald-600" onClick={() => void transition(record, LeaveStatus.Approved)}><Check className="size-4" /></Button> : null}
                    {next.includes(LeaveStatus.Rejected) ? <Button size="icon" variant="ghost" aria-label="رفض" className="text-rose-600" onClick={() => void transition(record, LeaveStatus.Rejected)}><X className="size-4" /></Button> : null}
                    {next.includes(LeaveStatus.Cancelled) ? <Button size="icon" variant="ghost" aria-label="إلغاء" className="text-slate-500" onClick={() => void transition(record, LeaveStatus.Cancelled)}><Ban className="size-4" /></Button> : null}
                    {next.length === 0 ? <span className="text-xs text-slate-400">مغلق</span> : null}
                  </div></TableCell> : null}
                </TableRow>
              })}</TableBody>
            </Table>
          )}
        </Card>

        <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setForm(defaultForm()) }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-lg font-black">طلب إجازة</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <Field label="الموظف *"><NativeSelect value={form.employee_id} onChange={(event) => setForm((previous) => ({ ...previous, employee_id: event.target.value }))}><NativeSelectOption value="">اختر موظفًا</NativeSelectOption>{employees.map((employee) => <NativeSelectOption key={employee.id} value={employee.id}>{employee.name}</NativeSelectOption>)}</NativeSelect></Field>
              <Field label="نوع الإجازة"><NativeSelect value={form.type} onChange={(event) => setForm((previous) => ({ ...previous, type: event.target.value as LeaveType }))}>{Object.values(LeaveType).map((type) => <NativeSelectOption key={type} value={type}>{leaveTypeLabels[type]}</NativeSelectOption>)}</NativeSelect></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="من *"><Input type="date" value={form.start_date} onChange={(event) => setForm((previous) => ({ ...previous, start_date: event.target.value, end_date: previous.end_date < event.target.value ? event.target.value : previous.end_date }))} /></Field>
                <Field label="إلى *"><Input type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm((previous) => ({ ...previous, end_date: event.target.value }))} /></Field>
              </div>
              <Field label="السبب"><Input value={form.reason} onChange={(event) => setForm((previous) => ({ ...previous, reason: event.target.value }))} /></Field>
            </div>
            <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>إلغاء</Button><Button disabled={saving} onClick={() => void createLeave()}>{saving ? "جارٍ الحفظ..." : "إرسال الطلب"}</Button></DialogFooter>
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

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("ar-EG")
}

function StatusBadge({ status }: { status: LeaveStatus }) {
  const tone = status === LeaveStatus.Approved
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === LeaveStatus.Rejected
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : status === LeaveStatus.Cancelled
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700"
  return <Badge variant="outline" className={cn("font-black", tone)}>{leaveStatusLabels[status]}</Badge>
}
