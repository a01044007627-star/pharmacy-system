"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Download, Eye, RefreshCw, Search, Users, Building, CheckCircle2, XCircle, Plus, Save } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"
import { downloadCsv as saveCsv } from "@/lib/csv-utils"
import { PartnerFormDialog } from "./partner-form-dialog"

type PartnerRow = {
  id: string
  type: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  tax_id: string | null
  opening_balance: number
  balance: number
  credit_limit: number
  status: string
  created_at: string
}

type PartnersSummary = {
  count: number
  total?: number
  active: number
  inactive: number
  totalBalance: number
  openingBalance: number
  creditLimit: number
}

type PartnersResponse = {
  partners?: PartnerRow[]
  summary?: Partial<PartnersSummary>
  pagination?: { totalPages: number }
  error?: string
}

function typeLabel(value: string) {
  switch (value) {
    case "customer": return "عميل"
    case "supplier": return "مورد"
    case "both": return "عميل ومورد"
    default: return value
  }
}

function exportPartnersCsv(rows: PartnerRow[], label: string) {
  const data = [
    ["الاسم", "النوع", "الهاتف", "البريد", "الرصيد", "حد الائتمان", "الحالة", "تاريخ الإنشاء"],
    ...rows.map((row) => [row.name, typeLabel(row.type), row.phone ?? "", row.email ?? "", String(row.balance), String(row.credit_limit), row.status === "active" ? "نشط" : "غير نشط", new Date(row.created_at).toLocaleDateString("ar-EG")]),
  ]
  saveCsv(`${label}.csv`, data)
}

type PartnersListViewProps = {
  partnerType: "customer" | "supplier"
}

export function PartnersListView({ partnerType }: PartnersListViewProps) {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<PartnerRow[]>([])
  const emptySummary: PartnersSummary = { count: 0, total: 0, active: 0, inactive: 0, totalBalance: 0, openingBalance: 0, creditLimit: 0 }
  const [summary, setSummary] = useState<PartnersSummary>(emptySummary)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickForm, setQuickForm] = useState({ name: "", phone: "", email: "", address: "", tax_id: "", opening_balance: "0", credit_limit: "0", notes: "" })

  const isCustomers = partnerType === "customer"
  const label = isCustomers ? "العملاء" : "الموردين"
  const icon = isCustomers ? Users : Building

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        type: partnerType,
        query,
        status,
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/partners?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as PartnersResponse
      if (!response.ok) throw new Error(data.error ?? `فشل تحميل ${label}`)
      setRows(data.partners ?? [])
      setSelectedIds([])
      setSummary({ ...emptySummary, ...(data.summary ?? {}) })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `فشل تحميل ${label}`)
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, page, partnerType, query, status, label])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  const canWrite = auth.isDeveloper || auth.can("crm:write")

  const allCurrentSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id))

  const toggleAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? rows.map((row) => row.id) : [])
  }, [rows])

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((value) => value !== id))
  }, [])

  const bulkStatus = useCallback(async (action: "activate" | "deactivate") => {
    if (!selectedIds.length || !auth.activePharmacyId) return
    setBulkBusy(true)
    try {
      const response = await fetch("/api/partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, ids: selectedIds, action }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تنفيذ الإجراء")
      toast.success(action === "activate" ? "تم تفعيل المحدد" : "تم تعطيل المحدد")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تنفيذ الإجراء")
    } finally {
      setBulkBusy(false)
    }
  }, [auth.activePharmacyId, load, selectedIds])

  async function saveQuickPartner() {
    if (!auth.activePharmacyId) return
    if (!quickForm.name.trim()) { toast.error("الاسم مطلوب"); return }
    setQuickSaving(true)
    try {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          type: partnerType,
          name: quickForm.name.trim(),
          phone: quickForm.phone.trim(),
          email: quickForm.email.trim(),
          address: quickForm.address.trim(),
          tax_id: quickForm.tax_id.trim(),
          opening_balance: Number(quickForm.opening_balance) || 0,
          credit_limit: Number(quickForm.credit_limit) || 0,
          notes: quickForm.notes.trim(),
          status: "active",
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(isCustomers ? "تم حفظ العميل" : "تم حفظ المورد")
      setQuickForm({ name: "", phone: "", email: "", address: "", tax_id: "", opening_balance: "0", credit_limit: "0", notes: "" })
      setQuickOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally {
      setQuickSaving(false)
    }
  }

  const cards = useMemo(() => [
    { label: `إجمالي ${label}`, value: summary.count.toLocaleString("ar-EG"), tone: "text-slate-950" },
    { label: "النشطون", value: summary.active.toLocaleString("ar-EG"), tone: "text-emerald-700" },
    { label: "غير النشط", value: (summary.inactive ?? 0).toLocaleString("ar-EG"), tone: "text-slate-500" },
    { label: "إجمالي الأرصدة", value: money(summary.totalBalance), tone: "text-brand" },
    { label: "حد الائتمان", value: money(summary.creditLimit), tone: "text-amber-700" },
  ], [label, money, summary])

  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title={label}
          subtitle={`إدارة ${label} وعرض الأرصدة وسجل المعاملات.`}
          icon={icon}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
              <Button variant="outline" className="h-10 rounded-xl" disabled={!rows.length} onClick={() => exportPartnersCsv(rows, label)}><Download className="size-4" /> تصدير</Button>
              {canWrite ? (
                <>
                  <Button className="h-10 rounded-xl" onClick={() => setQuickOpen((value) => !value)}><Plus className="size-4" /> إضافة سريعة</Button>
                  <PartnerFormDialog partnerType={partnerType} onSaved={() => void load()} />
                </>
              ) : null}
            </>
          )}
        />

        {quickOpen && canWrite ? (
          <Card className="rounded-3xl border-blue-100 bg-blue-50/30 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-950">{isCustomers ? "إضافة عميل سريع" : "إضافة مورد سريع"}</h2>
                  <p className="text-xs font-bold text-slate-500">بيانات أساسية كافية للتعاملات والرصيد الافتتاحي.</p>
                </div>
                <Button variant="ghost" className="rounded-xl" onClick={() => setQuickOpen(false)}>إغلاق</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <QuickField label="الاسم *"><Input value={quickForm.name} onChange={(event) => setQuickForm((prev) => ({ ...prev, name: event.target.value }))} className="h-11 rounded-xl bg-white font-bold" /></QuickField>
                <QuickField label="الهاتف"><Input value={quickForm.phone} onChange={(event) => setQuickForm((prev) => ({ ...prev, phone: event.target.value }))} className="h-11 rounded-xl bg-white font-bold" dir="ltr" /></QuickField>
                <QuickField label="البريد"><Input value={quickForm.email} onChange={(event) => setQuickForm((prev) => ({ ...prev, email: event.target.value }))} className="h-11 rounded-xl bg-white font-bold" dir="ltr" /></QuickField>
                <QuickField label="الرقم الضريبي"><Input value={quickForm.tax_id} onChange={(event) => setQuickForm((prev) => ({ ...prev, tax_id: event.target.value }))} className="h-11 rounded-xl bg-white font-bold" /></QuickField>
                <QuickField label="الرصيد الافتتاحي"><Input value={quickForm.opening_balance} onChange={(event) => setQuickForm((prev) => ({ ...prev, opening_balance: event.target.value.replace(/[^0-9.]/g, "") }))} className="h-11 rounded-xl bg-white font-bold" dir="ltr" /></QuickField>
                <QuickField label="حد الائتمان"><Input value={quickForm.credit_limit} onChange={(event) => setQuickForm((prev) => ({ ...prev, credit_limit: event.target.value.replace(/[^0-9.]/g, "") }))} className="h-11 rounded-xl bg-white font-bold" dir="ltr" /></QuickField>
                <QuickField label="العنوان"><Input value={quickForm.address} onChange={(event) => setQuickForm((prev) => ({ ...prev, address: event.target.value }))} className="h-11 rounded-xl bg-white font-bold" /></QuickField>
                <div className="space-y-1.5 md:col-span-2 xl:col-span-1"><Label className="text-xs font-black text-slate-600">ملاحظات</Label><Textarea value={quickForm.notes} onChange={(event) => setQuickForm((prev) => ({ ...prev, notes: event.target.value }))} className="min-h-11 rounded-xl bg-white font-bold" /></div>
              </div>
              <div className="flex justify-end">
                <Button className="h-11 rounded-xl px-6 font-black" disabled={quickSaving || !quickForm.name.trim()} onClick={() => void saveQuickPartner()}>{quickSaving ? null : <Save className="size-4" />} حفظ</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={`بحث بالاسم أو الهاتف أو البريد...`} className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="active">نشط</NativeSelectOption>
              <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{card.label}</p><p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p></CardContent></Card>
          ))}
        </div>

        {selectedIds.length > 0 ? (
          <Card className="rounded-2xl border-blue-100 bg-blue-50/60 shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="font-black text-blue-900">تم تحديد {selectedIds.length.toLocaleString("ar-EG")} {isCustomers ? "عميل" : "مورد"}</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-9 rounded-xl bg-white" disabled={!canWrite || bulkBusy} onClick={() => void bulkStatus("activate")}><CheckCircle2 className="size-4" /> تفعيل</Button>
                <Button size="sm" variant="outline" className="h-9 rounded-xl bg-white text-rose-700" disabled={!canWrite || bulkBusy} onClick={() => void bulkStatus("deactivate")}><XCircle className="size-4" /> تعطيل</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={icon} title={`لا توجد ${label}`} description={`ابدأ بإضافة أول ${isCustomers ? "عميل" : "مورد"}.`} />
          ) : (
            <Table className="min-w-[850px]">
              <TableHeader><TableRow>
                <TableHead className="w-12 text-center"><Checkbox className="mx-auto" aria-label="تحديد كل الصفحة" checked={allCurrentSelected} onCheckedChange={(checked) => toggleAll(!!checked)} /></TableHead>
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-right">الهاتف</TableHead>
                <TableHead className="text-center">الرصيد</TableHead>
                <TableHead className="text-center">الرصيد الافتتاحي</TableHead>
                <TableHead className="text-center">حد الائتمان</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="text-center">تاريخ الإنشاء</TableHead>
                <TableHead className="text-center">عرض</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center"><Checkbox className="mx-auto" aria-label={`تحديد ${row.name}`} checked={selectedIds.includes(row.id)} onCheckedChange={(checked) => toggleOne(row.id, !!checked)} /></TableCell>
                  <TableCell>
                    <div className="font-black text-slate-950">{row.name}</div>
                    <div className="text-xs font-bold text-slate-400">{row.email ?? row.tax_id ?? "—"}</div>
                    {row.address ? <div className="mt-1 max-w-[260px] truncate text-[11px] font-bold text-slate-400">{row.address}</div> : null}
                  </TableCell>
                  <TableCell className="font-bold" dir="ltr">{row.phone ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{money(row.balance)}</TableCell>
                  <TableCell className="text-center font-bold text-slate-500">{money(row.opening_balance)}</TableCell>
                  <TableCell className="text-center font-bold">{money(row.credit_limit)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={cn("font-black", row.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
                      {row.status === "active" ? "نشط" : "غير نشط"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleDateString("ar-EG")}</TableCell>
                  <TableCell className="text-center">
                    <Button size="icon" variant="ghost" render={<Link href={`/dashboard/crm/${row.id}`} />}><Eye className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}

function QuickField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-black text-slate-600">{label}</Label>{children}</div>
}
