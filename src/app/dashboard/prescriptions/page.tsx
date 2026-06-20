"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileText, Plus, RefreshCw, Search, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { patientsService, type PatientRecord } from "@/features/patients/services/patients-service"
import { network } from "@/lib/network"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { localDB } from "@/lib/sync/local-db"
import { cn } from "@/lib/utils"

type PrescriptionStatus = "open" | "dispensed" | "cancelled" | "archived"

type Prescription = {
  id: string
  pharmacy_id?: string
  branch_id?: string | null
  prescription_number?: string | null
  patient_record_id?: string | null
  patient_name: string
  doctor_name: string | null
  diagnosis: string | null
  notes: string | null
  status: PrescriptionStatus
  prescription_date?: string | null
  valid_until?: string | null
  created_at: string
  _offline_pending?: boolean
  patient?: { id: string; code?: string | null; name: string; phone?: string | null } | null
}

const statusMeta: Record<PrescriptionStatus, { label: string; className: string }> = {
  open: { label: "مفتوحة", className: "border-blue-200 bg-blue-50 text-blue-700" },
  dispensed: { label: "تم الصرف", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ملغاة", className: "border-rose-200 bg-rose-50 text-rose-700" },
  archived: { label: "مؤرشفة", className: "border-slate-200 bg-slate-50 text-slate-600" },
}

const emptyForm = {
  patient_record_id: "",
  patient_name: "",
  doctor_name: "",
  diagnosis: "",
  notes: "",
  valid_until: "",
}

function isPrescription(row: Record<string, unknown>): row is Record<string, unknown> & Prescription {
  return Boolean(row.id && row.patient_name)
}

export default function PrescriptionsPage() {
  const auth = useAuth()
  const [rows, setRows] = useState<Prescription[]>([])
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<PrescriptionStatus | "all">("all")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      if (await network.check()) {
        const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, page_size: "100" })
        if (auth.activeBranchId) params.set("branch_id", auth.activeBranchId)
        if (status !== "all") params.set("status", status)
        const response = await fetch(`/api/prescriptions?${params}`, { cache: "no-store", credentials: "same-origin" })
        const data = await response.json().catch(() => ({})) as { prescriptions?: Prescription[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل تحميل الوصفات")
        const next = data.prescriptions ?? []
        setRows(next)
        await localDB.putTableRows("pharmacy_prescriptions", next as unknown as Record<string, unknown>[], true)
      } else {
        const local = (await localDB.getTableRows("pharmacy_prescriptions"))
          .filter(isPrescription)
          .filter((row) => row.pharmacy_id === auth.activePharmacyId)
          .filter((row) => status === "all" || row.status === status)
          .sort((a, b) => String(b.prescription_date ?? b.created_at).localeCompare(String(a.prescription_date ?? a.created_at)))
        setRows(local)
        toast.info("تم عرض الوصفات المحفوظة على الجهاز")
      }
    } catch (error) {
      const local = (await localDB.getTableRows("pharmacy_prescriptions"))
        .filter(isPrescription)
        .filter((row) => row.pharmacy_id === auth.activePharmacyId)
      if (local.length) setRows(local)
      else toast.error(error instanceof Error ? error.message : "فشل تحميل الوصفات")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, status])

  const loadPatients = useCallback(async () => {
    if (!auth.activePharmacyId) return
    try {
      const payload = await patientsService.list({ pharmacyId: auth.activePharmacyId, status: "active", pageSize: 100 })
      setPatients(payload.patients)
    } catch {
      const local = (await localDB.getTableRows("pharmacy_patients")) as PatientRecord[]
      setPatients(local.filter((row) => row.pharmacy_id === auth.activePharmacyId && row.status !== "archived"))
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadPatients() }, [loadPatients])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ar")
    if (!needle) return rows
    return rows.filter((row) => [row.prescription_number, row.patient_name, row.patient?.phone, row.doctor_name, row.diagnosis]
      .some((value) => String(value ?? "").toLocaleLowerCase("ar").includes(needle)))
  }, [query, rows])

  const selectPatient = (patientId: string | null) => {
    const patient = patients.find((row) => row.id === patientId)
    setForm((prev) => ({ ...prev, patient_record_id: patientId ?? "", patient_name: patient?.name ?? prev.patient_name }))
  }

  const handleAdd = async () => {
    if (!auth.activePharmacyId) return
    if (!form.patient_record_id && !form.patient_name.trim()) { toast.error("اختر المريض أو اكتب اسمه"); return }
    setSaving(true)
    const requestId = crypto.randomUUID()
    const body = {
      ...form,
      pharmacy_id: auth.activePharmacyId,
      branch_id: auth.activeBranchId,
      client_request_id: requestId,
    }
    try {
      if (await network.check()) {
        const response = await fetch("/api/prescriptions", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const data = await response.json().catch(() => ({})) as { prescription?: Prescription; error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل إضافة الوصفة")
        toast.success("تم حفظ الوصفة وربطها بملف المريض")
      } else {
        const local: Prescription = {
          id: requestId,
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          prescription_number: "في انتظار المزامنة",
          patient_record_id: form.patient_record_id || null,
          patient_name: form.patient_name.trim(),
          doctor_name: form.doctor_name.trim() || null,
          diagnosis: form.diagnosis.trim() || null,
          notes: form.notes.trim() || null,
          status: "open",
          prescription_date: new Date().toISOString().slice(0, 10),
          valid_until: form.valid_until || null,
          created_at: new Date().toISOString(),
          _offline_pending: true,
        }
        await localDB.putTableRow("pharmacy_prescriptions", local as unknown as Record<string, unknown>, false)
        await queueApiRequest({ path: "/api/prescriptions", method: "POST", body, label: `إضافة وصفة ${local.patient_name}` })
        toast.success("تم حفظ الوصفة على الجهاز وستتم مزامنتها تلقائيًا")
      }
      setOpen(false)
      setForm(emptyForm)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إضافة الوصفة")
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (row: Prescription, nextStatus: PrescriptionStatus) => {
    if (!auth.activePharmacyId) return
    const body = { id: row.id, status: nextStatus, pharmacy_id: auth.activePharmacyId }
    try {
      if (await network.check() && !row._offline_pending) {
        const response = await fetch("/api/prescriptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const data = await response.json().catch(() => ({})) as { error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل تحديث الوصفة")
      } else {
        await queueApiRequest({ path: "/api/prescriptions", method: "PATCH", body, label: `تحديث حالة وصفة ${row.patient_name}` })
        await localDB.putTableRow("pharmacy_prescriptions", { ...row, status: nextStatus, updated_at: new Date().toISOString(), _offline_pending: true } as unknown as Record<string, unknown>, false)
      }
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: nextStatus, _offline_pending: !network.isOnline } : item))
      toast.success(nextStatus === "dispensed" ? "تم تسجيل صرف الوصفة" : "تم تحديث حالة الوصفة")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث الوصفة")
    }
  }

  return (
    <PageAccess permission="prescriptions:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="الوصفات الطبية" subtitle="ربط الوصفة بملف المريض ومتابعة الصرف والصلاحية." icon={FileText} actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
            {auth.can("prescriptions:write") ? <Button className="h-10 rounded-xl" onClick={() => setOpen(true)}><Plus className="size-4" /> وصفة جديدة</Button> : null}
          </>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رقم الوصفة، المريض، الهاتف أو الطبيب..." className="h-11 rounded-2xl pr-10 font-bold" /></div>
          <Select value={status} onValueChange={(value: PrescriptionStatus | "all" | null) => value && setStatus(value)}>
            <SelectTrigger className="h-11 w-full rounded-2xl sm:w-44"><SelectValue>{status === "all" ? "كل الحالات" : statusMeta[status].label}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">كل الحالات</SelectItem>{Object.entries(statusMeta).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent></Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : filtered.length === 0 ? <EmptyState icon={FileText} title="لا توجد وصفات طبية" description="أضف وصفة واربطها بملف المريض." /> : (
            <div className="overflow-x-auto"><Table className="min-w-[1050px]"><TableHeader><TableRow>
              <TableHead className="text-right">رقم الوصفة</TableHead><TableHead className="text-right">المريض</TableHead><TableHead className="text-right">الطبيب</TableHead><TableHead className="text-right">التشخيص</TableHead><TableHead className="text-center">الصلاحية</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">الإجراء</TableHead>
            </TableRow></TableHeader><TableBody>{filtered.map((row) => {
              const meta = statusMeta[row.status] ?? statusMeta.open
              return <TableRow key={row.id}>
                <TableCell className="font-mono text-xs font-black">{row.prescription_number ?? "—"}{row._offline_pending ? <Badge variant="outline" className="mr-2">معلقة</Badge> : null}</TableCell>
                <TableCell><p className="font-black text-brand">{row.patient?.name ?? row.patient_name}</p><p className="text-xs text-slate-500">{row.patient?.phone ?? ""}</p></TableCell>
                <TableCell className="font-bold">{row.doctor_name ?? "—"}</TableCell><TableCell className="max-w-[220px] truncate text-xs font-bold">{row.diagnosis ?? "—"}</TableCell>
                <TableCell className="text-center text-xs font-bold">{row.valid_until ? new Date(row.valid_until).toLocaleDateString("ar-EG") : "غير محددة"}</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className={meta.className}>{meta.label}</Badge></TableCell>
                <TableCell className="text-center">{auth.can("prescriptions:write") && row.status === "open" ? <div className="flex justify-center gap-2"><Button size="sm" className="rounded-xl" onClick={() => void updateStatus(row, "dispensed")}><CheckCircle2 className="size-4" /> صرف</Button><Button size="sm" variant="outline" className="rounded-xl text-rose-600" onClick={() => void updateStatus(row, "cancelled")}><XCircle className="size-4" /> إلغاء</Button></div> : "—"}</TableCell>
              </TableRow>
            })}</TableBody></Table></div>
          )}
        </Card>

        <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg font-black">إضافة وصفة طبية</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-black text-slate-700">اختيار مريض مسجل</label><Select value={form.patient_record_id || "manual"} onValueChange={(value: string | null) => selectPatient(value === "manual" ? null : value)}><SelectTrigger className="h-11 rounded-xl"><SelectValue>{form.patient_record_id ? patients.find((row) => row.id === form.patient_record_id)?.name ?? "المريض" : "إدخال اسم يدوي"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="manual">إدخال اسم يدوي</SelectItem>{patients.map((patient) => <SelectItem key={patient.id} value={patient.id}>{patient.name} {patient.phone ? `— ${patient.phone}` : ""}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-1 block text-xs font-black text-slate-700">اسم المريض *</label><Input value={form.patient_name} onChange={(event) => setForm((prev) => ({ ...prev, patient_name: event.target.value }))} className="h-11 rounded-xl" disabled={Boolean(form.patient_record_id)} /></div>
            <div><label className="mb-1 block text-xs font-black text-slate-700">اسم الطبيب</label><Input value={form.doctor_name} onChange={(event) => setForm((prev) => ({ ...prev, doctor_name: event.target.value }))} className="h-11 rounded-xl" /></div>
            <div><label className="mb-1 block text-xs font-black text-slate-700">التشخيص</label><Input value={form.diagnosis} onChange={(event) => setForm((prev) => ({ ...prev, diagnosis: event.target.value }))} className="h-11 rounded-xl" /></div>
            <div><label className="mb-1 block text-xs font-black text-slate-700">صالحة حتى</label><Input type="date" value={form.valid_until} onChange={(event) => setForm((prev) => ({ ...prev, valid_until: event.target.value }))} className="h-11 rounded-xl" /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-black text-slate-700">تعليمات وملاحظات</label><Textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} className="min-h-24 rounded-xl" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button><Button onClick={() => void handleAdd()} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الوصفة"}</Button></DialogFooter>
        </DialogContent></Dialog>
      </section>
    </PageAccess>
  )
}
