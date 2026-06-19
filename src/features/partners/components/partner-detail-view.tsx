"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Building, CreditCard, Mail, MapPin, Phone, Plus, Receipt, RefreshCw, Save, User } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { LoadingState } from "@/components/shared/loading-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"
import { PartnerFormDialog } from "./partner-form-dialog"

type PartnerData = {
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
  notes: string | null
  status: string
  created_at: string
  updated_at: string
}

type AddressData = {
  id: string
  label: string
  address: string
  city: string | null
  state: string | null
  postal_code: string | null
  phone: string | null
  is_default: boolean
}

type PaymentData = {
  id: string
  source_table: string
  source_id: string
  type: string
  direction: string
  payment_method: string
  amount: number
  reference: string | null
  notes: string | null
  payment_date: string
  created_at: string
}

type PurchaseData = {
  id: string
  purchase_number: string
  supplier_name: string
  status: string
  payment_status: string
  payment_method: string
  total: number
  paid_amount: number
  due_amount: number
  purchase_date: string
  branch?: { id: string; name: string | null } | null
}

type PurchaseReturnData = {
  id: string
  return_number: string
  supplier_name: string
  total: number
  refund_amount: number
  stock_mode: string | null
  reason: string | null
  created_at: string
}

type PartnerDetailResponse = {
  partner?: PartnerData
  addresses?: AddressData[]
  payments?: PaymentData[]
  purchases?: PurchaseData[]
  purchaseReturns?: PurchaseReturnData[]
  purchaseSummary?: { count: number; total: number; paid: number; due: number }
  paymentsSummary?: { count: number; in: number; out: number }
  error?: string
}

function typeLabel(type: string) {
  switch (type) {
    case "customer": return "عميل"
    case "supplier": return "مورد"
    case "both": return "عميل ومورد"
    default: return type
  }
}

function paymentStatusLabel(value: string) {
  const labels: Record<string, string> = { paid: "مدفوعة", partial: "جزئي", unpaid: "غير مدفوعة" }
  return labels[value] ?? value
}

function directionLabel(direction: string) {
  return direction === "in" ? "وارد" : "صادر"
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = { cash: "نقدي", card: "بطاقة", wallet: "محفظة", bank: "تحويل بنكي", cheque: "شيك" }
  return labels[method] ?? method
}

export function PartnerDetailView({ partnerId }: { partnerId: string }) {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [partner, setPartner] = useState<PartnerData | null>(null)
  const [addresses, setAddresses] = useState<AddressData[]>([])
  const [payments, setPayments] = useState<PaymentData[]>([])
  const [purchases, setPurchases] = useState<PurchaseData[]>([])
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnData[]>([])
  const [purchaseSummary, setPurchaseSummary] = useState({ count: 0, total: 0, paid: 0, due: 0 })
  const [paymentsSummary, setPaymentsSummary] = useState({ count: 0, in: 0, out: 0 })
  const [loading, setLoading] = useState(true)
  const [showEditDialog, setShowEditDialog] = useState(false)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/partners/${partnerId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as PartnerDetailResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل بيانات جهة الاتصال")
      setPartner(data.partner ?? null)
      setAddresses(data.addresses ?? [])
      setPayments(data.payments ?? [])
      setPurchases(data.purchases ?? [])
      setPurchaseReturns(data.purchaseReturns ?? [])
      setPurchaseSummary(data.purchaseSummary ?? { count: 0, total: 0, paid: 0, due: 0 })
      setPaymentsSummary(data.paymentsSummary ?? { count: 0, in: 0, out: 0 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات جهة الاتصال")
    } finally {
      setLoading(false)
    }
  }, [partnerId])

  useEffect(() => { void load() }, [load])

  const canEdit = auth.isDeveloper || auth.can("crm:write")
  const isSupplier = partner ? ["supplier", "both"].includes(partner.type) : false

  const summaryCards = useMemo(() => {
    if (!partner) return []
    const cards = [
      { label: isSupplier ? "المستحق للمورد" : "الرصيد الحالي", value: money(partner.balance), tone: "text-brand" },
      { label: "حد الائتمان", value: money(partner.credit_limit), tone: "text-slate-950" },
      { label: "الرصيد الافتتاحي", value: money(partner.opening_balance), tone: "text-slate-500" },
    ]
    if (isSupplier) {
      cards.push(
        { label: "إجمالي المشتريات", value: money(purchaseSummary.total), tone: "text-emerald-700" },
        { label: "مدفوع للمورد", value: money(purchaseSummary.paid), tone: "text-blue-700" },
        { label: "المتبقي بالفواتير", value: money(purchaseSummary.due), tone: "text-rose-700" },
      )
    }
    return cards
  }, [isSupplier, money, partner, purchaseSummary])

  if (loading) return <LoadingState text="جاري تحميل بيانات جهة الاتصال..." />
  if (!partner) return <div dir="rtl" className="page-container py-8 text-center font-black text-slate-500">جهة الاتصال غير موجودة.</div>

  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title={partner.name}
          subtitle={`${typeLabel(partner.type)} — ${partner.status === "active" ? "نشط" : "غير نشط"}`}
          icon={isSupplier ? Building : User}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href={isSupplier ? "/dashboard/crm/suppliers" : "/dashboard/crm"} />}>
                <ArrowRight className="size-4" /> {isSupplier ? "الموردين" : "العملاء"}
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className="size-4" /> تحديث</Button>
              {canEdit ? <PartnerPaymentDialog partner={partner} isSupplier={isSupplier} onSaved={() => void load()} /> : null}
              {canEdit ? (
                <PartnerFormDialog partner={partner} partnerType={isSupplier ? "supplier" : "customer"} onSaved={() => void load()} open={showEditDialog} onOpenChange={setShowEditDialog}>
                  <Button className="h-10 rounded-xl">تعديل البيانات</Button>
                </PartnerFormDialog>
              ) : null}
            </>
          )}
        />

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardContent className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Info icon={User} label="الاسم" value={partner.name} />
                  <Info icon={Building} label="النوع" value={typeLabel(partner.type)} />
                  {partner.phone ? <Info icon={Phone} label="الهاتف" value={partner.phone} ltr tone="emerald" /> : null}
                  {partner.email ? <Info icon={Mail} label="البريد الإلكتروني" value={partner.email} ltr tone="blue" /> : null}
                  {partner.tax_id ? <Info icon={CreditCard} label="الرقم الضريبي" value={partner.tax_id} ltr tone="amber" /> : null}
                  {partner.address ? <Info icon={MapPin} label="العنوان" value={partner.address} className="sm:col-span-2" tone="rose" /> : null}
                </div>
                {partner.notes ? (
                  <>
                    <Separator className="my-4" />
                    <p className="text-sm font-bold text-slate-500">{partner.notes}</p>
                  </>
                ) : null}
              </CardContent>
            </Card>

            {isSupplier ? (
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-lg font-black"><Receipt className="size-5 text-brand" /> فواتير المورد</CardTitle></CardHeader>
                {purchases.length === 0 ? <CardContent className="p-5 text-center text-sm font-bold text-slate-400">لا توجد فواتير مشتريات لهذا المورد</CardContent> : (
                  <Table className="min-w-[760px]">
                    <TableHeader><TableRow><TableHead className="text-right">الفاتورة</TableHead><TableHead className="text-center">الفرع</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">الإجمالي</TableHead><TableHead className="text-center">المدفوع</TableHead><TableHead className="text-center">المتبقي</TableHead><TableHead className="text-center">التاريخ</TableHead></TableRow></TableHeader>
                    <TableBody>{purchases.map((purchase) => (
                      <TableRow key={purchase.id}>
                        <TableCell className="font-black"><Link href={`/dashboard/purchases/${purchase.id}`} className="text-brand hover:underline">{purchase.purchase_number}</Link></TableCell>
                        <TableCell className="text-center font-bold">{purchase.branch?.name ?? "—"}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-slate-50 font-black">{paymentStatusLabel(purchase.payment_status)}</Badge></TableCell>
                        <TableCell className="text-center font-black">{money(purchase.total)}</TableCell>
                        <TableCell className="text-center font-bold text-emerald-700">{money(purchase.paid_amount)}</TableCell>
                        <TableCell className="text-center font-bold text-rose-700">{money(purchase.due_amount)}</TableCell>
                        <TableCell className="text-center text-xs font-bold">{new Date(purchase.purchase_date).toLocaleDateString("ar-EG")}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                )}
              </Card>
            ) : null}

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-lg font-black"><CreditCard className="size-5 text-brand" /> آخر المعاملات المالية</CardTitle></CardHeader>
              {payments.length === 0 ? <CardContent className="p-5 text-center text-sm font-bold text-slate-400">لا توجد معاملات مالية بعد</CardContent> : (
                <Table className="min-w-[640px]">
                  <TableHeader><TableRow><TableHead className="text-right">التاريخ</TableHead><TableHead className="text-right">المرجع</TableHead><TableHead className="text-center">الاتجاه</TableHead><TableHead className="text-center">طريقة الدفع</TableHead><TableHead className="text-center">المبلغ</TableHead></TableRow></TableHeader>
                  <TableBody>{payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="text-xs font-bold">{new Date(payment.payment_date).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-bold">{payment.reference ?? "—"}</TableCell>
                      <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", payment.direction === "in" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{directionLabel(payment.direction)}</Badge></TableCell>
                      <TableCell className="text-center font-bold">{paymentMethodLabel(payment.payment_method)}</TableCell>
                      <TableCell className="text-center font-black">{money(payment.amount)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </Card>

            {purchaseReturns.length > 0 ? (
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">مرتجعات المورد</CardTitle></CardHeader>
                <Table className="min-w-[620px]"><TableHeader><TableRow><TableHead className="text-right">رقم المرتجع</TableHead><TableHead className="text-center">الإجمالي</TableHead><TableHead className="text-center">المسترد</TableHead><TableHead className="text-center">السبب</TableHead><TableHead className="text-center">التاريخ</TableHead></TableRow></TableHeader><TableBody>{purchaseReturns.map((row) => <TableRow key={row.id}><TableCell className="font-black">{row.return_number}</TableCell><TableCell className="text-center font-bold">{money(row.total)}</TableCell><TableCell className="text-center font-bold text-emerald-700">{money(row.refund_amount)}</TableCell><TableCell className="text-center text-xs font-bold">{row.reason ?? "—"}</TableCell><TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleDateString("ar-EG")}</TableCell></TableRow>)}</TableBody></Table>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {summaryCards.map((card) => (
                <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{card.label}</p><p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p></CardContent></Card>
              ))}
            </div>
            <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">عدد المعاملات المالية</p><p className="mt-1 font-black text-slate-950">{paymentsSummary.count.toLocaleString("ar-EG")}</p><Separator className="my-3" /><p className="text-xs font-black text-slate-400">وارد / صادر</p><p className="mt-1 text-sm font-bold text-slate-600">{money(paymentsSummary.in)} / {money(paymentsSummary.out)}</p></CardContent></Card>
            {addresses.length > 0 ? (
              <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="border-b border-slate-100"><CardTitle className="text-base font-black">العناوين</CardTitle></CardHeader><CardContent className="grid gap-3 p-4">{addresses.map((addr) => <div key={addr.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3"><div className="flex items-center gap-2"><span className="font-black text-slate-950">{addr.label}</span>{addr.is_default ? <Badge className="text-[10px] font-black">افتراضي</Badge> : null}</div><p className="mt-2 text-sm font-bold text-slate-600">{addr.address}</p>{addr.phone ? <p className="mt-1 text-xs font-bold text-slate-400" dir="ltr">{addr.phone}</p> : null}</div>)}</CardContent></Card>
            ) : null}
            <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">تاريخ الإنشاء</p><p className="mt-1 text-sm font-bold text-slate-600">{new Date(partner.created_at).toLocaleString("ar-EG")}</p><Separator className="my-3" /><p className="text-xs font-black text-slate-400">آخر تحديث</p><p className="mt-1 text-sm font-bold text-slate-600">{new Date(partner.updated_at).toLocaleString("ar-EG")}</p></CardContent></Card>
          </div>
        </div>
      </section>
    </PageAccess>
  )
}

function Info({ icon: Icon, label, value, ltr, tone = "brand", className }: { icon: typeof User; label: string; value: string; ltr?: boolean; tone?: "brand" | "emerald" | "blue" | "amber" | "rose"; className?: string }) {
  const toneClass = {
    brand: "bg-brand/10 text-brand",
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  }[tone]
  return <div className={cn("flex items-center gap-3", className)}><span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", toneClass)}><Icon className="size-5" /></span><div><p className="text-xs font-black text-slate-400">{label}</p><p className="font-bold text-slate-950" dir={ltr ? "ltr" : "rtl"}>{value}</p></div></div>
}

function PartnerPaymentDialog({ partner, isSupplier, onSaved }: { partner: PartnerData; isSupplier: boolean; onSaved: () => void }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ amount: "", payment_method: "cash", reference: "", notes: "", payment_date: new Date().toISOString().slice(0, 10) })

  async function submit() {
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("اكتب مبلغ صحيح"); return }
    setSaving(true)
    try {
      const response = await fetch(`/api/partners/${partner.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          amount,
          payment_method: form.payment_method,
          reference: form.reference,
          notes: form.notes,
          payment_date: form.payment_date,
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تسجيل الدفعة")
      toast.success(isSupplier ? "تم تسجيل دفعة المورد" : "تم تسجيل تحصيل العميل")
      setOpen(false)
      setForm({ amount: "", payment_method: "cash", reference: "", notes: "", payment_date: new Date().toISOString().slice(0, 10) })
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل الدفعة")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-10 rounded-xl"><Plus className="size-4" /> {isSupplier ? "دفعة مورد" : "تحصيل"}</Button>} />
      <DialogContent className="max-w-xl rounded-3xl" dir="rtl">
        <DialogHeader><DialogTitle className="font-black">{isSupplier ? "تسجيل دفعة لمورد" : "تسجيل تحصيل من عميل"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="font-black">المبلغ *</Label><Input type="number" min="0" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">طريقة الدفع</Label><NativeSelect value={form.payment_method} onChange={(e) => setForm((prev) => ({ ...prev, payment_method: e.target.value }))}><NativeSelectOption value="cash">نقدي</NativeSelectOption><NativeSelectOption value="card">بطاقة</NativeSelectOption><NativeSelectOption value="wallet">محفظة</NativeSelectOption><NativeSelectOption value="bank">تحويل بنكي</NativeSelectOption><NativeSelectOption value="cheque">شيك</NativeSelectOption></NativeSelect></div>
          <div className="space-y-1.5"><Label className="font-black">التاريخ</Label><Input type="date" value={form.payment_date} onChange={(e) => setForm((prev) => ({ ...prev, payment_date: e.target.value }))} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">مرجع</Label><Input value={form.reference} onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label className="font-black">ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className="min-h-24 rounded-xl" /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="outline" className="h-10 rounded-xl" onClick={() => setOpen(false)}>إلغاء</Button><Button className="h-10 rounded-xl" disabled={saving} onClick={() => void submit()}><Save className="size-4" /> حفظ</Button></div>
      </DialogContent>
    </Dialog>
  )
}
