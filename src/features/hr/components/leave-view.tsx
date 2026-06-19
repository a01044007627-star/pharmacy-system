"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarClock, Check, RefreshCw, X } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type LeaveRecord = {
  id: string
  employee_id: string
  date: string
  leave_reason: string | null
  leave_status: string | null
  employee: { id: string; name: string; position: string | null } | null
}

export function LeaveView() {
  const auth = useAuth()
  const [records, setRecords] = useState<LeaveRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ employee_id: "", date: new Date().toISOString().split("T")[0], reason: "" })
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, status: statusFilter })
      const response = await fetch(`/api/hr/leave?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { records?: LeaveRecord[] }
      if (!response.ok) throw new Error("فشل تحميل الإجازات")
      setRecords(data.records ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الإجازات")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, statusFilter])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!auth.activePharmacyId) return
    fetch(`/api/hr/employees?pharmacy_id=${auth.activePharmacyId}&page_size=500`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEmployees((d.employees ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))))
      .catch(() => {})
  }, [auth.activePharmacyId])

  const handleAdd = async () => {
    if (!form.employee_id) { toast.error("اختر الموظف"); return }
    try {
      const response = await fetch("/api/hr/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, pharmacy_id: auth.activePharmacyId }) })
      if (!response.ok) throw new Error("فشل تسجيل الإجازة")
      toast.success("تم تسجيل الإجازة"); setOpen(false); setForm({ employee_id: "", date: new Date().toISOString().split("T")[0], reason: "" }); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الإجازة")
    }
  }

  const handleStatus = async (id: string, status: string) => {
    try {
      const response = await fetch("/api/hr/leave", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status, pharmacy_id: auth.activePharmacyId }) })
      if (!response.ok) throw new Error("فشل تحديث الإجازة")
      toast.success(status === "approved" ? "تم الموافقة" : "تم الرفض"); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل التحديث")
    }
  }

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="إدارة الإجازات" subtitle="إجازات الموظفين والموافقة عليها." icon={CalendarClock} actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {auth.can("hr:write") ? <Button className="h-10 rounded-xl" onClick={() => setOpen(true)}>طلب إجازة</Button> : null}
          </>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <NativeSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
              <NativeSelectOption value="all">كل الإجازات</NativeSelectOption>
              <NativeSelectOption value="pending">قيد الانتظار</NativeSelectOption>
              <NativeSelectOption value="approved">موافَق</NativeSelectOption>
              <NativeSelectOption value="rejected">مرفوض</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : records.length === 0 ? (
            <EmptyState icon={CalendarClock} title="لا توجد إجازات" description="لم يتم تسجيل أي إجازات بعد." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الموظف</TableHead><TableHead className="text-right">الوظيفة</TableHead><TableHead className="text-center">التاريخ</TableHead>
                <TableHead className="text-center">السبب</TableHead><TableHead className="text-center">الحالة</TableHead>
                {auth.can("hr:write") ? <TableHead className="text-center">إجراء</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>{records.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.employee?.name ?? "—"}</TableCell>
                  <TableCell className="font-bold">{row.employee?.position ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.date).toLocaleDateString("ar-EG")}</TableCell>
                  <TableCell className="text-center text-xs font-bold max-w-[200px] truncate">{row.leave_reason ?? "—"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={cn("font-black", row.leave_status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : row.leave_status === "rejected" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                      {row.leave_status === "approved" ? "موافَق" : row.leave_status === "rejected" ? "مرفوض" : "قيد الانتظار"}
                    </Badge>
                  </TableCell>
                  {auth.can("hr:write") ? (
                    <TableCell className="text-center">
                      {row.leave_status === "pending" ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button size="icon" variant="ghost" className="text-emerald-600" onClick={() => void handleStatus(row.id, "approved")}><Check className="size-4" /></Button>
                          <Button size="icon" variant="ghost" className="text-rose-600" onClick={() => void handleStatus(row.id, "rejected")}><X className="size-4" /></Button>
                        </div>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-black text-lg">طلب إجازة</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">الموظف</label>
                <NativeSelect value={form.employee_id} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))}>
                  <NativeSelectOption value="">اختر موظفاً</NativeSelectOption>
                  {employees.map((emp) => <NativeSelectOption key={emp.id} value={emp.id}>{emp.name}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">التاريخ</label><Input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="h-10 rounded-xl" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">السبب</label><Input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} className="h-10 rounded-xl" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button onClick={() => void handleAdd()}>إرسال الطلب</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
