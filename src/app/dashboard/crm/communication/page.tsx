"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText, Loader2, Mail, MessageSquare, Phone, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Partner = { id: string; name: string; type: string; phone?: string | null; email?: string | null }
type Communication = {
  id: string
  partner_id?: string | null
  partner_name?: string | null
  channel: string
  direction: string
  subject: string
  body: string
  status: string
  occurred_at: string
  partner?: Partner | null
}
type CommunicationResponse = {
  communications?: Communication[]
  pagination?: { page: number; totalPages: number; total: number }
  error?: string
}

type FormState = {
  partner_id: string
  partner_name: string
  channel: string
  direction: string
  subject: string
  body: string
  status: string
}

const EMPTY_FORM: FormState = {
  partner_id: "none",
  partner_name: "",
  channel: "note",
  direction: "outbound",
  subject: "",
  body: "",
  status: "completed",
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "بريد إلكتروني",
  whatsapp: "واتساب",
  phone: "مكالمة",
  sms: "رسالة SMS",
  note: "ملاحظة",
}
const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  sent: "مرسل",
  read: "مقروء",
  completed: "مكتمل",
  failed: "فشل",
}

function channelIcon(channel: string) {
  if (channel === "email") return Mail
  if (channel === "whatsapp") return MessageSquare
  if (channel === "phone") return Phone
  if (channel === "note") return FileText
  return MessageSquare
}

function statusClass(status: string) {
  if (status === "completed" || status === "read") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700"
  if (status === "draft") return "border-slate-200 bg-slate-50 text-slate-600"
  return "border-blue-200 bg-blue-50 text-blue-700"
}

export default function CommunicationPage() {
  const auth = useAuth()
  const canWrite = auth.isDeveloper || auth.can("crm:write")
  const [rows, setRows] = useState<Communication[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState("all")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const selectedPartner = useMemo(() => partners.find((partner) => partner.id === form.partner_id), [form.partner_id, partners])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        page: String(page),
        page_size: "25",
      })
      if (query.trim()) params.set("query", query.trim())
      if (channel !== "all") params.set("channel", channel)
      if (status !== "all") params.set("status", status)
      if (auth.activeBranchId) params.set("branch_id", auth.activeBranchId)
      const response = await fetch(`/api/crm/communications?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as CommunicationResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل سجل التواصل")
      setRows(data.communications ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل سجل التواصل")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, channel, page, query, status])

  const loadPartners = useCallback(async () => {
    if (!auth.activePharmacyId || !canWrite) return
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, page_size: "250", status: "active" })
      const response = await fetch(`/api/partners?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { partners?: Partner[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل جهات الاتصال")
      setPartners(data.partners ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل جهات الاتصال")
    }
  }, [auth.activePharmacyId, canWrite])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])
  useEffect(() => { void loadPartners() }, [loadPartners])
  useEffect(() => { setPage(1) }, [channel, query, status])

  async function createCommunication() {
    if (!auth.activePharmacyId || !canWrite) return
    if (!form.subject.trim() && !form.body.trim()) {
      toast.error("اكتب عنوانًا أو تفاصيل للتواصل")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/crm/communications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          partner_id: form.partner_id === "none" ? null : form.partner_id,
          partner_name: selectedPartner?.name ?? form.partner_name,
          channel: form.channel,
          direction: form.direction,
          subject: form.subject,
          body: form.body,
          status: form.status,
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ التواصل")
      toast.success("تم حفظ التواصل في السجل")
      setOpen(false)
      setForm(EMPTY_FORM)
      setPage(1)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ التواصل")
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(row: Communication, nextStatus: string) {
    if (!canWrite || nextStatus === row.status) return
    const previous = rows
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: nextStatus } : item))
    try {
      const response = await fetch("/api/crm/communications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, pharmacy_id: auth.activePharmacyId, status: nextStatus }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحديث الحالة")
      toast.success("تم تحديث حالة التواصل")
    } catch (error) {
      setRows(previous)
      toast.error(error instanceof Error ? error.message : "فشل تحديث الحالة")
    }
  }

  async function remove(row: Communication) {
    if (!canWrite || !window.confirm(`حذف سجل التواصل مع ${row.partner?.name ?? row.partner_name ?? "الجهة"}؟`)) return
    try {
      const params = new URLSearchParams({ id: row.id })
      if (auth.activePharmacyId) params.set("pharmacy_id", auth.activePharmacyId)
      const response = await fetch(`/api/crm/communications?${params.toString()}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حذف التواصل")
      toast.success("تم حذف سجل التواصل")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف التواصل")
    }
  }

  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="سجل التواصل"
          subtitle="تسجيل ومتابعة البريد والواتساب والمكالمات والملاحظات مع العملاء والموردين."
          icon={MessageSquare}
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? <Button className="h-10 rounded-xl" onClick={() => setOpen(true)}><Plus className="size-4" /> تسجيل تواصل</Button> : null}
            </div>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 rounded-xl pr-9" placeholder="ابحث بالجهة أو العنوان أو التفاصيل" />
            </div>
            <Select value={channel} onValueChange={(value) => setChannel(value ?? "all")}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل القنوات</SelectItem>{Object.entries(CHANNEL_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value ?? "all")}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل الحالات</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-0">
            {loading ? <div className="p-4"><SkeletonRows count={6} /></div> : rows.length === 0 ? (
              <EmptyState icon={MessageSquare} title="لا يوجد تواصل مسجل" description="سجّل المكالمات والرسائل والملاحظات بدل الاعتماد على بيانات تجريبية." />
            ) : (
              <div className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const Icon = channelIcon(row.channel)
                  return (
                    <div key={row.id} className="grid gap-3 p-4 transition hover:bg-slate-50/70 lg:grid-cols-[minmax(0,1fr)_170px_170px_auto] lg:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><Icon className="size-5" /></span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-black text-slate-950">{row.partner?.name ?? row.partner_name ?? "تواصل عام"}</p>
                            <Badge variant="outline" className="font-black">{row.direction === "inbound" ? "وارد" : "صادر"}</Badge>
                          </div>
                          <p className="mt-1 truncate text-sm font-black text-slate-700">{row.subject || "بدون عنوان"}</p>
                          {row.body ? <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{row.body}</p> : null}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-slate-500">
                        <p>{CHANNEL_LABELS[row.channel] ?? row.channel}</p>
                        <p className="mt-1" dir="ltr">{new Date(row.occurred_at).toLocaleString("ar-EG")}</p>
                      </div>
                      {canWrite ? (
                        <Select value={row.status} onValueChange={(value) => void updateStatus(row, value ?? row.status)}>
                          <SelectTrigger className={cn("h-9 rounded-xl border font-black", statusClass(row.status))}><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : <Badge variant="outline" className={cn("w-fit font-black", statusClass(row.status))}>{STATUS_LABELS[row.status] ?? row.status}</Badge>}
                      {canWrite ? <Button variant="ghost" size="icon" className="size-9 text-rose-500" onClick={() => void remove(row)} title="حذف"><Trash2 className="size-4" /></Button> : null}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <span className="text-xs font-black text-slate-500">{total.toLocaleString("ar-EG")} سجل — صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
              <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl" className="max-w-xl rounded-3xl text-right">
            <DialogHeader className="text-right"><DialogTitle>تسجيل تواصل جديد</DialogTitle><DialogDescription>احفظ التواصل الحقيقي مع العميل أو المورد في سجل الصيدلية.</DialogDescription></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2"><Label>جهة الاتصال</Label><Select value={form.partner_id} onValueChange={(value) => setForm((current) => ({ ...current, partner_id: value ?? "none" }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون جهة مسجلة</SelectItem>{partners.map((partner) => <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>)}</SelectContent></Select></div>
              {form.partner_id === "none" ? <div className="grid gap-2"><Label>اسم الجهة</Label><Input value={form.partner_name} onChange={(event) => setForm((current) => ({ ...current, partner_name: event.target.value }))} className="h-10 rounded-xl" placeholder="عميل، مورد، طبيب..." /></div> : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2"><Label>القناة</Label><Select value={form.channel} onValueChange={(value) => setForm((current) => ({ ...current, channel: value ?? "note" }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CHANNEL_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-2"><Label>الاتجاه</Label><Select value={form.direction} onValueChange={(value) => setForm((current) => ({ ...current, direction: value ?? "outbound" }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="outbound">صادر</SelectItem><SelectItem value="inbound">وارد</SelectItem></SelectContent></Select></div>
                <div className="grid gap-2"><Label>الحالة</Label><Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value ?? "completed" }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-2"><Label>العنوان</Label><Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} className="h-10 rounded-xl" placeholder="سبب أو موضوع التواصل" /></div>
              <div className="grid gap-2"><Label>التفاصيل</Label><Textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} className="min-h-28 rounded-xl" placeholder="اكتب ملخص المكالمة أو الرسالة أو الاتفاق" /></div>
            </div>
            <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button><Button onClick={() => void createCommunication()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} حفظ التواصل</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
