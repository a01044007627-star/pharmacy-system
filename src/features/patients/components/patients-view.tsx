"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, Plus, RefreshCw, Search, User, Activity, FileText, Archive, XCircle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

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
  type: "sale" | "prescription"
  reference: string
  date: string
  total: number
  items_count: number
  doctor: string | null
  diagnosis: string | null
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

const emptyForm: { name: string; phone: string; email: string; gender: "male" | "female"; birth_date: string; address: string; notes: string } = {
  name: "", phone: "", email: "", gender: "male",
  birth_date: "", address: "", notes: "",
}

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
  const [createForm, setCreateForm] = useState(emptyForm)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PatientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTab, setDetailTab] = useState("info")

  const canWrite = auth.isDeveloper || auth.can("crm:write")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        query,
        status: filterStatus !== "all" ? filterStatus : "",
        gender: filterGender !== "all" ? filterGender : "",
        page: String(page),
        page_size: "25",
      })
      const res = await fetch(`/api/patients?${params.toString()}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({})) as PatientsResponse
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل المرضى")
      setRows(data.patients ?? [])
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
      const res = await fetch(`/api/patients/${id}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({})) as PatientDetailResponse
      if (!res.ok) throw new Error(data.error ?? "فشل تحميل بيانات المريض")
      setDetail(data.patient ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات المريض")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const updateStatus = useCallback(async (id: string, newStatus: string) => {
    if (!auth.activePharmacyId) return
    try {
      const res = await fetch(`/api/patients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, status: newStatus }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل تحديث الحالة")
      toast.success("تم تحديث حالة المريض")
      setDetail((prev) => prev ? { ...prev, status: newStatus as PatientDetail["status"] } : null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث الحالة")
    }
  }, [auth.activePharmacyId, load])

  async function handleCreate() {
    if (!auth.activePharmacyId) return
    if (!createForm.name.trim()) { toast.error("الاسم مطلوب"); return }
    if (!createForm.birth_date) { toast.error("تاريخ الميلاد مطلوب"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          name: createForm.name.trim(),
          phone: createForm.phone.trim() || null,
          email: createForm.email.trim() || null,
          gender: createForm.gender,
          birth_date: createForm.birth_date,
          address: createForm.address.trim() || null,
          notes: createForm.notes.trim() || null,
          status: "active",
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل إنشاء المريض")
      toast.success("تم إنشاء المريض بنجاح")
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
                  <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border-white/10 bg-slate-900 text-white" dir="rtl">
                    <DialogHeader><DialogTitle className="font-black text-white">إضافة مريض جديد</DialogTitle></DialogHeader>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label className="text-xs font-black text-slate-300">الاسم *</Label>
                        <Input value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} placeholder="اسم المريض" className="h-11 rounded-xl border-white/10 bg-slate-800 text-white font-bold placeholder:text-slate-500" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs font-black text-slate-300">الجنس</Label>
                        <NativeSelect value={createForm.gender} onChange={(e) => setCreateForm((p) => ({ ...p, gender: e.target.value as "male" | "female" }))} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white">
                          <NativeSelectOption value="male">ذكر</NativeSelectOption>
                          <NativeSelectOption value="female">أنثى</NativeSelectOption>
                        </NativeSelect>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs font-black text-slate-300">تاريخ الميلاد *</Label>
                        <Input type="date" value={createForm.birth_date} onChange={(e) => setCreateForm((p) => ({ ...p, birth_date: e.target.value }))} className="h-11 rounded-xl border-white/10 bg-slate-800 text-white" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs font-black text-slate-300">رقم الهاتف</Label>
                        <Input value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} placeholder="رقم الهاتف" className="h-11 rounded-xl border-white/10 bg-slate-800 text-white font-bold placeholder:text-slate-500" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs font-black text-slate-300">البريد الإلكتروني</Label>
                        <Input value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} placeholder="البريد الإلكتروني" className="h-11 rounded-xl border-white/10 bg-slate-800 text-white font-bold placeholder:text-slate-500" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label className="text-xs font-black text-slate-300">العنوان</Label>
                        <Input value={createForm.address} onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))} placeholder="العنوان" className="h-11 rounded-xl border-white/10 bg-slate-800 text-white font-bold placeholder:text-slate-500" />
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label className="text-xs font-black text-slate-300">ملاحظات</Label>
                        <Textarea value={createForm.notes} onChange={(e) => setCreateForm((p) => ({ ...p, notes: e.target.value }))} placeholder="ملاحظات إضافية..." className="min-h-20 rounded-xl border-white/10 bg-slate-800 text-white font-bold placeholder:text-slate-500" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" className="h-10 rounded-xl border-white/10 bg-slate-800 text-white hover:bg-slate-700" onClick={() => setCreateOpen(false)}>إلغاء</Button>
                      <Button className="h-10 rounded-xl bg-cyan-600 text-white hover:bg-cyan-500" disabled={saving || !createForm.name.trim() || !createForm.birth_date} onClick={() => void handleCreate()}>
                        {saving ? "جاري الحفظ..." : "إضافة المريض"}
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
                        <div className="font-black text-white">{row.name}</div>
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
                              <PatientDetailContent detail={detail} canWrite={canWrite} onStatusChange={updateStatus} onRefresh={() => openDetail(detail.id)} />
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
}: {
  detail: PatientDetail
  canWrite: boolean
  onStatusChange: (id: string, status: string) => void
  onRefresh: () => void
}) {
  const sb = statusBadge(detail.status)
  const [tabValue, setTabValue] = useState("info")

  function ageFromDate(birth: string) {
    if (!birth) return 0
    const diff = Date.now() - new Date(birth).getTime()
    return Math.floor(diff / 31557600000)
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
        <Badge variant="outline" className={cn("font-black", sb.cls)}>{sb.label}</Badge>
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

        <TabsContent value="visits" className="mt-4 outline-none">
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
                          {v.type === "sale" ? "بيع" : "وصفة طبية"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-cyan-400">{v.reference}</TableCell>
                      <TableCell className="text-center text-xs font-bold text-white">{new Date(v.date).toLocaleDateString("ar-EG")}</TableCell>
                      <TableCell className="text-center font-bold text-white">{Number(v.total || 0).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="text-center font-bold text-white">{v.items_count}</TableCell>
                      <TableCell className="text-center text-xs font-bold text-slate-300">{v.doctor ?? "—"}</TableCell>
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
