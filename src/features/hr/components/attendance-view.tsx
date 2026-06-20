"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Clock, RefreshCw, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { AttendanceStatus } from "@/domain/hr/hr-types"
import { apiClient } from "@/lib/http/api-client"
import { cn } from "@/lib/utils"

type AttendanceRecord = {
  id: string
  employee_id: string
  date_key: string
  check_in: string
  check_out: string | null
  hours_worked: number | null
  status: AttendanceStatus
  employee: { id: string; name: string; position: string | null } | null
}

type EmployeeOption = { id: string; name: string }
type EmployeeResponse = { employees: EmployeeOption[] }

const statusLabels: Record<AttendanceStatus, string> = {
  [AttendanceStatus.Present]: "حاضر",
  [AttendanceStatus.Late]: "متأخر",
  [AttendanceStatus.Absent]: "غائب",
  [AttendanceStatus.Excused]: "مُعذَر",
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export function AttendanceView() {
  const auth = useAuth()
  const canWrite = auth.isDeveloper || auth.isOwner || auth.can("hr:write")
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [employeeId, setEmployeeId] = useState("all")
  const [date, setDate] = useState("")
  const [statusOverride, setStatusOverride] = useState<"auto" | AttendanceStatus.Excused>("auto")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRecords([])
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.get<{ records: AttendanceRecord[] }>("/api/hr/attendance", {
        query: {
          pharmacy_id: auth.activePharmacyId,
          employee_id: employeeId === "all" ? undefined : employeeId,
          date: date || undefined,
        },
        fallbackMessage: "فشل تحميل الحضور",
      })
      setRecords(data.records ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الحضور")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, auth.loading, date, employeeId])

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

  const checkIn = async () => {
    if (employeeId === "all") return toast.error("اختر الموظف أولًا")
    if (!auth.activePharmacyId) return toast.error("اختر صيدلية أولًا")
    setSubmitting(true)
    try {
      const record = await apiClient.post<AttendanceRecord>("/api/hr/attendance", {
        pharmacy_id: auth.activePharmacyId,
        employee_id: employeeId,
        action: "check-in",
        status: statusOverride === "auto" ? null : statusOverride,
      }, { fallbackMessage: "فشل تسجيل الحضور" })
      toast.success(record.status === AttendanceStatus.Late ? "تم تسجيل الحضور كمتأخر" : "تم تسجيل الحضور")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الحضور")
    } finally {
      setSubmitting(false)
    }
  }

  const checkOut = async (record: AttendanceRecord) => {
    if (!auth.activePharmacyId) return
    setSubmitting(true)
    try {
      await apiClient.post("/api/hr/attendance", {
        pharmacy_id: auth.activePharmacyId,
        employee_id: record.employee_id,
        action: "check-out",
      }, { fallbackMessage: "فشل تسجيل الانصراف" })
      toast.success("تم تسجيل الانصراف")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الانصراف")
    } finally {
      setSubmitting(false)
    }
  }

  const summary = useMemo(() => ({
    open: records.filter((record) => !record.check_out).length,
    late: records.filter((record) => record.status === AttendanceStatus.Late).length,
    hours: records.reduce((sum, record) => sum + Number(record.hours_worked ?? 0), 0),
  }), [records])

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="الحضور والانصراف"
          subtitle="الحالة تُحتسب تلقائيًا من موعد الوردية وفترة السماح المسجلة بالإعدادات."
          icon={Clock}
          actions={<>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {canWrite ? <Button className="h-10 rounded-xl" disabled={submitting} onClick={() => void checkIn()}><UserCheck className="size-4" /> تسجيل دخول</Button> : null}
          </>}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <NativeSelect value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <NativeSelectOption value="all">كل الموظفين</NativeSelectOption>
            {employees.map((employee) => <NativeSelectOption key={employee.id} value={employee.id}>{employee.name}</NativeSelectOption>)}
          </NativeSelect>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} max={todayKey()} className="h-10 rounded-xl" />
          {canWrite ? <NativeSelect value={statusOverride} onChange={(event) => setStatusOverride(event.target.value as typeof statusOverride)}>
            <NativeSelectOption value="auto">تحديد الحالة تلقائيًا</NativeSelectOption>
            <NativeSelectOption value={AttendanceStatus.Excused}>حضور بعذر معتمد</NativeSelectOption>
          </NativeSelect> : <div />}
        </CardContent></Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="لم يسجلوا خروجًا" value={summary.open} />
          <Summary label="حضور متأخر" value={summary.late} tone="text-amber-700" />
          <Summary label="إجمالي الساعات المعروضة" value={summary.hours} tone="text-brand" fraction />
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : records.length === 0 ? (
            <EmptyState icon={Clock} title="لا توجد سجلات حضور" description="لا توجد سجلات مطابقة للمرشحات المختارة." />
          ) : (
            <Table className="min-w-[1000px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الموظف</TableHead>
                <TableHead className="text-right">الوظيفة</TableHead>
                <TableHead className="text-center">التاريخ</TableHead>
                <TableHead className="text-center">دخول</TableHead>
                <TableHead className="text-center">خروج</TableHead>
                <TableHead className="text-center">الساعات</TableHead>
                <TableHead className="text-center">حالة الحضور</TableHead>
                {canWrite ? <TableHead className="text-center">الإجراء</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>{records.map((record) => {
                const clockIn = new Date(record.check_in)
                const clockOut = record.check_out ? new Date(record.check_out) : null
                return <TableRow key={record.id}>
                  <TableCell className="font-black text-brand">{record.employee?.name ?? "—"}</TableCell>
                  <TableCell className="font-bold">{record.employee?.position ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(`${record.date_key}T00:00:00`).toLocaleDateString("ar-EG")}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{clockIn.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{clockOut ? clockOut.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                  <TableCell className="text-center font-black">{record.hours_worked == null ? "—" : Number(record.hours_worked).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-center"><AttendanceBadge status={record.status} open={!clockOut} /></TableCell>
                  {canWrite ? <TableCell className="text-center">{!clockOut ? <Button size="sm" variant="outline" disabled={submitting} onClick={() => void checkOut(record)}>تسجيل خروج</Button> : <span className="text-xs text-slate-400">مغلق</span>}</TableCell> : null}
                </TableRow>
              })}</TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}

function Summary({ label, value, tone = "text-slate-950", fraction = false }: { label: string; value: number; tone?: string; fraction?: boolean }) {
  return <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone)}>{value.toLocaleString("ar-EG", { maximumFractionDigits: fraction ? 2 : 0 })}</p></CardContent></Card>
}

function AttendanceBadge({ status, open }: { status: AttendanceStatus; open: boolean }) {
  const tone = status === AttendanceStatus.Late
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : status === AttendanceStatus.Absent
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : status === AttendanceStatus.Excused
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700"
  return <div className="flex items-center justify-center gap-1"><Badge variant="outline" className={cn("font-black", tone)}>{statusLabels[status] ?? status}</Badge>{open ? <Badge variant="outline" className="font-black">داخل الوردية</Badge> : null}</div>
}
