"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DollarSign, RefreshCw, Wallet } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type PayrollEmployee = {
  id: string
  name: string
  phone: string | null
  position: string | null
  salary: number
  salary_type: string
  is_active: boolean
}

export function PayrollView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [employees, setEmployees] = useState<PayrollEmployee[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/hr/payroll?pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { employees?: PayrollEmployee[]; summary?: { total: number; total_salary: number } }
      if (!response.ok) throw new Error("فشل تحميل الرواتب")
      setEmployees(data.employees ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الرواتب")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const total = employees.length
    const active = employees.filter((e) => e.is_active).length
    const totalSalary = employees.reduce((s, e) => s + Math.max(0, Number(e.salary || 0)), 0)
    return { total, active, totalSalary }
  }, [employees])

  const generatePayroll = async () => {
    try {
      const response = await fetch("/api/hr/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pharmacy_id: auth.activePharmacyId }) })
      if (!response.ok) throw new Error("فشل إنشاء كشف الرواتب")
      toast.success("تم إنشاء كشف الرواتب")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إنشاء كشف الرواتب")
    }
  }

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="الرواتب والأجور" subtitle="إدارة رواتب الموظفين وإنشاء كشوف الرواتب." icon={Wallet} actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {auth.can("hr:write") ? <Button className="h-10 rounded-xl" onClick={() => void generatePayroll()}><DollarSign className="size-4" /> إنشاء كشف رواتب</Button> : null}
          </>
        } />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي الموظفين</p><p className="mt-2 text-xl font-black text-slate-950">{summary.total.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">النشطاء</p><p className="mt-2 text-xl font-black text-emerald-700">{summary.active.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي الرواتب</p><p className="mt-2 text-xl font-black text-brand">{Number(summary.totalSalary).toLocaleString("ar-EG")} {currency}</p></CardContent></Card>
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : employees.length === 0 ? (
            <EmptyState icon={Wallet} title="لا يوجد موظفون" description="أضف موظفين أولاً لإدارة الرواتب." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الاسم</TableHead><TableHead className="text-right">الوظيفة</TableHead><TableHead className="text-center">الراتب</TableHead><TableHead className="text-center">النوع</TableHead><TableHead className="text-center">الحالة</TableHead>
              </TableRow></TableHeader>
              <TableBody>{employees.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.name}</TableCell>
                  <TableCell className="font-bold">{row.position ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{Number(row.salary || 0).toLocaleString("ar-EG")} {currency}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{row.salary_type === "monthly" ? "شهري" : row.salary_type === "daily" ? "يومي" : row.salary_type === "hourly" ? "ساعي" : "—"}</Badge></TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", row.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{row.is_active ? "نشط" : "غير نشط"}</Badge></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
