"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity, AlertTriangle, Building2, CheckCircle2, Clock3, Code2, ExternalLink,
  Flag, Loader2, RefreshCw, Rocket, Save, Search, Server, ShieldAlert, XCircle,
  Plus, Store, FileText,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PLATFORM_PLANS, PHARMACY_STATUSES } from "@/features/developer/control-plane"

type Pharmacy = {
  id: string; name: string; legal_name: string | null; status: string; plan: string
  currency: string; timezone: string; email: string | null; phone: string | null
  trial_ends_at: string | null; subscription_ends_at: string | null
  max_branches: number; max_users: number; developer_notes: string | null
  branches_count: number; users_count: number; created_at: string
}
type FeatureFlag = { id: string; name: string; description: string | null; enabled: boolean; conditions: Record<string, unknown> }
type Release = { id: string; version: string; title: string; changelog: string | null; is_required: boolean; is_active: boolean; published_at: string | null; created_at: string }
type ErrorEvent = { id: string; pharmacy_id: string | null; level: string; message: string; url: string | null; resolved_at: string | null; created_at: string }
type AuditEvent = { id: string; pharmacy_id: string | null; event_type: string; severity: string; description: string | null; created_at: string }
type HealthCheck = { id: string; service: string; metric: string; value: number; unit: string; status: string; checked_at: string }
type SupportSession = { id: string; pharmacy_id: string | null; reason: string | null; started_at: string }
type ControlPlaneData = {
  summary: { pharmacies: number; active: number; suspended: number; trials: number; expiring_soon: number; open_errors: number; active_support_sessions: number }
  pharmacies: Pharmacy[]; featureFlags: FeatureFlag[]; releases: Release[]; errors: ErrorEvent[]
  audits: AuditEvent[]; healthChecks: HealthCheck[]; supportSessions: SupportSession[]
  environment: { node: string; vercel: boolean; region: string | null; commitSha: string | null; serviceRoleConfigured: boolean; uploadConfigured: boolean }
  generatedAt: string
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? "تعذر تنفيذ العملية")
  return payload as T
}

function dateInput(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : ""
}

function statusColorClass(status: string): string {
  if (status === "active" || status === "healthy") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
  if (status === "suspended" || status === "warning") return "bg-amber-500/15 text-amber-300 border-amber-500/20"
  if (status === "closed" || status === "critical") return "bg-rose-500/15 text-rose-300 border-rose-500/20"
  return "bg-slate-500/15 text-slate-300 border-slate-500/20"
}

function persistSupportPharmacy(pharmacyId: string) {
  window.localStorage.setItem("active-pharmacy-id", pharmacyId)
  window.document.cookie = `active-pharmacy-id=${pharmacyId}; path=/; max-age=86400; samesite=lax`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-black text-slate-300">{label}</Label>
      {children}
    </div>
  )
}

/* ────────── Pharmacy Edit Form ────────── */

function PharmacyEditForm({ pharmacy, busy, onSave }: { pharmacy: Pharmacy; busy: string; onSave: (updates: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({
    status: pharmacy.status,
    plan: pharmacy.plan,
    trial_ends_at: dateInput(pharmacy.trial_ends_at),
    subscription_ends_at: dateInput(pharmacy.subscription_ends_at),
    max_branches: String(pharmacy.max_branches),
    max_users: String(pharmacy.max_users),
    developer_notes: pharmacy.developer_notes ?? "",
  })

  useEffect(() => {
    setForm({
      status: pharmacy.status, plan: pharmacy.plan,
      trial_ends_at: dateInput(pharmacy.trial_ends_at),
      subscription_ends_at: dateInput(pharmacy.subscription_ends_at),
      max_branches: String(pharmacy.max_branches),
      max_users: String(pharmacy.max_users),
      developer_notes: pharmacy.developer_notes ?? "",
    })
  }, [pharmacy])

  async function handleSave() {
    await onSave({
      status: form.status, plan: form.plan,
      trial_ends_at: form.trial_ends_at || null,
      subscription_ends_at: form.subscription_ends_at || null,
      max_branches: Number(form.max_branches),
      max_users: Number(form.max_users),
      developer_notes: form.developer_notes || null,
    })
  }

  function setField(key: keyof typeof form, value: string | null) {
    if (value !== null) setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="الحالة">
          <Select value={form.status} onValueChange={(v) => setField("status", v)}>
            <SelectTrigger className="border-white/10 bg-slate-950 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-slate-950 text-white">
              {PHARMACY_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-white data-highlighted:bg-white/10">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="الخطة">
          <Select value={form.plan} onValueChange={(v) => setField("plan", v)}>
            <SelectTrigger className="border-white/10 bg-slate-950 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-slate-950 text-white">
              {PLATFORM_PLANS.map((p) => (
                <SelectItem key={p} value={p} className="text-white data-highlighted:bg-white/10">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="انتهاء التجربة">
          <Input type="date" value={form.trial_ends_at} onChange={(e) => setField("trial_ends_at", e.target.value)} className="border-white/10 bg-slate-950 text-white" />
        </Field>
        <Field label="انتهاء الاشتراك">
          <Input type="date" value={form.subscription_ends_at} onChange={(e) => setField("subscription_ends_at", e.target.value)} className="border-white/10 bg-slate-950 text-white" />
        </Field>
        <Field label="حد الفروع">
          <Input type="number" min="1" value={form.max_branches} onChange={(e) => setField("max_branches", e.target.value)} className="border-white/10 bg-slate-950 text-white" />
        </Field>
        <Field label="حد المستخدمين">
          <Input type="number" min="1" value={form.max_users} onChange={(e) => setField("max_users", e.target.value)} className="border-white/10 bg-slate-950 text-white" />
        </Field>
      </div>
      <Field label="ملاحظات داخلية">
        <Textarea value={form.developer_notes} onChange={(e) => setField("developer_notes", e.target.value)} className="min-h-24 border-white/10 bg-slate-950 text-white" />
      </Field>
      <Button className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "pharmacy"} onClick={handleSave}>
        {busy === "pharmacy" ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} حفظ دورة العميل
      </Button>
    </div>
  )
}

/* ────────── Pharmacy Edit Sheet ────────── */

function PharmacyEditSheet({
  pharmacy, busy, supportReason, setSupportReason, onSave, onOpenSupport,
}: {
  pharmacy: Pharmacy; busy: string; supportReason: string; setSupportReason: (v: string) => void
  onSave: (updates: Record<string, unknown>) => Promise<void>; onOpenSupport: () => Promise<void>
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 text-white">
          <Store className="size-5 text-cyan-300" /> {pharmacy.name}
        </SheetTitle>
        <SheetDescription className="text-slate-400">{pharmacy.id}</SheetDescription>
      </SheetHeader>
      <Separator className="my-4 bg-white/10" />
      <ScrollArea className="flex-1">
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-400">الفروع</span>
                <span className="text-slate-300">{pharmacy.branches_count} / {pharmacy.max_branches}</span>
              </div>
              <Progress value={(pharmacy.branches_count / pharmacy.max_branches) * 100}>
                <ProgressTrack className="h-2 rounded-full bg-white/10">
                  <ProgressIndicator className="rounded-full bg-cyan-400" />
                </ProgressTrack>
              </Progress>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-400">المستخدمون</span>
                <span className="text-slate-300">{pharmacy.users_count} / {pharmacy.max_users}</span>
              </div>
              <Progress value={(pharmacy.users_count / pharmacy.max_users) * 100}>
                <ProgressTrack className="h-2 rounded-full bg-white/10">
                  <ProgressIndicator className="rounded-full bg-violet-400" />
                </ProgressTrack>
              </Progress>
            </div>
          </div>
          <Separator className="bg-white/10" />
          <PharmacyEditForm pharmacy={pharmacy} busy={busy} onSave={onSave} />
          <Separator className="bg-white/10" />
          <div className="space-y-3">
            <Label className="text-slate-300">سبب فتح الدعم</Label>
            <Textarea
              value={supportReason}
              onChange={(e) => setSupportReason(e.target.value)}
              className="min-h-20 border-white/10 bg-slate-950 text-white"
            />
            <Alert className="border-amber-400/20 bg-amber-400/5">
              <AlertTriangle className="size-4 text-amber-300" />
              <AlertTitle className="text-amber-200 text-sm">فتح مساحة العميل</AlertTitle>
              <AlertDescription className="text-xs text-amber-100/70">
                سيتم فتح نافذة dashboard جديدة بسياق دعم مسجل للعميل.
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              className="w-full border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
              onClick={() => void onOpenSupport()}
              disabled={busy === "support"}
            >
              {busy === "support" ? <Loader2 className="animate-spin" /> : <ExternalLink className="size-4" />}
              فتح مساحة العميل بسياق دعم
            </Button>
          </div>
        </div>
      </ScrollArea>
    </>
  )
}

/* ────────── Main View ────────── */

export function DeveloperControlPlaneView() {
  const [data, setData] = useState<ControlPlaneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [supportReason, setSupportReason] = useState("مراجعة ودعم فني بطلب العميل")
  const [onboard, setOnboard] = useState({ owner_name: "", email: "", password: "", pharmacy_name: "", phone: "", plan: "trial", max_branches: "3", max_users: "10" })
  const [flagForm, setFlagForm] = useState({ name: "", description: "", enabled: false })
  const [releaseForm, setReleaseForm] = useState({ version: "", title: "", changelog: "", is_required: false, is_active: true })
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [editPharmacyId, setEditPharmacyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await readJson<ControlPlaneData>(await fetch("/api/developer/control-plane", { cache: "no-store" }))
      setData(result)
      setSelectedId((current) => current ?? result.pharmacies[0]?.id ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل لوحة المنصة")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selected = data?.pharmacies.find((row) => row.id === selectedId) ?? null
  const editPharmacy = data?.pharmacies.find((row) => row.id === editPharmacyId) ?? null

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return data?.pharmacies ?? []
    return (data?.pharmacies ?? []).filter((row) =>
      [row.name, row.legal_name, row.email, row.phone, row.plan, row.status]
        .some((value) => String(value ?? "").toLowerCase().includes(needle))
    )
  }, [data?.pharmacies, query])

  async function action<T>(key: string, payload: Record<string, unknown>) {
    setBusy(key)
    try {
      const result = await readJson<T>(await fetch("/api/developer/control-plane", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }))
      await load()
      return result
    } finally {
      setBusy("")
    }
  }

  async function savePharmacy(updates: Record<string, unknown>) {
    if (!selected) return
    try {
      await action("pharmacy", {
        action: "update_pharmacy", pharmacy_id: selected.id, payload: updates,
      })
      toast.success("تم حفظ دورة العميل")
    } catch (error) { toast.error(error instanceof Error ? error.message : "فشل الحفظ") }
  }

  async function openSupport() {
    if (!selected) return
    try {
      await action("support", { action: "start_support_session", pharmacy_id: selected.id, reason: supportReason })
      persistSupportPharmacy(selected.id)
      toast.success("تم فتح سياق دعم مسجل")
      window.open("/dashboard", "_blank", "noopener,noreferrer")
    } catch (error) { toast.error(error instanceof Error ? error.message : "فشل فتح سياق الدعم") }
  }

  function resetOnboard() {
    setOnboard({ owner_name: "", email: "", password: "", pharmacy_name: "", phone: "", plan: "trial", max_branches: "3", max_users: "10" })
  }

  /* ── Loading state ── */
  if (loading && !data) {
    return (
      <div className="mx-auto max-w-[1700px] space-y-5 px-4 py-5 sm:px-6">
        <Skeleton className="h-32 w-full rounded-3xl bg-white/5" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl bg-white/5" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl bg-white/5" />
      </div>
    )
  }

  /* ── Error state ── */
  if (!data) {
    return (
      <div className="mx-auto max-w-[1700px] px-4 py-20 sm:px-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia><Server className="size-12 text-rose-400" /></EmptyMedia>
            <EmptyTitle>تعذر تحميل لوحة المنصة</EmptyTitle>
            <EmptyDescription>حدث خطأ في الاتصال. حاول تحديث الصفحة أو تأكد من اتصالك بالإنترنت.</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</Button>
        </Empty>
      </div>
    )
  }

  const stats = [
    { label: "كل العملاء", value: data.summary.pharmacies, icon: Building2, color: "text-cyan-300", bg: "bg-cyan-500/10" },
    { label: "نشط", value: data.summary.active, icon: CheckCircle2, color: "text-emerald-300", bg: "bg-emerald-500/10" },
    { label: "موقوف", value: data.summary.suspended, icon: ShieldAlert, color: "text-amber-300", bg: "bg-amber-500/10" },
    { label: "فترات تجريبية", value: data.summary.trials, icon: Clock3, color: "text-violet-300", bg: "bg-violet-500/10" },
    { label: "تنتهي قريبًا", value: data.summary.expiring_soon, icon: AlertTriangle, color: "text-orange-300", bg: "bg-orange-500/10" },
    { label: "أخطاء مفتوحة", value: data.summary.open_errors, icon: XCircle, color: "text-rose-300", bg: "bg-rose-500/10" },
  ] as const

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-[1700px] space-y-5 px-4 py-5 sm:px-6">
        {/* ── Header ── */}
        <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-l from-cyan-500/10 via-slate-900 to-slate-900 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-black text-cyan-300">
              <Activity className="size-4" /> PLATFORM OPERATIONS
            </div>
            <h1 className="text-2xl font-black text-white sm:text-3xl">مركز تحكم المطور</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-400">
              إدارة دورة العملاء والمنصة والإصدارات والمزايا والدعم والتدقيق من مساحة مستقلة عن تشغيل الصيدليات.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-300">
              آخر تحديث {new Date(data.generatedAt).toLocaleTimeString("ar-EG")}
            </Badge>
              <Tooltip>
                <TooltipTrigger>
                  <Button size="sm" className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> تحديث
                  </Button>
                </TooltipTrigger>
                <TooltipContent>تحديث البيانات</TooltipContent>
              </Tooltip>
          </div>
        </div>

        {/* ── Stats Cards ── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {stats.map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="border-white/10 bg-white/[0.04] text-white">
              <CardContent className="flex items-center gap-3 p-4">
                <span className={`flex size-10 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`size-5 ${color}`} />
                </span>
                <div>
                  <p className="text-2xl font-black">{value}</p>
                  <p className="text-xs font-bold text-slate-400">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="clients">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
            <TabsTrigger value="clients" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950">
              <Building2 className="size-4" /> العملاء
            </TabsTrigger>
            <TabsTrigger value="platform" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950">
              <Flag className="size-4" /> المزايا
            </TabsTrigger>
            <TabsTrigger value="releases" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950">
              <Rocket className="size-4" /> الإصدارات
            </TabsTrigger>
            <TabsTrigger value="health" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950">
              <Server className="size-4" /> الصحة
            </TabsTrigger>
            <TabsTrigger value="audit" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950">
              <ShieldAlert className="size-4" /> التدقيق
            </TabsTrigger>
          </TabsList>

          {/* ═══════════ CLIENTS TAB ═══════════ */}
          <TabsContent value="clients" id="clients" className="mt-4 space-y-4">
            {/* Onboarding Button & Sheet */}
            <Sheet open={onboardOpen} onOpenChange={setOnboardOpen}>
              <SheetTrigger render={<Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" />}>
                <Plus className="size-4" /> Onboarding عميل جديد
              </SheetTrigger>
              <SheetContent side="left" className="w-full border-white/10 bg-slate-950 text-white sm:max-w-lg">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-white">
                    <Building2 className="size-5 text-cyan-300" /> إنشاء عميل جديد
                  </SheetTitle>
                  <SheetDescription className="text-slate-400">
                    إنشاء صيدلية جديدة مع حساب المالك والفرع الرئيسي والخطة.
                  </SheetDescription>
                </SheetHeader>
                <Separator className="my-4 bg-white/10" />
                <ScrollArea className="flex-1">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="اسم المالك">
                        <Input value={onboard.owner_name} onChange={(e) => setOnboard((v) => ({ ...v, owner_name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                      <Field label="البريد الإلكتروني">
                        <Input dir="ltr" type="email" value={onboard.email} onChange={(e) => setOnboard((v) => ({ ...v, email: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                      <Field label="كلمة مرور أولية">
                        <Input dir="ltr" type="password" value={onboard.password} onChange={(e) => setOnboard((v) => ({ ...v, password: e.target.value }))} className="border-white/10 bg-slate-950 text-white" placeholder="فارغ = دعوة بالبريد" />
                      </Field>
                      <Field label="اسم الصيدلية">
                        <Input value={onboard.pharmacy_name} onChange={(e) => setOnboard((v) => ({ ...v, pharmacy_name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                      <Field label="الهاتف">
                        <Input dir="ltr" value={onboard.phone} onChange={(e) => setOnboard((v) => ({ ...v, phone: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                      <Field label="الخطة">
                        <Select value={onboard.plan} onValueChange={(plan) => setOnboard((v) => ({ ...v, plan: plan ?? "trial" }))}>
                          <SelectTrigger className="border-white/10 bg-slate-950 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-white/10 bg-slate-950 text-white">
                            {PLATFORM_PLANS.map((p) => (
                              <SelectItem key={p} value={p} className="text-white data-highlighted:bg-white/10">{p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="حد الفروع">
                        <Input type="number" min="1" value={onboard.max_branches} onChange={(e) => setOnboard((v) => ({ ...v, max_branches: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                      <Field label="حد المستخدمين">
                        <Input type="number" min="1" value={onboard.max_users} onChange={(e) => setOnboard((v) => ({ ...v, max_users: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                      </Field>
                    </div>
                  </div>
                </ScrollArea>
                <Separator className="my-4 bg-white/10" />
                <SheetFooter>
                  <SheetClose render={<Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" />}>
                    إلغاء
                  </SheetClose>
                  <Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "onboard"} onClick={async () => {
                    try {
                      await action("onboard", { action: "onboard_client", payload: { ...onboard, max_branches: Number(onboard.max_branches), max_users: Number(onboard.max_users) } })
                      resetOnboard()
                      setOnboardOpen(false)
                      toast.success("تم إنشاء العميل والفرع الرئيسي وحساب المالك")
                    } catch (error) { toast.error(error instanceof Error ? error.message : "فشل إنشاء العميل") }
                  }}>
                    {busy === "onboard" ? <Loader2 className="animate-spin" /> : <Building2 />} إنشاء العميل كاملًا
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            {/* Pharmacy List + Detail Panel */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,.8fr)]">
              {/* Pharmacy Table */}
              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader className="border-b border-white/10">
                  <CardTitle className="flex items-center justify-between">
                    <span>العملاء والصيدليات</span>
                    <div className="relative w-72">
                      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="بحث بالاسم أو البريد أو الخطة..."
                        className="h-9 w-full border-white/10 bg-slate-950/60 pr-9 text-white"
                      />
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/10 text-xs text-slate-500">
                          <TableHead className="text-right">العميل</TableHead>
                          <TableHead className="text-right">الحالة</TableHead>
                          <TableHead className="text-right">الخطة</TableHead>
                          <TableHead className="text-right">الفروع</TableHead>
                          <TableHead className="text-right">المستخدمون</TableHead>
                          <TableHead className="text-right">إجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-slate-500">
                              {query ? "لا توجد نتائج للبحث" : "لا يوجد عملاء بعد"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filtered.map((row) => (
                            <TableRow
                              key={row.id}
                              onClick={() => setSelectedId(row.id)}
                              className={`cursor-pointer border-white/5 transition hover:bg-white/5 ${selectedId === row.id ? "bg-cyan-400/5" : ""}`}
                            >
                              <TableCell className="font-medium">
                                <p className="font-black text-white">{row.name}</p>
                                <p className="text-xs text-slate-500">{row.email ?? row.phone ?? row.id}</p>
                              </TableCell>
                              <TableCell>
                                <Badge className={statusColorClass(row.status)} variant="outline">
                                  {row.status === "active" ? "نشط" : row.status === "suspended" ? "موقوف" : "مغلق"}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-bold text-slate-300">{row.plan}</TableCell>
                              <TableCell>
                                <Tooltip>
                                  <TooltipTrigger>{row.branches_count}/{row.max_branches}</TooltipTrigger>
                                  <TooltipContent>{row.branches_count} / {row.max_branches} فرع</TooltipContent>
                                </Tooltip>
                              </TableCell>
                              <TableCell>
                                <Tooltip>
                                  <TooltipTrigger>{row.users_count}/{row.max_users}</TooltipTrigger>
                                  <TooltipContent>{row.users_count} / {row.max_users} مستخدم</TooltipContent>
                                </Tooltip>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-white/10 bg-white/5 text-white"
                                  onClick={(e) => { e.stopPropagation(); setEditPharmacyId(row.id) }}
                                >
                                  إدارة
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Selected Pharmacy Detail Panel */}
              {selected && (
                <Card className="border-cyan-400/20 bg-cyan-400/[0.04] text-white">
                  <CardHeader className="border-b border-white/10">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="size-5 text-cyan-300" /> {selected.name}
                      </CardTitle>
                      <Badge className={statusColorClass(selected.status)} variant="outline">
                        {selected.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs text-slate-400">{selected.id}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 p-4">
                    {/* Usage Progress */}
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-slate-400">الفروع</span>
                          <span className="text-slate-300">{selected.branches_count} / {selected.max_branches}</span>
                        </div>
                        <Progress value={(selected.branches_count / selected.max_branches) * 100}>
                          <ProgressTrack className="h-2 rounded-full bg-white/10">
                            <ProgressIndicator className="rounded-full bg-cyan-400" />
                          </ProgressTrack>
                        </Progress>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-slate-400">المستخدمون</span>
                          <span className="text-slate-300">{selected.users_count} / {selected.max_users}</span>
                        </div>
                        <Progress value={(selected.users_count / selected.max_users) * 100}>
                          <ProgressTrack className="h-2 rounded-full bg-white/10">
                            <ProgressIndicator className="rounded-full bg-violet-400" />
                          </ProgressTrack>
                        </Progress>
                      </div>
                    </div>
                    <Separator className="bg-white/10" />
                    <PharmacyEditForm pharmacy={selected} busy={busy} onSave={savePharmacy} />
                    <Separator className="bg-white/10" />
                    <div className="space-y-3">
                      <Label className="text-slate-300">سبب فتح الدعم</Label>
                      <Textarea
                        value={supportReason}
                        onChange={(e) => setSupportReason(e.target.value)}
                        className="min-h-20 border-white/10 bg-slate-950 text-white"
                      />
                      <Alert className="border-amber-400/20 bg-amber-400/5">
                        <AlertTriangle className="size-4 text-amber-300" />
                        <AlertTitle className="text-amber-200 text-sm">فتح مساحة العميل</AlertTitle>
                        <AlertDescription className="text-xs text-amber-100/70">
                          سيتم فتح نافذة dashboard جديدة بسياق دعم مسجل للعميل.
                        </AlertDescription>
                      </Alert>
                      <Button
                        variant="outline"
                        className="w-full border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                        onClick={() => void openSupport()}
                        disabled={busy === "support"}
                      >
                        {busy === "support" ? <Loader2 className="animate-spin" /> : <ExternalLink className="size-4" />}
                        فتح مساحة العميل بسياق دعم مسجل
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Edit Pharmacy Sheet (triggered from table Manage button) */}
            <Sheet open={editPharmacyId !== null} onOpenChange={(open) => { if (!open) setEditPharmacyId(null) }}>
              <SheetContent side="left" className="w-full border-white/10 bg-slate-950 text-white sm:max-w-md">
                {editPharmacy && (
                  <PharmacyEditSheet
                    pharmacy={editPharmacy}
                    busy={busy}
                    supportReason={supportReason}
                    setSupportReason={setSupportReason}
                    onSave={async (updates) => {
                      await savePharmacy(updates)
                      setEditPharmacyId(null)
                    }}
                    onOpenSupport={openSupport}
                  />
                )}
              </SheetContent>
            </Sheet>
          </TabsContent>

          {/* ═══════════ PLATFORM TAB ═══════════ */}
          <TabsContent value="platform" id="platform" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
              <Card className="h-fit border-white/10 bg-white/[0.04] text-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Flag className="size-5 text-cyan-300" /> إضافة Feature Flag</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="الاسم التقني">
                    <Input dir="ltr" value={flagForm.name} onChange={(e) => setFlagForm((v) => ({ ...v, name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" placeholder="new_cashier_flow" />
                  </Field>
                  <Field label="الوصف">
                    <Textarea value={flagForm.description} onChange={(e) => setFlagForm((v) => ({ ...v, description: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                  </Field>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <Label>مفعلة افتراضيًا</Label>
                    <Switch checked={flagForm.enabled} onCheckedChange={(enabled) => setFlagForm((v) => ({ ...v, enabled }))} />
                  </div>
                  <Button className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "flag"} onClick={async () => {
                    try { await action("flag", { action: "upsert_feature_flag", payload: flagForm }); setFlagForm({ name: "", description: "", enabled: false }); toast.success("تم حفظ الميزة") } catch (e) { toast.error(e instanceof Error ? e.message : "فشل الحفظ") }
                  }}>
                    {busy === "flag" ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} حفظ الميزة
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader><CardTitle>مفاتيح المزايا</CardTitle></CardHeader>
                <CardContent>
                  {data.featureFlags.length === 0 ? (
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia><Flag className="size-8 text-slate-500" /></EmptyMedia>
                        <EmptyTitle>لا توجد مفاتيح مزايا</EmptyTitle>
                        <EmptyDescription>أضف أول feature flag من النموذج المجاور</EmptyDescription>
                      </EmptyContent>
                    </Empty>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {data.featureFlags.map((flag) => (
                        <div key={flag.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                          <div className="flex items-center justify-between">
                            <Tooltip>
                              <TooltipTrigger>
                                <code className="max-w-[160px] truncate text-xs font-black text-cyan-300">{flag.name}</code>
                              </TooltipTrigger>
                              <TooltipContent>{flag.name}</TooltipContent>
                            </Tooltip>
                            <Badge className={flag.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}>
                              {flag.enabled ? "ON" : "OFF"}
                            </Badge>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-6 text-slate-400">{flag.description ?? "بدون وصف"}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 border-white/10 bg-white/5 text-white hover:bg-white/10"
                            onClick={() => void action("flag", { action: "upsert_feature_flag", payload: { ...flag, enabled: !flag.enabled } })}
                            disabled={busy === "flag"}
                          >
                            {flag.enabled ? "إيقاف" : "تفعيل"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══════════ RELEASES TAB ═══════════ */}
          <TabsContent value="releases" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
              <Card className="h-fit border-white/10 bg-white/[0.04] text-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Rocket className="size-5 text-cyan-300" /> إصدار جديد</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="الإصدار (SemVer)">
                    <Input dir="ltr" value={releaseForm.version} onChange={(e) => setReleaseForm((v) => ({ ...v, version: e.target.value }))} placeholder="1.1.0" className="border-white/10 bg-slate-950 text-white" />
                  </Field>
                  <Field label="العنوان">
                    <Input value={releaseForm.title} onChange={(e) => setReleaseForm((v) => ({ ...v, title: e.target.value }))} className="border-white/10 bg-slate-950 text-white" />
                  </Field>
                  <Field label="سجل التغييرات">
                    <Textarea value={releaseForm.changelog} onChange={(e) => setReleaseForm((v) => ({ ...v, changelog: e.target.value }))} className="min-h-24 border-white/10 bg-slate-950 text-white" />
                  </Field>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <Label>إصدار إجباري</Label>
                    <Switch checked={releaseForm.is_required} onCheckedChange={(value) => setReleaseForm((v) => ({ ...v, is_required: value }))} />
                  </div>
                  <Button className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "release"} onClick={async () => {
                    try { await action("release", { action: "publish_release", payload: releaseForm }); setReleaseForm({ version: "", title: "", changelog: "", is_required: false, is_active: true }); toast.success("تم نشر الإصدار") } catch (e) { toast.error(e instanceof Error ? e.message : "فشل النشر") }
                  }}>
                    {busy === "release" ? <Loader2 className="animate-spin" /> : <Rocket className="size-4" />} نشر الإصدار
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader><CardTitle>سجل الإصدارات</CardTitle></CardHeader>
                <CardContent>
                  {data.releases.length === 0 ? (
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia><Rocket className="size-8 text-slate-500" /></EmptyMedia>
                        <EmptyTitle>لا توجد إصدارات</EmptyTitle>
                        <EmptyDescription>انشر أول إصدار من النموذج المجاور</EmptyDescription>
                      </EmptyContent>
                    </Empty>
                  ) : (
                    <ScrollArea className="max-h-[500px]">
                      <div className="space-y-2">
                        {data.releases.map((release) => (
                          <div key={release.id} className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <code className="font-black text-cyan-300">v{release.version}</code>
                                {release.is_active && <Badge className="bg-emerald-500/15 text-emerald-300">الحالي</Badge>}
                                {release.is_required && <Badge className="bg-rose-500/15 text-rose-300">إجباري</Badge>}
                              </div>
                              <p className="mt-1 font-black">{release.title}</p>
                              {release.changelog && (
                                <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-slate-400">{release.changelog}</p>
                              )}
                            </div>
                            <span className="shrink-0 text-xs text-slate-500">
                              {new Date(release.created_at).toLocaleDateString("ar-EG")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══════════ HEALTH TAB ═══════════ */}
          <TabsContent value="health" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Server className="size-5 text-cyan-300" /> بيئة التشغيل</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {Object.entries(data.environment).map(([key, value]) => (
                    <div key={key} className="flex justify-between rounded-xl border border-white/10 p-3">
                      <span className="text-slate-400">{key}</span>
                      <span className="max-w-[220px] truncate font-mono text-xs text-white">
                        {String(value ?? "—")}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.04] text-white xl:col-span-2">
                <CardHeader><CardTitle>آخر فحوصات الصحة</CardTitle></CardHeader>
                <CardContent>
                  {data.healthChecks.length === 0 ? (
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia><Activity className="size-8 text-slate-500" /></EmptyMedia>
                        <EmptyTitle>لا توجد فحوصات</EmptyTitle>
                      </EmptyContent>
                    </Empty>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      <div className="grid gap-2 md:grid-cols-2">
                        {data.healthChecks.map((check) => (
                          <div key={check.id} className="rounded-xl border border-white/10 p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-black">{check.service}</span>
                              <Badge variant="outline" className={statusColorClass(check.status)}>
                                {check.status === "healthy" ? "سليم" : check.status === "warning" ? "تحذير" : "خطير"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">{check.metric}: {check.value} {check.unit}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.04] text-white xl:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-rose-300">
                    <XCircle className="size-5" /> الأخطاء المركزية
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.errors.length === 0 ? (
                    <Alert className="border-emerald-400/20 bg-emerald-400/5">
                      <CheckCircle2 className="size-4 text-emerald-300" />
                      <AlertTitle className="text-emerald-200">لا توجد أخطاء مفتوحة</AlertTitle>
                      <AlertDescription className="text-emerald-100/70">النظام يعمل بشكل طبيعي.</AlertDescription>
                    </Alert>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      <div className="space-y-2">
                        {data.errors.map((error) => (
                          <div key={error.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
                            <XCircle className={`size-5 shrink-0 ${error.resolved_at ? "text-slate-600" : "text-rose-400"}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-bold">{error.message}</p>
                              <p className="text-xs text-slate-500">
                                {error.url ?? "بدون رابط"} · {new Date(error.created_at).toLocaleString("ar-EG")}
                              </p>
                            </div>
                            {!error.resolved_at && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 border-white/10 bg-white/5 text-white hover:bg-white/10"
                                    onClick={() => void action("error", { action: "resolve_error", error_id: error.id })}
                                    disabled={busy === "error"}
                                  >
                                    {busy === "error" ? <Loader2 className="animate-spin" /> : <CheckCircle2 className="size-4" />}
                                    إغلاق
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>إغلاق الخطأ</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══════════ AUDIT TAB ═══════════ */}
          <TabsContent value="audit" className="mt-4">
            <div className="space-y-4">
              {data.supportSessions.length > 0 && (
                <Alert className="border-amber-400/20 bg-amber-400/5">
                  <AlertTriangle className="size-4 text-amber-300" />
                  <AlertTitle className="text-amber-200">جلسات الدعم المفتوحة ({data.supportSessions.length})</AlertTitle>
                  <AlertDescription className="mt-2 space-y-2">
                    {data.supportSessions.map((session) => {
                      const pharmacy = data.pharmacies.find((row) => row.id === session.pharmacy_id)
                      return (
                        <div key={session.id} className="flex items-center gap-3 rounded-xl border border-amber-400/15 p-3">
                          <ExternalLink className="size-4 shrink-0 text-amber-300" />
                          <div className="flex-1">
                            <p className="font-bold">{pharmacy?.name ?? session.pharmacy_id}</p>
                            <p className="text-xs text-slate-400">
                              {session.reason} · {new Date(session.started_at).toLocaleString("ar-EG")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                            onClick={() => void action("end-support", { action: "end_support_session", session_id: session.id })}
                            disabled={busy === "end-support"}
                          >
                            {busy === "end-support" ? <Loader2 className="animate-spin" /> : null}
                            إنهاء
                          </Button>
                        </div>
                      )
                    })}
                  </AlertDescription>
                </Alert>
              )}

              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code2 className="size-5 text-cyan-300" /> سجل تحكم المطور
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.audits.length === 0 ? (
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia><FileText className="size-8 text-slate-500" /></EmptyMedia>
                        <EmptyTitle>لا توجد أحداث تدقيق</EmptyTitle>
                        <EmptyDescription>تظهر أحداث تحكم المطور هنا بعد تنفيذ الإجراءات.</EmptyDescription>
                      </EmptyContent>
                    </Empty>
                  ) : (
                    <ScrollArea className="max-h-[500px]">
                      <div className="space-y-2">
                        {data.audits.map((event) => (
                          <div key={event.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3">
                            <Code2 className="mt-0.5 size-4 shrink-0 text-cyan-300" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <code className="text-xs font-black text-cyan-300">{event.event_type}</code>
                                <Badge variant="outline" className={statusColorClass(event.severity)}>
                                  {event.severity}
                                </Badge>
                              </div>
                              <p className="mt-1 text-sm font-bold">{event.description ?? "بدون وصف"}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {new Date(event.created_at).toLocaleString("ar-EG")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}
