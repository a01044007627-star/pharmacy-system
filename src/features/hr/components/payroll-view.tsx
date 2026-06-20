"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, DollarSign, RefreshCw, Wallet, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { PayrollRunStatus } from "@/domain/hr/payroll/payroll-types"
import { apiClient } from "@/lib/http/api-client"
import { cn } from "@/lib/utils"
import { PayrollLineAdjustmentDialog, type PayrollAdjustmentLine } from "./payroll-line-adjustment-dialog"

type PayrollRun = {
  id: string
  period: string
  run_number: string
  status: PayrollRunStatus
  total_base: number
  total_additions: number
  total_deductions: number
  total_gross: number
  total_net: number
  payment_method: string | null
  approved_at: string | null
  paid_at: string | null
  created_at: string
}

type PayrollLine = PayrollAdjustmentLine & {
  employee_id: string
  position: string | null
  salary_type: string
  salary_rate: number
  scheduled_days: number
  payable_days: number
  absent_days: number
  paid_leave_days: number
  unpaid_leave_days: number
  worked_hours: number
}

type Option = { value: string; label: string }
type PayrollResponse = {
  period: string
  run: PayrollRun | null
  lines: PayrollLine[]
  runs: PayrollRun[]
  statuses: Option[]
  payment_methods: Option[]
  allowed_statuses: PayrollRunStatus[]
}

export function PayrollView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [period, setPeriod] = useState(currentPeriod())
  const [data, setData] = useState<PayrollResponse | null>(null)
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setData(null)
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const response = await apiClient.get<PayrollResponse>("/api/hr/payroll", {
        query: { pharmacy_id: auth.activePharmacyId, period },
        fallbackMessage: "فشل تحميل الرواتب",
      })
      setData(response)
      setPaymentMethod(response.run?.payment_method ?? "cash")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الرواتب")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, auth.loading, period])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => ({
    employees: data?.lines.length ?? 0,
    gross: Number(data?.run?.total_gross ?? 0),
    deductions: Number(data?.run?.total_deductions ?? 0),
    net: Number(data?.run?.total_net ?? 0),
  }), [data])

  async function generate() {
    if (!auth.activePharmacyId) return
    setSaving(true)
    try {
      await apiClient.post("/api/hr/payroll", {
        pharmacy_id: auth.activePharmacyId,
        period,
        client_request_id: crypto.randomUUID(),
      }, { fallbackMessage: "فشل إنشاء كشف الرواتب" })
      toast.success("تم إنشاء مسودة كشف الرواتب")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إنشاء كشف الرواتب")
    } finally {
      setSaving(false)
    }
  }

  async function runAction(action: "approve" | "cancel" | "pay") {
    if (!auth.activePharmacyId || !data?.run) return
    const prompt = action === "approve"
      ? "اعتماد الكشف سيمنع تعديل بنوده. هل تريد المتابعة؟"
      : action === "pay"
        ? "سيتم تسجيل الصرف والقيد المالي. هل تريد المتابعة؟"
        : "هل تريد إلغاء كشف الرواتب؟"
    if (!window.confirm(prompt)) return

    setSaving(true)
    try {
      await apiClient.patch("/api/hr/payroll", {
        action,
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId,
        run_id: data.run.id,
        payment_method: paymentMethod,
      }, { fallbackMessage: "فشل تحديث كشف الرواتب" })
      toast.success(action === "approve" ? "تم اعتماد كشف الرواتب" : action === "pay" ? "تم صرف كشف الرواتب" : "تم إلغاء كشف الرواتب")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث كشف الرواتب")
    } finally {
      setSaving(false)
    }
  }

  const run = data?.run ?? null
  const canWrite = auth.isDeveloper || auth.can("hr:write")
  const canPay = canWrite && (auth.isDeveloper || auth.can("financials:write"))

  return (
    <PageAccess permission="hr:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="الرواتب والأجور" subtitle="إنشاء واعتماد وصرف كشوف الرواتب مع ربط الحضور والإجازات والحسابات." icon={Wallet} actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-40 rounded-xl" />
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading || saving}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {canWrite && !run ? <Button className="h-10 rounded-xl" onClick={() => void generate()} disabled={saving}><DollarSign className="size-4" /> إنشاء مسودة</Button> : null}
          </div>
        } />

        {data?.runs?.length ? (
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-xs font-black text-slate-500">الكشوف الأخيرة:</span>
            {data.runs.slice(0, 8).map((history) => (
              <Button key={history.id} size="sm" variant={history.period === period ? "default" : "outline"} className="h-8 rounded-xl" onClick={() => setPeriod(history.period)}>
                {history.period} · {statusLabel(history.status)}
              </Button>
            ))}
          </CardContent></Card>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="الموظفون" value={summary.employees.toLocaleString("ar-EG")} />
          <SummaryCard label="إجمالي الاستحقاق" value={money(summary.gross, currency)} />
          <SummaryCard label="الخصومات" value={money(summary.deductions, currency)} tone="rose" />
          <SummaryCard label="صافي الرواتب" value={money(summary.net, currency)} tone="emerald" />
        </div>

        {run ? (
          <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="font-black text-brand">{run.run_number}</span><StatusBadge status={run.status} /></div>
              <p className="mt-1 text-xs font-bold text-slate-500">فترة {run.period} · أُنشئ {new Date(run.created_at).toLocaleString("ar-EG")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canWrite && run.status === PayrollRunStatus.Draft ? <Button className="rounded-xl" disabled={saving} onClick={() => void runAction("approve")}><CheckCircle2 className="size-4" /> اعتماد</Button> : null}
              {canPay && run.status === PayrollRunStatus.Approved ? (
                <>
                  <NativeSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="w-40">
                    {(data?.payment_methods ?? []).map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
                  </NativeSelect>
                  <Button className="rounded-xl" disabled={saving} onClick={() => void runAction("pay")}><DollarSign className="size-4" /> صرف وتسجيل القيد</Button>
                </>
              ) : null}
              {canWrite && [PayrollRunStatus.Draft, PayrollRunStatus.Approved].includes(run.status) ? <Button variant="destructive" className="rounded-xl" disabled={saving} onClick={() => void runAction("cancel")}><XCircle className="size-4" /> إلغاء</Button> : null}
            </div>
          </CardContent></Card>
        ) : null}

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={7} /> : !run ? (
            <EmptyState icon={Wallet} title="لا يوجد كشف لهذه الفترة" description="أنشئ مسودة ليتم حساب الاستحقاقات من بيانات الموظفين والحضور والإجازات." />
          ) : data!.lines.length === 0 ? (
            <EmptyState icon={Wallet} title="الكشف بلا موظفين" description="راجع بيانات الموظفين النشطين ثم أعد إنشاء الكشف." />
          ) : (
            <Table className="min-w-[1350px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">الموظف</TableHead><TableHead className="text-right">الوظيفة</TableHead><TableHead className="text-center">نوع الراتب</TableHead><TableHead className="text-center">أيام مستحقة</TableHead><TableHead className="text-center">غياب</TableHead><TableHead className="text-center">إجازة مدفوعة</TableHead><TableHead className="text-center">ساعات</TableHead><TableHead className="text-center">الأساسي</TableHead><TableHead className="text-center">الإضافات</TableHead><TableHead className="text-center">الخصومات</TableHead><TableHead className="text-center">الصافي</TableHead><TableHead className="text-center">إجراء</TableHead>
              </TableRow></TableHeader>
              <TableBody>{data!.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-black text-brand">{line.employee_name}</TableCell>
                  <TableCell className="font-bold">{line.position ?? "—"}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{salaryTypeLabel(line.salary_type)}</Badge></TableCell>
                  <TableCell className="text-center font-black">{line.payable_days.toLocaleString("ar-EG")} / {line.scheduled_days.toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center font-black text-rose-600">{line.absent_days.toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center font-black text-emerald-700">{line.paid_leave_days.toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center font-black">{line.worked_hours.toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center font-black">{money(line.regular_pay, currency)}</TableCell>
                  <TableCell className="text-center font-black text-emerald-700">{money(line.additions, currency)}</TableCell>
                  <TableCell className="text-center font-black text-rose-600">{money(line.deductions, currency)}</TableCell>
                  <TableCell className="text-center font-black text-brand">{money(line.net_salary, currency)}</TableCell>
                  <TableCell className="text-center">{canWrite && run.status === PayrollRunStatus.Draft && auth.activePharmacyId ? <PayrollLineAdjustmentDialog pharmacyId={auth.activePharmacyId} runId={run.id} line={line} currency={currency} onSaved={load} /> : <span className="text-xs font-bold text-slate-400">—</span>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "rose" | "emerald" }) {
  return <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-700" : "text-slate-950")}>{value}</p></CardContent></Card>
}

function StatusBadge({ status }: { status: PayrollRunStatus }) {
  const color = status === PayrollRunStatus.Paid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === PayrollRunStatus.Approved ? "border-blue-200 bg-blue-50 text-blue-700" : status === PayrollRunStatus.Cancelled ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"
  return <Badge variant="outline" className={cn("font-black", color)}>{statusLabel(status)}</Badge>
}

function statusLabel(status: PayrollRunStatus) {
  return status === PayrollRunStatus.Draft ? "مسودة" : status === PayrollRunStatus.Approved ? "معتمد" : status === PayrollRunStatus.Paid ? "مصروف" : "ملغي"
}

function salaryTypeLabel(value: string) {
  return value === "monthly" ? "شهري" : value === "weekly" ? "أسبوعي" : value === "daily" ? "يومي" : value === "hourly" ? "بالساعة" : value
}

function money(value: number, currency: string) {
  return `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function currentPeriod() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7)
}
