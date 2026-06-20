"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, Plus, RefreshCw, Search, User, Activity, FileText, Archive, XCircle, CheckCircle2, ChevronLeft, ChevronRight, Pencil, CloudOff } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { patientsService } from "@/features/patients/services/patients-service"
import { network } from "@/lib/network"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { emptyPatientForm, patientFormPayload, patientToForm, PatientFormFields, type PatientFormData } from "./patient-form-fields"

type PatientRow = {
  id: string
  code: string
  name: string
  phone: string | null
  gender: "male" | "female"
  birth_date: string
  age: number
  visit_count: number
  last_visit: string | null
  status: "active" | "inactive" | "archived"
  created_at: string
  _offline_pending?: boolean
}

type MedicalInfo = {
  allergies: string[]
  chronic_diseases: string[]
  medications: string[]
  blood_type: string | null
  notes: string | null
}

type InsuranceInfo = {
  provider: string | null
  policy_number: string | null
  expiry_date: string | null
  coverage_percent: number
}

type VisitRecord = {
  id: string
  type: "sale" | "sale_return" | "prescription" | "consultation" | "medication_review" | "manual" | "other"
  reference: string
  date: string
  total: number
  items_count: number
  doctor: string | null
  diagnosis: string | null
  notes?: string | null
}

type PatientDetail = {
  id: string
  code: string
  name: string
  phone: string | null
  email: string | null
  gender: "male" | "female"
  birth_date: string
  age: number
  address: string | null
  status: "active" | "inactive" | "archived"
  notes: string | null
  created_at: string
  updated_at: string
  id_number?: string | null
  blood_type?: string | null
  allergies?: string[]
  chronic_diseases?: string[]
  current_medications?: string[]
  medical_history?: string | null
  surgical_history?: string | null
  family_history?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  insurance_company?: string | null
  insurance_policy_number?: string | null
  insurance_expiry_date?: string | null
  medical: MedicalInfo
  insurance: InsuranceInfo
  visits: VisitRecord[]
  visit_count: number
  last_visit: string | null
}

type PatientsResponse = {
  patients?: PatientRow[]
  summary?: { count: number; active: number; inactive: number; archived: number }
  pagination?: { totalPages: number }
  error?: string
}

type PatientDetailResponse = {
  patient?: PatientDetail
  error?: string
}

const emptyForm = emptyPatientForm


function genderLabel(g: string) {
  return g === "male" ? "ذكر" : "أنثى"
}

function statusBadge(s: string) {
  switch (s) {
    case "active": return { label: "نشط", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" }
    case "inactive": return { label: "غير نشط", cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" }
    case "archived": return { label: "مؤرشف", cls: "border-slate-500/30 bg-slate-500/10 text-slate-400" }
    default: return { label: s, cls: "" }
  }
}

export function PatientsView() {
  const auth = useAuth()
  const [rows, setRows] = useState<PatientRow[]>([])
  const [summary, setSummary] = useState({ count: 0, active: 0, inactive: 0, archived: 0 })
  const [query, setQuery] = useState("")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterGender, setFilterGender] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createForm, setCreateForm] = useState<PatientFormData>(emptyForm)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PatientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTab, setDetailTab] = useState("info")

  const canWrite = auth.isDeveloper || auth.can("crm:write")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const data = await patientsService.list({
        pharmacyId: auth.activePharmacyId,
        query,
        status: filterStatus,
        gender: filterGender,
        page,
        pageSize: 25,
      })
      setRows((data.patients ?? []).map((patient) => ({ ...patient, age: Number(patient.age ?? 0) })) as PatientRow[])
      setSummary(data.summary ?? { count: 0, active: 0, inactive: 0, archived: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المرضى")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, filterGender, filterStatus, page, query])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetailLoading(true)
    setDetail(null)
    setDetailTab("info")
    try {
      if (!auth.activePharmacyId) throw new Error("اختر صيدلية أولاً")
      const data = await patientsService.get(auth.activePharmacyId, id) as PatientDetailResponse
      setDetail(data.patient ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات المريض")
    } finally {
      setDetailLoading(false)
    }
  }, [auth.activePharmacyId])

  const updateStatus = useCallback(async (id: string, newStatus: string) => {
    if (!auth.activePharmacyId) return
    try {
      const result = await patientsService.update(auth.activePharmacyId, id, { status: newStatus })
      toast.success(result.queued ? "تم حفظ التغيير وسيتم مزامنته عند عودة الإنترنت" : "تم تحديث حالة المريض")
      setDetail((prev) => prev ? { ...prev, status: newStatus as PatientDetail["status"] } : null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث الحالة")
    }
  }, [auth.activePharmacyId, load])

  const updatePatient = useCallback(async (id: string, form: PatientFormData) => {
    if (!auth.activePharmacyId) throw new Error("اختر صيدلية أولاً")
    const result = await patientsService.update(auth.activePharmacyId, id, patientFormPayload(form))
    toast.success(result.queued ? "تم حفظ التعديل محليًا وسيتم مزامنته تلقائيًا" : "تم تحديث ملف المريض")
    await Promise.all([load(), openDetail(id)])
  }, [auth.activePharmacyId, load, openDetail])

  async function handleCreate() {
    if (!auth.activePharmacyId) return
    if (!createForm.name.trim()) { toast.error("الاسم مطلوب"); return }
    setSaving(true)
    try {
      const result = await patientsService.create(auth.activePharmacyId, patientFormPayload(createForm))
      toast.success(result.queued ? "تم حفظ المريض على الجهاز وسيتم مزامنته تلقائيًا" : "تم إنشاء المريض وربطه بحساب عميل")
      setCreateOpen(false)
      setCreateForm(emptyForm)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إنشاء المريض")
    } finally {
      setSaving(false)
    }
  }

  const cards = useMemo(() => [
    { label: "إجمالي المرضى", value: summary.count.toLocaleString("ar-EG"), tone: "text-cyan-400" },
    { label: "النشطون", value: summary.active.toLocaleString("ar-EG"), tone: "text-emerald-400" },
    { label: "غير النشط", value: summary.inactive.toLocaleString("ar-EG"), tone: "text-amber-400" },
    { label: "المؤرشفون", value: summary.archived.toLocaleString("ar-EG"), tone: "text-slate-400" },
  ], [summary])

  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="min-h-screen space-y-4 bg-slate-950 p-4 text-right sm:p-6">
        <DashboardPageHeader
          title="المرضى"
          subtitle="إدارة بيانات المرضى وسجل الزيارات والتقارير الطبية."
          icon={User}
          className="border-white/10 bg-slate-900 text-white!"
          iconClassName="bg-cyan-500/10 text-cyan-400 border-cyan-500/20!"
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
              {canWrite ? (
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger render={<Button className="h-10 rounded-xl bg-cyan-600 text-white hover:bg-cyan-500"><Plus className="size-4" /> إضافة مريض</Button>} />
                  <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto rounded-3xl border-white/10 bg-slate-900 text-white" dir="rtl">
                    <DialogHeader>
                      <DialogTitle className="font-black text-white">إضافة ملف مريض جديد</DialogTitle>
                    </DialogHeader>
                    <PatientFormFields value={createForm} onChange={setCreateForm} />
                    <div className="sticky bottom-0 flex justify-end gap-2 border-t border-white/10 bg-slate-900/95 pt-4 backdrop-blur">
                      <Button variant="outline" className="h-10 rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" onClick={() => setCreateOpen(false)}>إلغاء</Button>
                      <Button className="h-10 rounded-xl bg-cyan-600 text-white hover:bg-cyan-500" disabled={saving || !createForm.name.trim()} onClick={() => void handleCreate()}>
                        {saving ? "جاري الحفظ..." : "حفظ ملف المريض"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : null}
            </>
          )}
        />

        <Card className="rounded-3xl border-white/10 bg-slate-900 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="بحث بالاسم أو الهاتف أو الكود..." className="h-11 rounded-2xl border-white/10 bg-slate-800 pr-10 font-bold text-white placeholder:text-slate-500" />
            </div>
            <NativeSelect value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white">
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="active">نشط</NativeSelectOption>
              <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
              <NativeSelectOption value="archived">مؤرشف</NativeSelectOption>
            </NativeSelect>
            <NativeSelect value={filterGender} onChange={(e) => { setFilterGender(e.target.value); setPage(1) }} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white">
              <NativeSelectOption value="all">كل الجنسين</NativeSelectOption>
              <NativeSelectOption value="male">ذكر</NativeSelectOption>
              <NativeSelectOption value="female">أنثى</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label} className="rounded-2xl border-white/10 bg-slate-900 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-black text-slate-400">{c.label}</p>
                <p className={cn("mt-2 text-2xl font-black", c.tone)}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-white/10 bg-slate-900 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={User} title="لا توجد بيانات مرضى" description="ابدأ بإضافة أول مريض." />
          ) : (
            <Table className="min-w-[950px]">
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-right text-slate-300">الكود</TableHead>
                  <TableHead className="text-right text-slate-300">الاسم</TableHead>
                  <TableHead className="text-right text-slate-300">الهاتف</TableHead>
                  <TableHead className="text-center text-slate-300">الجنس</TableHead>
                  <TableHead className="text-center text-slate-300">العمر</TableHead>
                  <TableHead className="text-center text-slate-300">الزيارات</TableHead>
                  <TableHead className="text-center text-slate-300">آخر زيارة</TableHead>
                  <TableHead className="text-center text-slate-300">الحالة</TableHead>
                  <TableHead className="text-center text-slate-300"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const sb = statusBadge(row.status)
                  return (
                    <TableRow key={row.id} className="border-white/10 hover:bg-slate-800/50">
                      <TableCell className="font-mono text-xs font-bold text-cyan-400">{row.code}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 font-black text-white">{row.name}{row._offline_pending ? <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400"><CloudOff className="size-3" /> بانتظار المزامنة</Badge> : null}</div>
                        {row.last_visit ? <div className="text-xs font-bold text-slate-400">آخر زيارة: {new Date(row.last_visit).toLocaleDateString("ar-EG")}</div> : null}
                      </TableCell>
                      <TableCell className="font-bold text-white" dir="ltr">{row.phone ?? "—"}</TableCell>
                      <TableCell className="text-center font-bold text-slate-300">{genderLabel(row.gender)}</TableCell>
                      <TableCell className="text-center font-bold text-white">{row.age}</TableCell>
                      <TableCell className="text-center font-bold text-white">{row.visit_count}</TableCell>
                      <TableCell className="text-center text-xs font-bold text-slate-400">{row.last_visit ? new Date(row.last_visit).toLocaleDateString("ar-EG") : "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn("font-black", sb.cls)}>{sb.label}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Sheet>
                          <SheetTrigger render={<Button size="icon" variant="ghost" className="text-slate-400 hover:text-cyan-400 hover:bg-slate-800" onClick={() => openDetail(row.id)}><Eye className="size-4" /></Button>} />
                          <SheetContent side="left" className="w-full border-white/10 bg-slate-950 text-white sm:max-w-2xl" dir="rtl">
                            <SheetHeader><SheetTitle className="font-black text-white">تفاصيل المريض</SheetTitle></SheetHeader>
                            {detailLoading ? (
                              <div className="flex items-center justify-center py-20"><RefreshCw className="size-8 animate-spin text-cyan-400" /></div>
                            ) : detail ? (
                              <PatientDetailContent detail={detail} canWrite={canWrite} onStatusChange={updateStatus} onRefresh={() => openDetail(detail.id)} onUpdate={updatePatient} />
                            ) : (
                              <p className="py-8 text-center font-bold text-rose-400">المريض غير موجود</p>
                            )}
                          </SheetContent>
                        </Sheet>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
            <span className="text-xs font-black text-slate-400">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>
                <ChevronRight className="size-4" /> السابق
              </Button>
              <Button size="sm" variant="outline" className="rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>
                التالي <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}

function PatientDetailContent({
  detail,
  canWrite,
  onStatusChange,
  onRefresh,
  onUpdate,
}: {
  detail: PatientDetail
  canWrite: boolean
  onStatusChange: (id: string, status: string) => void
  onRefresh: () => void
  onUpdate: (id: string, form: PatientFormData) => Promise<void>
}) {
  const sb = statusBadge(detail.status)
  const [tabValue, setTabValue] = useState("info")
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<PatientFormData>(() => patientToForm(detail as unknown as Record<string, unknown>))
  const [editSaving, setEditSaving] = useState(false)
  const [visitOpen, setVisitOpen] = useState(false)
  const [visitSaving, setVisitSaving] = useState(false)
  const [visitForm, setVisitForm] = useState({ visit_type: "medication_review", visit_date: new Date().toISOString().slice(0, 16), notes: "" })
  const auth = useAuth()

  useEffect(() => setEditForm(patientToForm(detail as unknown as Record<string, unknown>)), [detail])

  async function saveEdit() {
    if (!editForm.name.trim()) { toast.error("اسم المريض مطلوب"); return }
    setEditSaving(true)
    try {
      await onUpdate(detail.id, editForm)
      setEditOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث المريض")
    } finally {
      setEditSaving(false)
    }
  }

  function ageFromDate(birth: string) {
    if (!birth) return 0
    const diff = Date.now() - new Date(birth).getTime()
    return Math.floor(diff / 31557600000)
  }

  async function recordVisit() {
    if (!auth.activePharmacyId) return
    if (!visitForm.notes.trim()) { toast.error("اكتب ملخص الزيارة أو المراجعة الدوائية"); return }
    setVisitSaving(true)
    const requestId = crypto.randomUUID()
    const body = {
      pharmacy_id: auth.activePharmacyId,
      branch_id: auth.activeBranchId,
      visit_type: visitForm.visit_type,
      visit_date: new Date(visitForm.visit_date).toISOString(),
      notes: visitForm.notes.trim(),
      client_request_id: requestId,
    }
    try {
      if (await network.check()) {
        const response = await fetch(`/api/patients/${detail.id}/visits`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تسجيل الزيارة")
        toast.success("تم تسجيل الزيارة في ملف المريض")
      } else {
        const localVisit = { id: requestId, client_request_id: requestId, pharmacy_id: auth.activePharmacyId, branch_id: auth.activeBranchId, patient_id: detail.id, visit_type: visitForm.visit_type, reference_table: "manual_patient_visit", reference_id: null, visit_date: body.visit_date, total_amount: 0, notes: body.notes, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _offline_pending: true }
        await localDB.putTableRow("pharmacy_patient_visits", localVisit, false)
        await queueApiRequest({ path: `/api/patients/${detail.id}/visits`, method: "POST", body, label: `تسجيل زيارة ${detail.name}` })
        toast.success("تم حفظ الزيارة على الجهاز وستتم مزامنتها تلقائيًا")
      }
      setVisitOpen(false)
      setVisitForm({ visit_type: "medication_review", visit_date: new Date().toISOString().slice(0, 16), notes: "" })
      onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الزيارة")
    } finally {
      setVisitSaving(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <User className="size-6" />
          </span>
          <div>
            <h3 className="text-lg font-black text-white">{detail.name}</h3>
            <p className="text-xs font-bold text-slate-400">كود: {detail.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("font-black", sb.cls)}>{sb.label}</Badge>
          {canWrite ? (
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" className="rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700"><Pencil className="size-4" /> تعديل</Button>} />
              <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto rounded-3xl border-white/10 bg-slate-900 text-white" dir="rtl">
                <DialogHeader><DialogTitle className="font-black text-white">تعديل ملف {detail.name}</DialogTitle></DialogHeader>
                <PatientFormFields value={editForm} onChange={setEditForm} />
                <div className="sticky bottom-0 flex justify-end gap-2 border-t border-white/10 bg-slate-900/95 pt-4 backdrop-blur">
                  <Button variant="outline" className="rounded-xl border-white/10 bg-slate-800 text-white" onClick={() => setEditOpen(false)}>إلغاء</Button>
                  <Button className="rounded-xl bg-cyan-600 text-white" disabled={editSaving || !editForm.name.trim()} onClick={() => void saveEdit()}>{editSaving ? "جاري الحفظ..." : "حفظ التعديلات"}</Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      <Tabs value={tabValue} onValueChange={setTabValue} className="w-full">
        <TabsList className="w-full border-white/10 bg-slate-900" variant="line">
          <TabsTrigger value="info" className="flex-1 text-slate-400 data-active:text-cyan-400 data-active:border-cyan-400">
            <FileText className="size-4" /> البيانات الأساسية
          </TabsTrigger>
          <TabsTrigger value="medical" className="flex-1 text-slate-400 data-active:text-cyan-400 data-active:border-cyan-400">
            <Activity className="size-4" /> السجل الطبي
          </TabsTrigger>
          <TabsTrigger value="visits" className="flex-1 text-slate-400 data-active:text-cyan-400 data-active:border-cyan-400">
            <Activity className="size-4" /> الزيارات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4 space-y-3 outline-none">
          <Card className="rounded-2xl border-white/10 bg-slate-900">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <DetailField label="الكود" value={detail.code} mono />
              <DetailField label="الاسم" value={detail.name} />
              <DetailField label="الجنس" value={genderLabel(detail.gender)} />
              <DetailField label="العمر" value={`${ageFromDate(detail.birth_date)} سنة`} />
              <DetailField label="تاريخ الميلاد" value={detail.birth_date ? new Date(detail.birth_date).toLocaleDateString("ar-EG") : "—"} />
              <DetailField label="الهاتف" value={detail.phone ?? "—"} ltr />
              <DetailField label="البريد" value={detail.email ?? "—"} ltr />
              <DetailField label="العنوان" value={detail.address ?? "—"} />
              {detail.notes ? <DetailField label="ملاحظات" value={detail.notes} className="sm:col-span-2" /> : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/10 bg-slate-900">
            <CardContent className="p-4">
              <h4 className="mb-3 text-sm font-black text-slate-300">معلومات التأمين</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="شركة التأمين" value={detail.insurance.provider ?? "—"} />
                <DetailField label="رقم البوليصة" value={detail.insurance.policy_number ?? "—"} />
                <DetailField label="تاريخ الانتهاء" value={detail.insurance.expiry_date ? new Date(detail.insurance.expiry_date).toLocaleDateString("ar-EG") : "—"} />
                <DetailField label="نسبة التغطية" value={detail.insurance.coverage_percent ? `${detail.insurance.coverage_percent}%` : "—"} />
              </div>
            </CardContent>
          </Card>

          {canWrite ? (
            <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-900 p-3">
              {detail.status !== "active" ? (
                <Button size="sm" className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => onStatusChange(detail.id, "active")}>
                  <CheckCircle2 className="size-4" /> تفعيل
                </Button>
              ) : null}
              {detail.status !== "inactive" ? (
                <Button size="sm" variant="outline" className="rounded-xl border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" onClick={() => onStatusChange(detail.id, "inactive")}>
                  <XCircle className="size-4" /> تعطيل
                </Button>
              ) : null}
              {detail.status !== "archived" ? (
                <Button size="sm" variant="outline" className="rounded-xl border-slate-500/30 bg-slate-500/10 text-slate-400 hover:bg-slate-500/20" onClick={() => onStatusChange(detail.id, "archived")}>
                  <Archive className="size-4" /> أرشفة
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="mr-auto rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" onClick={() => onRefresh()}>
                <RefreshCw className="size-4" />
              </Button>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <span>تاريخ الإنشاء: {new Date(detail.created_at).toLocaleString("ar-EG")}</span>
            <Separator orientation="vertical" className="h-4 bg-white/10" />
            <span>آخر تحديث: {new Date(detail.updated_at).toLocaleString("ar-EG")}</span>
          </div>
        </TabsContent>

        <TabsContent value="medical" className="mt-4 space-y-3 outline-none">
          <Card className="rounded-2xl border-white/10 bg-slate-900">
            <CardContent className="p-4">
              <h4 className="mb-3 text-sm font-black text-slate-300">الحساسية</h4>
              {detail.medical.allergies.length === 0 ? (
                <p className="text-sm font-bold text-slate-500">لا توجد حساسية مسجلة</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {detail.medical.allergies.map((a, i) => (
                    <Badge key={i} variant="outline" className="border-rose-500/30 bg-rose-500/10 font-bold text-rose-400">{a}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/10 bg-slate-900">
            <CardContent className="p-4">
              <h4 className="mb-3 text-sm font-black text-slate-300">الأمراض المزمنة</h4>
              {detail.medical.chronic_diseases.length === 0 ? (
                <p className="text-sm font-bold text-slate-500">لا توجد أمراض مزمنة مسجلة</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {detail.medical.chronic_diseases.map((d, i) => (
                    <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/10 font-bold text-amber-400">{d}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/10 bg-slate-900">
            <CardContent className="p-4">
              <h4 className="mb-3 text-sm font-black text-slate-300">الأدوية المستخدمة</h4>
              {detail.medical.medications.length === 0 ? (
                <p className="text-sm font-bold text-slate-500">لا توجد أدوية مسجلة</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {detail.medical.medications.map((m, i) => (
                    <Badge key={i} variant="outline" className="border-cyan-500/30 bg-cyan-500/10 font-bold text-cyan-400">{m}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {detail.medical.blood_type ? (
            <Card className="rounded-2xl border-white/10 bg-slate-900">
              <CardContent className="p-4">
                <DetailField label="فصيلة الدم" value={detail.medical.blood_type} />
              </CardContent>
            </Card>
          ) : null}

          {detail.medical.notes ? (
            <Card className="rounded-2xl border-white/10 bg-slate-900">
              <CardContent className="p-4">
                <DetailField label="ملاحظات طبية" value={detail.medical.notes} />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="visits" className="mt-4 space-y-3 outline-none">
          {canWrite ? (
            <div className="flex justify-end">
              <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
                <DialogTrigger render={<Button className="rounded-xl bg-cyan-600 text-white hover:bg-cyan-500"><Plus className="size-4" /> تسجيل زيارة / مراجعة دوائية</Button>} />
                <DialogContent className="max-w-lg rounded-3xl border-white/10 bg-slate-900 text-white" dir="rtl">
                  <DialogHeader><DialogTitle className="font-black text-white">تسجيل زيارة للمريض</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><label className="mb-1 block text-xs font-black text-slate-300">نوع الزيارة</label><NativeSelect value={visitForm.visit_type} onChange={(event) => setVisitForm((prev) => ({ ...prev, visit_type: event.target.value }))} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white"><NativeSelectOption value="medication_review">مراجعة دوائية</NativeSelectOption><NativeSelectOption value="consultation">استشارة صيدلية</NativeSelectOption><NativeSelectOption value="manual">زيارة متابعة</NativeSelectOption><NativeSelectOption value="other">أخرى</NativeSelectOption></NativeSelect></div>
                    <div><label className="mb-1 block text-xs font-black text-slate-300">التاريخ والوقت</label><Input type="datetime-local" value={visitForm.visit_date} onChange={(event) => setVisitForm((prev) => ({ ...prev, visit_date: event.target.value }))} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white" /></div>
                    <div><label className="mb-1 block text-xs font-black text-slate-300">ملخص الزيارة / التعليمات *</label><Textarea value={visitForm.notes} onChange={(event) => setVisitForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="الأعراض، الأدوية الحالية، تعليمات الاستخدام أو ما تم مراجعته..." className="min-h-28 rounded-xl border-white/10 bg-slate-800 text-white" /></div>
                    <div className="flex justify-end gap-2"><Button variant="outline" className="rounded-xl border-white/10 bg-slate-800 text-white" onClick={() => setVisitOpen(false)}>إلغاء</Button><Button className="rounded-xl bg-cyan-600 text-white" disabled={visitSaving} onClick={() => void recordVisit()}>{visitSaving ? "جارٍ الحفظ..." : "حفظ الزيارة"}</Button></div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}
          <Card className="rounded-2xl border-white/10 bg-slate-900">
            {detail.visits.length === 0 ? (
              <CardContent className="p-6 text-center">
                <Activity className="mx-auto size-10 text-slate-600" />
                <p className="mt-3 font-bold text-slate-500">لا توجد زيارات مسجلة</p>
                <p className="mt-1 text-xs font-bold text-slate-600">ستظهر الزيارات هنا بعد أول عملية بيع أو وصفة طبية.</p>
              </CardContent>
            ) : (
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-right text-slate-300">النوع</TableHead>
                    <TableHead className="text-right text-slate-300">المرجع</TableHead>
                    <TableHead className="text-center text-slate-300">التاريخ</TableHead>
                    <TableHead className="text-center text-slate-300">الإجمالي</TableHead>
                    <TableHead className="text-center text-slate-300">الأصناف</TableHead>
                    <TableHead className="text-center text-slate-300">الطبيب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.visits.map((v) => (
                    <TableRow key={v.id} className="border-white/10 hover:bg-slate-800/50">
                      <TableCell>
                        <Badge variant="outline" className={cn("font-black", v.type === "sale" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-cyan-500/30 bg-cyan-500/10 text-cyan-400")}>
                          {v.type === "sale" ? "بيع" : v.type === "sale_return" ? "مرتجع بيع" : v.type === "prescription" ? "وصفة طبية" : v.type === "medication_review" ? "مراجعة دوائية" : v.type === "consultation" ? "استشارة" : "زيارة"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-cyan-400">{v.reference}</TableCell>
                      <TableCell className="text-center text-xs font-bold text-white">{new Date(v.date).toLocaleDateString("ar-EG")}</TableCell>
                      <TableCell className="text-center font-bold text-white">{Number(v.total || 0).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="text-center font-bold text-white">{v.items_count}</TableCell>
                      <TableCell className="text-center text-xs font-bold text-slate-300"><p>{v.doctor ?? "—"}</p>{v.notes ? <p className="mt-1 max-w-[220px] truncate text-[10px] text-slate-500" title={v.notes}>{v.notes}</p> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DetailField({ label, value, ltr, mono, className }: { label: string; value: string; ltr?: boolean; mono?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-black text-slate-400">{label}</p>
      <p className={cn("mt-0.5 font-bold text-white", mono && "font-mono text-cyan-400", ltr && "text-left")} dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  )
}
