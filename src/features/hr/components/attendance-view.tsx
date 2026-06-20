"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, RefreshCw, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type AttendanceRecord = {
  id: string
  employee_id: string
  date_key: string
  check_in: string
  check_out: string | null
  hours_worked: number | null
  status: string
  employee: { id: string; name: string; position: string | null } | null
}

export function AttendanceView() {
  const auth = useAuth()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState("all")
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRecords([])
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId })
      if (employeeId !== "all") params.set("employee_id", employeeId)
      const response = await fetch(`/api/hr/attendance?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { records?: AttendanceRecord[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الحضور")
      setRecords(data.records ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الحضور")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, auth.loading, employeeId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!auth.activePharmacyId) return
    fetch(`/api/hr/employees?pharmacy_id=${auth.activePharmacyId}&page_size=500`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEmployees((d.employees ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))))
      .catch(() => {})
  }, [auth.activePharmacyId])

  const checkIn = async () => {
    if (employeeId === "all") {
      toast.error("اختر الموظف أولًا")
      return
    }
    const empId = employeeId
    try {
      const response = await fetch("/api/hr/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, employee_id: empId, action: "check-in" }) })
      if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "فشل") }
      toast.success("تم تسجيل الحضور"); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الحضور")
    }
  }

  const checkOut = async (employeeId: string) => {
    try {
      const response = await fetch("/api/hr/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, employee_id: employeeId, action: "check-out" }) })
      if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "فشل") }
      toast.success("تم تسجيل الانصراف"); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الانصراف")
    }
  }

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="الحضور والانصراف" subtitle="تسجيل ومتابعة حضور الموظفين." icon={Clock} actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {auth.can("hr:write") ? <Button className="h-10 rounded-xl" onClick={() => void checkIn()}><UserCheck className="size-4" /> تسجيل دخول</Button> : null}
          </>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <NativeSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="max-w-xs">
              <NativeSelectOption value="all">كل الموظفين</NativeSelectOption>
              {employees.map((emp) => <NativeSelectOption key={emp.id} value={emp.id}>{emp.name}</NativeSelectOption>)}
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : records.length === 0 ? (
            <EmptyState icon={Clock} title="لا توجد سجلات حضور" description="سجل حضور الموظفين لمتابعة دوامهم." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الموظف</TableHead><TableHead className="text-right">الوظيفة</TableHead><TableHead className="text-center">التاريخ</TableHead>
                <TableHead className="text-center">دخول</TableHead><TableHead className="text-center">خروج</TableHead><TableHead className="text-center">الحالة</TableHead>
                {auth.can("hr:write") ? <TableHead className="text-center">إجراء</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>{records.map((row) => {
                const clockIn = new Date(row.check_in)
                const clockOut = row.check_out ? new Date(row.check_out) : null
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-black text-brand">{row.employee?.name ?? "—"}</TableCell>
                    <TableCell className="font-bold">{row.employee?.position ?? "—"}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(`${row.date_key}T00:00:00`).toLocaleDateString("ar-EG")}</TableCell>
                    <TableCell className="text-center text-xs font-bold dir-left">{clockIn.toLocaleTimeString("ar-EG")}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{clockOut ? clockOut.toLocaleTimeString("ar-EG") : "—"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", clockOut ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{clockOut ? "منصرف" : "حاضر"}</Badge></TableCell>
                    {auth.can("hr:write") ? (
                      <TableCell className="text-center">{!clockOut ? <Button size="sm" variant="outline" onClick={() => void checkOut(row.employee_id)}>تسجيل خروج</Button> : null}</TableCell>
                    ) : null}
                  </TableRow>
                )
              })}</TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
