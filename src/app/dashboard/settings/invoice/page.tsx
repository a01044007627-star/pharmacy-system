"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, FileText, Eye } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { InvoiceDesignService } from "@/features/settings/services/invoice-design-service"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { LoadingState } from "@/components/shared/loading-state"
import { EmptyState } from "@/components/shared/empty-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import type { InvoiceDesign } from "@/features/settings/types"

const templateOptions = [
  { value: "standard", label: "قياسي" },
  { value: "modern", label: "حديث" },
  { value: "compact", label: "مضغوط" },
  { value: "minimal", label: "بسيط" },
  { value: "thermal", label: "حراري" },
]

const paperOptions = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
  { value: "A6", label: "A6" },
  { value: "80mm", label: "80 مم" },
  { value: "58mm", label: "58 مم" },
  { value: "letter", label: "خطاب" },
]

const defaultDesign: Partial<InvoiceDesign> = {
  template: "standard",
  show_logo: true,
  show_header: true,
  header_text: "",
  header_subtitle_1: "",
  header_subtitle_2: "",
  header_subtitle_3: "",
  show_footer: true,
  footer_text: "شكراً لتعاملكم معنا",
  show_barcode: true,
  show_qr: true,
  qr_enabled: true,
  qr_show_business_name: true,
  qr_show_invoice_no: true,
  qr_show_date: true,
  qr_show_total: true,
  qr_show_tax: true,
  show_tax: true,
  show_discount: true,
  show_customer_info: true,
  show_customer_id: false,
  show_customer_tax: true,
  show_phone: true,
  show_address: true,
  show_shipping: false,
  show_item_image: false,
  show_item_code: true,
  show_item_brand: false,
  show_item_unit: true,
  show_total_qty: true,
  show_payment_info: true,
  show_total_in_words: true,
  show_signature: false,
  show_currency: true,
  paper_size: "A4",
  font_family: "Cairo",
  font_size: 12,
  note: "",
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

function InvoiceContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("invoice")
  const [designs, setDesigns] = useState<InvoiceDesign[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<InvoiceDesign>>(defaultDesign)
  const [formName, setFormName] = useState("")
  const [saving, setSaving] = useState(false)

  const canWriteInvoices = can("settings:write") && canWrite

  const loadDesigns = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const data = await InvoiceDesignService.getInvoiceDesigns()
      setDesigns(data)
    } catch {
      setDesigns([])
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadDesigns() }, [loadDesigns])

  function resetForm() {
    setForm(defaultDesign)
    setFormName("")
    setEditingId(null)
  }

  function setF<K extends keyof InvoiceDesign>(key: K, value: InvoiceDesign[K]) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  async function handleSubmit() {
    if (!canWriteInvoices) { toast.error("ليست لديك صلاحية تعديل التصميمات"); return }
    if (!formName.trim()) { toast.error("اسم التصميم مطلوب"); return }

    setSaving(true)
    try {
      if (editingId && editingId !== "new") {
        await InvoiceDesignService.saveInvoiceDesign({ ...form, id: editingId, name: formName } as InvoiceDesign)
        toast.success("تم تحديث التصميم")
      } else {
        await InvoiceDesignService.saveInvoiceDesign({ ...form, name: formName, is_default: designs.length === 0 } as InvoiceDesign)
        toast.success("تم إضافة التصميم")
      }
      resetForm()
      await loadDesigns()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ التصميم")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, isDefault: boolean) {
    if (!canWriteInvoices) { toast.error("ليست لديك صلاحية حذف التصميمات"); return }
    if (isDefault) { toast.error("لا يمكن حذف التصميم الافتراضي"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذا التصميم؟")) return
    try {
      await InvoiceDesignService.deleteInvoiceDesign(id)
      toast.success("تم حذف التصميم")
      await loadDesigns()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حذف التصميم")
    }
  }

  async function setAsDefault(id: string) {
    if (!canWriteInvoices) return
    try {
      await InvoiceDesignService.setDefault(id)
      toast.success("تم تعيين التصميم كافتراضي")
      await loadDesigns()
    } catch {
      toast.error("فشل تحديث التصميم الافتراضي")
    }
  }

  function startEdit(design: InvoiceDesign) {
    const keys: (keyof InvoiceDesign)[] = [
      "template", "show_logo", "show_header", "header_text", "header_subtitle_1",
      "header_subtitle_2", "header_subtitle_3", "show_footer", "footer_text",
      "show_barcode", "show_qr", "qr_enabled", "qr_show_business_name",
      "qr_show_invoice_no", "qr_show_date", "qr_show_total", "qr_show_tax",
      "show_tax", "show_discount", "show_customer_info", "show_customer_id",
      "show_customer_tax", "show_phone", "show_address", "show_shipping",
      "show_item_image", "show_item_code", "show_item_brand", "show_item_unit",
      "show_total_qty", "show_payment_info", "show_total_in_words",
      "show_signature", "show_currency", "paper_size", "font_family", "font_size", "note",
    ]
    const obj: Partial<InvoiceDesign> = {}
    for (const k of keys) { (obj as Record<string, unknown>)[k] = design[k as keyof InvoiceDesign] }
    setForm(obj)
    setFormName(design.name)
    setEditingId(design.id)
  }

  function SectionTitle({ children }: { children: string }) {
    return <h3 className="mb-3 mt-2 text-sm font-black text-slate-800">{children}</h3>
  }

  function InputField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
    return (
      <div className="grid gap-1.5 text-right">
        <span className="text-xs font-black text-slate-700">{label}</span>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} className="h-9 rounded-lg" dir="rtl" />
      </div>
    )
  }

  if (!canRead) {
    return <LoadingState text="ليس لديك صلاحية الوصول" minHeight="min-h-[200px]" />
  }

  if (loading) {
    return <LoadingState text="جاري تحميل التصاميم..." />
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        title="تصاميم الفاتورة"
        subtitle="إدارة تصاميم وإعدادات الفاتورة وشكل الطباعة"
        icon={FileText}
        actions={canWriteInvoices ? (
          <Button variant="default" size="sm" onClick={() => { resetForm(); setEditingId("new") }}>
            <Plus className="size-4" />
            إضافة تصميم
          </Button>
        ) : undefined}
      />

      {editingId ? (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-base font-black text-slate-900">
              {editingId !== "new" ? "تعديل التصميم" : "إضافة تصميم جديد"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InputField label="اسم التصميم *" value={formName} onChange={setFormName} placeholder="التصميم الأساسي" />
              <div className="grid gap-1.5 text-right">
                <span className="text-xs font-black text-slate-700">القالب</span>
                <Select value={form.template ?? "standard"} onValueChange={(v: string | null) => v && setF("template", v as InvoiceDesign["template"])}>
                  <SelectTrigger className="h-9 rounded-lg"><SelectValue>{templateOptions.find((o) => o.value === (form.template ?? "standard"))?.label ?? "قياسي"}</SelectValue></SelectTrigger>
                  <SelectContent>{templateOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 text-right">
                <span className="text-xs font-black text-slate-700">حجم الورق</span>
                <Select value={form.paper_size ?? "A4"} onValueChange={(v: string | null) => v && setF("paper_size", v as InvoiceDesign["paper_size"])}>
                  <SelectTrigger className="h-9 rounded-lg"><SelectValue>{paperOptions.find((o) => o.value === (form.paper_size ?? "A4"))?.label ?? "A4"}</SelectValue></SelectTrigger>
                  <SelectContent>{paperOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <InputField label="نوع الخط" value={form.font_family ?? "Cairo"} onChange={(v) => setF("font_family", v)} placeholder="Cairo" />
              <InputField label="حجم الخط" value={String(form.font_size ?? 12)} onChange={(v) => setF("font_size", Number(v) || 12)} placeholder="12" type="number" />
            </div>

            <Separator />

            <SectionTitle>رأس الفاتورة</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToggleRow label="إظهار الشعار" checked={form.show_logo ?? true} onChange={(v) => setF("show_logo", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="إظهار الترويسة" checked={form.show_header ?? true} onChange={(v) => setF("show_header", v)} disabled={!canWriteInvoices} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InputField label="نص الترويسة" value={form.header_text ?? ""} onChange={(v) => setF("header_text", v)} placeholder="نص رأس الفاتورة" />
              <InputField label="السطر الفرعي 1" value={form.header_subtitle_1 ?? ""} onChange={(v) => setF("header_subtitle_1", v)} placeholder="معلومات إضافية" />
              <InputField label="السطر الفرعي 2" value={form.header_subtitle_2 ?? ""} onChange={(v) => setF("header_subtitle_2", v)} placeholder="معلومات إضافية" />
              <InputField label="السطر الفرعي 3" value={form.header_subtitle_3 ?? ""} onChange={(v) => setF("header_subtitle_3", v)} placeholder="معلومات إضافية" />
            </div>

            <Separator />

            <SectionTitle>معلومات العميل</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ToggleRow label="إظهار معلومات العميل" checked={form.show_customer_info ?? true} onChange={(v) => setF("show_customer_info", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="رقم العميل" checked={form.show_customer_id ?? false} onChange={(v) => setF("show_customer_id", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="الرقم الضريبي للعميل" checked={form.show_customer_tax ?? true} onChange={(v) => setF("show_customer_tax", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="رقم الهاتف" checked={form.show_phone ?? true} onChange={(v) => setF("show_phone", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="العنوان" checked={form.show_address ?? true} onChange={(v) => setF("show_address", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="معلومات الشحن" checked={form.show_shipping ?? false} onChange={(v) => setF("show_shipping", v)} disabled={!canWriteInvoices} />
            </div>

            <Separator />

            <SectionTitle>الأصناف والمجاميع</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ToggleRow label="صورة الصنف" checked={form.show_item_image ?? false} onChange={(v) => setF("show_item_image", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="كود الصنف" checked={form.show_item_code ?? true} onChange={(v) => setF("show_item_code", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="العلامة التجارية" checked={form.show_item_brand ?? false} onChange={(v) => setF("show_item_brand", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="وحدة القياس" checked={form.show_item_unit ?? true} onChange={(v) => setF("show_item_unit", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="إجمالي الكميات" checked={form.show_total_qty ?? true} onChange={(v) => setF("show_total_qty", v)} disabled={!canWriteInvoices} />
            </div>

            <Separator />

            <SectionTitle>الإجماليات</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ToggleRow label="إظهار الضرائب" checked={form.show_tax ?? true} onChange={(v) => setF("show_tax", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="إظهار الخصومات" checked={form.show_discount ?? true} onChange={(v) => setF("show_discount", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="معلومات الدفع" checked={form.show_payment_info ?? true} onChange={(v) => setF("show_payment_info", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="المبلغ بالكلمات" checked={form.show_total_in_words ?? true} onChange={(v) => setF("show_total_in_words", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="رمز العملة" checked={form.show_currency ?? true} onChange={(v) => setF("show_currency", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="الباركود على الفاتورة" checked={form.show_barcode ?? true} onChange={(v) => setF("show_barcode", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="مساحة التوقيع" checked={form.show_signature ?? false} onChange={(v) => setF("show_signature", v)} disabled={!canWriteInvoices} />
            </div>

            <Separator />

            <SectionTitle>رمز QR</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ToggleRow label="تفعيل QR" checked={form.qr_enabled ?? true} onChange={(v) => setF("qr_enabled", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="إظهار رمز QR" checked={form.show_qr ?? true} onChange={(v) => setF("show_qr", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="اسم المنشأة في QR" checked={form.qr_show_business_name ?? true} onChange={(v) => setF("qr_show_business_name", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="رقم الفاتورة في QR" checked={form.qr_show_invoice_no ?? true} onChange={(v) => setF("qr_show_invoice_no", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="التاريخ في QR" checked={form.qr_show_date ?? true} onChange={(v) => setF("qr_show_date", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="الإجمالي في QR" checked={form.qr_show_total ?? true} onChange={(v) => setF("qr_show_total", v)} disabled={!canWriteInvoices} />
              <ToggleRow label="الضريبة في QR" checked={form.qr_show_tax ?? true} onChange={(v) => setF("qr_show_tax", v)} disabled={!canWriteInvoices} />
            </div>

            <Separator />

            <SectionTitle>تذييل الفاتورة</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToggleRow label="إظهار التذييل" checked={form.show_footer ?? true} onChange={(v) => setF("show_footer", v)} disabled={!canWriteInvoices} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label="نص التذييل" value={form.footer_text ?? ""} onChange={(v) => setF("footer_text", v)} placeholder="شكراً لتعاملكم معنا" />
              <InputField label="ملاحظة" value={form.note ?? ""} onChange={(v) => setF("note", v)} placeholder="ملاحظات إضافية" />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button variant="default" size="sm" onClick={handleSubmit} disabled={saving}>
                {saving ? "جاري الحفظ…" : editingId !== "new" ? "تحديث" : "إضافة"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetForm}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {designs.length === 0 ? (
          <div className="col-span-full">
            <EmptyState icon={FileText} title="لا توجد تصاميم فاتورة بعد" description="لم يتم إضافة أي تصميم فاتورة حتى الآن" />
          </div>
        ) : designs.map((design) => (
          <Card key={design.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                    <FileText className="size-5" />
                  </span>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">{design.name}</span>
                      {design.is_default ? (
                        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-black text-brand">افتراضي</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">{templateOptions.find((o) => o.value === design.template)?.label ?? design.template}</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {design.show_logo ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">شعار</span> : null}
                {design.show_barcode ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">باركود</span> : null}
                {design.show_qr ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">QR</span> : null}
                {design.show_tax ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">ضريبة</span> : null}
                {design.show_discount ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">خصم</span> : null}
                {design.show_customer_info ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">عميل</span> : null}
              </div>
              <p className="mt-2 text-[10px] font-semibold text-slate-400">{design.paper_size} · {design.font_family}</p>
              {canWriteInvoices ? (
                <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
                  <Button variant="ghost" size="icon-xs" onClick={() => startEdit(design)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  {!design.is_default ? (
                    <>
                      <Button variant="ghost" size="icon-xs" onClick={() => setAsDefault(design.id)}>
                        <Eye className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(design.id, design.is_default)}>
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function InvoicePage() {
  return (
    <SettingsLayout>
      <InvoiceContent />
    </SettingsLayout>
  )
}
