"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity, AlertTriangle, Building2, CheckCircle2, Clock3, Code2, ExternalLink,
  Flag, Loader2, RefreshCw, Rocket, Save, Server, ShieldAlert, XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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

function statusBadge(status: string) {
  if (status === "active" || status === "healthy") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
  if (status === "suspended" || status === "warning") return "border-amber-400/30 bg-amber-400/10 text-amber-300"
  return "border-rose-400/30 bg-rose-400/10 text-rose-300"
}

function persistSupportPharmacy(pharmacyId: string) {
  window.localStorage.setItem("active-pharmacy-id", pharmacyId)
  window.document.cookie = `active-pharmacy-id=${pharmacyId}; path=/; max-age=86400; samesite=lax`
}

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
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return data?.pharmacies ?? []
    return (data?.pharmacies ?? []).filter((row) => [row.name, row.legal_name, row.email, row.phone, row.plan, row.status].some((value) => String(value ?? "").toLowerCase().includes(needle)))
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

  async function savePharmacy(form: HTMLFormElement) {
    if (!selected) return
    const values = new FormData(form)
    try {
      await action("pharmacy", {
        action: "update_pharmacy", pharmacy_id: selected.id,
        payload: {
          status: values.get("status"), plan: values.get("plan"),
          trial_ends_at: values.get("trial_ends_at"), subscription_ends_at: values.get("subscription_ends_at"),
          max_branches: values.get("max_branches"), max_users: values.get("max_users"),
          developer_notes: values.get("developer_notes"),
        },
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

  if (loading && !data) return <div className="flex min-h-[70dvh] items-center justify-center"><Loader2 className="size-8 animate-spin text-cyan-300" /></div>
  if (!data) return <div className="p-10 text-center text-rose-300">تعذر تحميل لوحة المنصة.</div>

  const stats = [
    ["كل العملاء", data.summary.pharmacies, Building2, "text-cyan-300"],
    ["نشط", data.summary.active, CheckCircle2, "text-emerald-300"],
    ["موقوف", data.summary.suspended, ShieldAlert, "text-amber-300"],
    ["فترات تجريبية", data.summary.trials, Clock3, "text-violet-300"],
    ["تنتهي قريبًا", data.summary.expiring_soon, AlertTriangle, "text-orange-300"],
    ["أخطاء مفتوحة", data.summary.open_errors, XCircle, "text-rose-300"],
  ] as const

  return (
    <section className="mx-auto max-w-[1700px] space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-l from-cyan-500/10 via-slate-900 to-slate-900 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-black text-cyan-300"><Activity className="size-4" /> PLATFORM OPERATIONS</div>
          <h1 className="text-2xl font-black text-white sm:text-3xl">مركز تحكم المطور</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-400">إدارة دورة العملاء والمنصة والإصدارات والمزايا والدعم والتدقيق من مساحة مستقلة عن تشغيل الصيدليات.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="border-white/10 bg-white/5 text-slate-300">آخر تحديث {new Date(data.generatedAt).toLocaleTimeString("ar-EG")}</Badge>
          <Button size="sm" className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> تحديث
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stats.map(([label, value, Icon, color]) => (
          <Card key={label} className="border-white/10 bg-white/[0.04] text-white">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/5"><Icon className={`size-5 ${color}`} /></span>
              <div><p className="text-2xl font-black">{value}</p><p className="text-xs font-bold text-slate-400">{label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="clients">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
          <TabsTrigger value="clients" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950"><Building2 /> العملاء</TabsTrigger>
          <TabsTrigger value="platform" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950"><Flag /> المزايا</TabsTrigger>
          <TabsTrigger value="releases" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950"><Rocket /> الإصدارات</TabsTrigger>
          <TabsTrigger value="health" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950"><Server /> الصحة</TabsTrigger>
          <TabsTrigger value="audit" className="min-w-28 rounded-xl px-4 py-2 data-active:bg-cyan-400 data-active:text-slate-950"><ShieldAlert /> التدقيق</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" id="clients" className="mt-4">
          <Card className="mb-4 border-white/10 bg-white/[0.04] text-white">
            <CardHeader className="border-b border-white/10"><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-cyan-300" /> Onboarding عميل جديد</CardTitle></CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="اسم المالك"><Input value={onboard.owner_name} onChange={(e) => setOnboard((v) => ({ ...v, owner_name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="البريد الإلكتروني"><Input dir="ltr" type="email" value={onboard.email} onChange={(e) => setOnboard((v) => ({ ...v, email: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="كلمة مرور أولية (اختياري)"><Input dir="ltr" type="password" value={onboard.password} onChange={(e) => setOnboard((v) => ({ ...v, password: e.target.value }))} className="border-white/10 bg-slate-950 text-white" placeholder="فارغ = دعوة بالبريد" /></Field>
              <Field label="اسم الصيدلية"><Input value={onboard.pharmacy_name} onChange={(e) => setOnboard((v) => ({ ...v, pharmacy_name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="الهاتف"><Input dir="ltr" value={onboard.phone} onChange={(e) => setOnboard((v) => ({ ...v, phone: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="الخطة"><select value={onboard.plan} onChange={(e) => setOnboard((v) => ({ ...v, plan: e.target.value }))} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm">{PLATFORM_PLANS.map((v) => <option key={v}>{v}</option>)}</select></Field>
              <Field label="حد الفروع"><Input type="number" min="1" value={onboard.max_branches} onChange={(e) => setOnboard((v) => ({ ...v, max_branches: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="حد المستخدمين"><Input type="number" min="1" value={onboard.max_users} onChange={(e) => setOnboard((v) => ({ ...v, max_users: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Button className="md:col-span-2 xl:col-span-4 bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "onboard"} onClick={async () => {
                try {
                  await action("onboard", { action: "onboard_client", payload: { ...onboard, max_branches: Number(onboard.max_branches), max_users: Number(onboard.max_users) } })
                  setOnboard({ owner_name: "", email: "", password: "", pharmacy_name: "", phone: "", plan: "trial", max_branches: "3", max_users: "10" })
                  toast.success("تم إنشاء العميل والفرع الرئيسي وحساب المالك")
                } catch (error) { toast.error(error instanceof Error ? error.message : "فشل إنشاء العميل") }
              }}>
                {busy === "onboard" ? <Loader2 className="animate-spin" /> : <Building2 />} إنشاء العميل كاملًا
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,.8fr)]">
            <Card className="border-white/10 bg-white/[0.04] text-white">
              <CardHeader className="border-b border-white/10"><CardTitle className="flex items-center justify-between"><span>العملاء والصيدليات</span><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو البريد أو الخطة..." className="h-9 w-72 border-white/10 bg-slate-950/60 text-white" /></CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="text-xs text-slate-500"><tr className="border-b border-white/10"><th className="p-3">العميل</th><th className="p-3">الحالة</th><th className="p-3">الخطة</th><th className="p-3">الفروع</th><th className="p-3">المستخدمون</th><th className="p-3">إجراء</th></tr></thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr key={row.id} onClick={() => setSelectedId(row.id)} className={`cursor-pointer border-b border-white/5 transition hover:bg-white/5 ${selectedId === row.id ? "bg-cyan-400/5" : ""}`}>
                          <td className="p-3"><p className="font-black text-white">{row.name}</p><p className="text-xs text-slate-500">{row.email ?? row.phone ?? row.id}</p></td>
                          <td className="p-3"><Badge variant="outline" className={statusBadge(row.status)}>{row.status}</Badge></td>
                          <td className="p-3 font-bold text-slate-300">{row.plan}</td>
                          <td className="p-3">{row.branches_count}/{row.max_branches}</td>
                          <td className="p-3">{row.users_count}/{row.max_users}</td>
                          <td className="p-3"><Button size="sm" variant="outline" className="border-white/10 bg-white/5 text-white" onClick={(e) => { e.stopPropagation(); setSelectedId(row.id) }}>إدارة</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {selected ? (
              <Card className="border-cyan-400/20 bg-cyan-400/[0.04] text-white">
                <CardHeader className="border-b border-white/10"><CardTitle>{selected.name}</CardTitle><p className="text-xs text-slate-400">{selected.id}</p></CardHeader>
                <CardContent className="space-y-5 p-4">
                  <form onSubmit={(e) => { e.preventDefault(); void savePharmacy(e.currentTarget) }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="الحالة"><select name="status" defaultValue={selected.status} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm">{PHARMACY_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></Field>
                      <Field label="الخطة"><select name="plan" defaultValue={selected.plan} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm">{PLATFORM_PLANS.map((v) => <option key={v}>{v}</option>)}</select></Field>
                      <Field label="انتهاء التجربة"><Input name="trial_ends_at" type="date" defaultValue={dateInput(selected.trial_ends_at)} className="border-white/10 bg-slate-950 text-white" /></Field>
                      <Field label="انتهاء الاشتراك"><Input name="subscription_ends_at" type="date" defaultValue={dateInput(selected.subscription_ends_at)} className="border-white/10 bg-slate-950 text-white" /></Field>
                      <Field label="حد الفروع"><Input name="max_branches" type="number" min="1" defaultValue={selected.max_branches} className="border-white/10 bg-slate-950 text-white" /></Field>
                      <Field label="حد المستخدمين"><Input name="max_users" type="number" min="1" defaultValue={selected.max_users} className="border-white/10 bg-slate-950 text-white" /></Field>
                    </div>
                    <Field label="ملاحظات داخلية"><Textarea name="developer_notes" defaultValue={selected.developer_notes ?? ""} className="min-h-24 border-white/10 bg-slate-950 text-white" /></Field>
                    <Button className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={busy === "pharmacy"}>{busy === "pharmacy" ? <Loader2 className="animate-spin" /> : <Save />} حفظ دورة العميل</Button>
                  </form>
                  <div className="border-t border-white/10 pt-4">
                    <Label className="text-slate-300">سبب فتح الدعم</Label>
                    <Textarea value={supportReason} onChange={(e) => setSupportReason(e.target.value)} className="mt-2 min-h-20 border-white/10 bg-slate-950 text-white" />
                    <Button variant="outline" className="mt-2 w-full border-amber-400/20 bg-amber-400/10 text-amber-200" onClick={() => void openSupport()} disabled={busy === "support"}>
                      <ExternalLink /> فتح مساحة العميل بسياق دعم مسجل
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="platform" id="platform" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <Card className="border-white/10 bg-white/[0.04] text-white">
              <CardHeader><CardTitle>إضافة Feature Flag</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label="الاسم التقني"><Input dir="ltr" value={flagForm.name} onChange={(e) => setFlagForm((v) => ({ ...v, name: e.target.value }))} className="border-white/10 bg-slate-950 text-white" placeholder="new_cashier_flow" /></Field>
                <Field label="الوصف"><Textarea value={flagForm.description} onChange={(e) => setFlagForm((v) => ({ ...v, description: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
                <div className="flex items-center justify-between"><Label>مفعلة افتراضيًا</Label><Switch checked={flagForm.enabled} onCheckedChange={(enabled) => setFlagForm((v) => ({ ...v, enabled }))} /></div>
                <Button className="w-full bg-cyan-400 text-slate-950" onClick={async () => { try { await action("flag", { action: "upsert_feature_flag", payload: flagForm }); setFlagForm({ name: "", description: "", enabled: false }); toast.success("تم حفظ الميزة") } catch (e) { toast.error(e instanceof Error ? e.message : "فشل الحفظ") } }}><Flag /> حفظ الميزة</Button>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-white/[0.04] text-white">
              <CardHeader><CardTitle>مفاتيح المزايا</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.featureFlags.map((flag) => <div key={flag.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="flex items-center justify-between"><code className="text-xs font-black text-cyan-300">{flag.name}</code><Badge className={flag.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}>{flag.enabled ? "ON" : "OFF"}</Badge></div><p className="mt-2 text-xs leading-6 text-slate-400">{flag.description ?? "بدون وصف"}</p><Button size="sm" variant="outline" className="mt-3 border-white/10 bg-white/5 text-white" onClick={() => void action("flag", { action: "upsert_feature_flag", payload: { ...flag, enabled: !flag.enabled } })}>{flag.enabled ? "إيقاف" : "تفعيل"}</Button></div>)}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="releases" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <Card className="border-white/10 bg-white/[0.04] text-white"><CardHeader><CardTitle>إصدار جديد</CardTitle></CardHeader><CardContent className="space-y-3">
              <Field label="الإصدار"><Input dir="ltr" value={releaseForm.version} onChange={(e) => setReleaseForm((v) => ({ ...v, version: e.target.value }))} placeholder="1.1.0" className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="العنوان"><Input value={releaseForm.title} onChange={(e) => setReleaseForm((v) => ({ ...v, title: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <Field label="سجل التغييرات"><Textarea value={releaseForm.changelog} onChange={(e) => setReleaseForm((v) => ({ ...v, changelog: e.target.value }))} className="border-white/10 bg-slate-950 text-white" /></Field>
              <div className="flex items-center justify-between"><Label>إصدار إجباري</Label><Switch checked={releaseForm.is_required} onCheckedChange={(value) => setReleaseForm((v) => ({ ...v, is_required: value }))} /></div>
              <Button className="w-full bg-cyan-400 text-slate-950" onClick={async () => { try { await action("release", { action: "publish_release", payload: releaseForm }); setReleaseForm({ version: "", title: "", changelog: "", is_required: false, is_active: true }); toast.success("تم نشر الإصدار") } catch (e) { toast.error(e instanceof Error ? e.message : "فشل النشر") } }}><Rocket /> نشر الإصدار</Button>
            </CardContent></Card>
            <Card className="border-white/10 bg-white/[0.04] text-white"><CardHeader><CardTitle>سجل الإصدارات</CardTitle></CardHeader><CardContent className="space-y-2">{data.releases.map((release) => <div key={release.id} className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div><div className="flex items-center gap-2"><code className="font-black text-cyan-300">v{release.version}</code>{release.is_active && <Badge className="bg-emerald-500/15 text-emerald-300">الحالي</Badge>}{release.is_required && <Badge className="bg-rose-500/15 text-rose-300">إجباري</Badge>}</div><p className="mt-1 font-black">{release.title}</p><p className="mt-1 text-xs leading-6 text-slate-400">{release.changelog ?? "لا يوجد سجل تغييرات"}</p></div><span className="text-xs text-slate-500">{new Date(release.created_at).toLocaleDateString("ar-EG")}</span></div>)}</CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-white/10 bg-white/[0.04] text-white"><CardHeader><CardTitle><Server className="inline size-5 text-cyan-300" /> بيئة التشغيل</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{Object.entries(data.environment).map(([key, value]) => <div key={key} className="flex justify-between rounded-xl border border-white/10 p-3"><span className="text-slate-400">{key}</span><span className="max-w-[220px] truncate font-mono text-xs text-white">{String(value ?? "—")}</span></div>)}</CardContent></Card>
            <Card className="border-white/10 bg-white/[0.04] text-white xl:col-span-2"><CardHeader><CardTitle>آخر فحوصات الصحة</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{data.healthChecks.map((check) => <div key={check.id} className="rounded-xl border border-white/10 p-3"><div className="flex justify-between"><span className="font-black">{check.service}</span><Badge variant="outline" className={statusBadge(check.status)}>{check.status}</Badge></div><p className="mt-1 text-xs text-slate-400">{check.metric}: {check.value} {check.unit}</p></div>)}</CardContent></Card>
            <Card className="border-white/10 bg-white/[0.04] text-white xl:col-span-3"><CardHeader><CardTitle className="text-rose-300">الأخطاء المركزية</CardTitle></CardHeader><CardContent className="space-y-2">{data.errors.map((error) => <div key={error.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3"><XCircle className={error.resolved_at ? "size-5 text-slate-600" : "size-5 text-rose-400"} /><div className="min-w-0 flex-1"><p className="truncate font-bold">{error.message}</p><p className="text-xs text-slate-500">{error.url ?? "بدون رابط"} · {new Date(error.created_at).toLocaleString("ar-EG")}</p></div>{!error.resolved_at && <Button size="sm" variant="outline" className="border-white/10 bg-white/5 text-white" onClick={() => void action("error", { action: "resolve_error", error_id: error.id })}>إغلاق</Button>}</div>)}</CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <div className="space-y-4">
            {data.supportSessions.length > 0 ? <Card className="border-amber-400/20 bg-amber-400/[0.05] text-white"><CardHeader><CardTitle className="text-amber-200">جلسات الدعم المفتوحة</CardTitle></CardHeader><CardContent className="space-y-2">{data.supportSessions.map((session) => <div key={session.id} className="flex items-center gap-3 rounded-xl border border-amber-400/15 p-3"><ExternalLink className="size-4 text-amber-300" /><div className="flex-1"><p className="font-bold">{data.pharmacies.find((row) => row.id === session.pharmacy_id)?.name ?? session.pharmacy_id}</p><p className="text-xs text-slate-400">{session.reason} · {new Date(session.started_at).toLocaleString("ar-EG")}</p></div><Button size="sm" variant="outline" className="border-amber-400/20 bg-amber-400/10 text-amber-200" onClick={() => void action("end-support", { action: "end_support_session", session_id: session.id })}>إنهاء</Button></div>)}</CardContent></Card> : null}
            <Card className="border-white/10 bg-white/[0.04] text-white"><CardHeader><CardTitle>سجل تحكم المطور</CardTitle></CardHeader><CardContent className="space-y-2">{data.audits.map((event) => <div key={event.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3"><Code2 className="mt-0.5 size-4 text-cyan-300" /><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><code className="text-xs font-black text-cyan-300">{event.event_type}</code><Badge variant="outline" className={statusBadge(event.severity)}>{event.severity}</Badge></div><p className="mt-1 text-sm font-bold">{event.description ?? "بدون وصف"}</p><p className="mt-1 text-xs text-slate-500">{new Date(event.created_at).toLocaleString("ar-EG")}</p></div></div>)}</CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-black text-slate-300">{label}</Label>{children}</div>
}
