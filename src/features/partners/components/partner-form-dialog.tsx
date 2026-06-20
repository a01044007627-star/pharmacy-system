"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { partnersService } from "@/features/partners/services/partners-service"

type PartnerFormData = {
  id?: string
  type: string
  name: string
  phone: string
  email: string
  address: string
  tax_id: string
  opening_balance: string
  credit_limit: string
  notes: string
  status: string
}

const emptyForm: PartnerFormData = {
  type: "customer",
  name: "",
  phone: "",
  email: "",
  address: "",
  tax_id: "",
  opening_balance: "0",
  credit_limit: "0",
  notes: "",
  status: "active",
}

type PartnerFormDialogProps = {
  partner?: {
    id: string
    type: string
    name: string
    phone: string | null
    email: string | null
    address: string | null
    tax_id: string | null
    opening_balance: number
    credit_limit: number
    notes: string | null
    status: string
  }
  partnerType: "customer" | "supplier"
  onSaved: () => void
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PartnerFormDialog({ partner, partnerType, onSaved, children, open: controlledOpen, onOpenChange }: PartnerFormDialogProps) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PartnerFormData>(emptyForm)

  const isOpen = controlledOpen ?? open
  const setIsOpen = onOpenChange ?? setOpen

  useEffect(() => {
    if (isOpen) {
      if (partner) {
        setForm({
          id: partner.id,
          type: partner.type,
          name: partner.name,
          phone: partner.phone ?? "",
          email: partner.email ?? "",
          address: partner.address ?? "",
          tax_id: partner.tax_id ?? "",
          opening_balance: String(partner.opening_balance ?? 0),
          credit_limit: String(partner.credit_limit ?? 0),
          notes: partner.notes ?? "",
          status: partner.status,
        })
      } else {
        setForm({ ...emptyForm, type: partnerType === "supplier" ? "supplier" : "customer" })
      }
    }
  }, [isOpen, partner, partnerType])

  const handleChange = useCallback((field: keyof PartnerFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("الاسم مطلوب")
      return
    }

    setSaving(true)
    try {
      const isEdit = Boolean(partner?.id)
      if (!auth.activePharmacyId) throw new Error("اختر صيدلية أولاً")

      const body: Record<string, unknown> = {
        pharmacy_id: auth.activePharmacyId,
        name: form.name.trim(),
        type: form.type,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        tax_id: form.tax_id.trim() || null,
        credit_limit: Number(form.credit_limit) || 0,
        notes: form.notes.trim() || null,
        status: form.status,
      }

      if (!isEdit) {
        body.opening_balance = Number(form.opening_balance) || 0
      }

      const result = isEdit
        ? await partnersService.update(auth.activePharmacyId, partner!.id, body)
        : await partnersService.create(auth.activePharmacyId, body)

      toast.success(result.queued ? "تم حفظ التغيير على الجهاز وسيتم مزامنته تلقائيًا" : isEdit ? "تم تحديث جهة الاتصال" : "تم إنشاء جهة الاتصال وربط رصيدها")
      setIsOpen(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ جهة الاتصال")
    } finally {
      setSaving(false)
    }
  }, [auth.activePharmacyId, form, onSaved, partner, setIsOpen])

  const isEdit = Boolean(partner)

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger>
        {children ?? (
          <Button className="h-10 rounded-xl"><Plus className="size-4" /> {partnerType === "supplier" ? "إضافة مورد" : "إضافة عميل"}</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-black text-slate-950">
            {isEdit ? "تعديل جهة اتصال" : partnerType === "supplier" ? "إضافة مورد جديد" : "إضافة عميل جديد"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-xs font-black text-slate-700">الاسم *</Label>
            <Input
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="اسم جهة الاتصال"
              className="h-11 rounded-xl font-bold"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">نوع جهة الاتصال</Label>
            <NativeSelect value={form.type} onChange={(e) => handleChange("type", e.target.value)}>
              <NativeSelectOption value="customer">عميل</NativeSelectOption>
              <NativeSelectOption value="supplier">مورد</NativeSelectOption>
              <NativeSelectOption value="both">عميل ومورد</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">الحالة</Label>
            <NativeSelect value={form.status} onChange={(e) => handleChange("status", e.target.value)}>
              <NativeSelectOption value="active">نشط</NativeSelectOption>
              <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">رقم الهاتف</Label>
            <Input
              value={form.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="رقم الهاتف"
              className="h-11 rounded-xl font-bold"
              dir="ltr"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">البريد الإلكتروني</Label>
            <Input
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="البريد الإلكتروني"
              className="h-11 rounded-xl font-bold"
              dir="ltr"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-xs font-black text-slate-700">العنوان</Label>
            <Input
              value={form.address}
              onChange={(e) => handleChange("address", e.target.value)}
              placeholder="العنوان"
              className="h-11 rounded-xl font-bold"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">الرقم الضريبي</Label>
            <Input
              value={form.tax_id}
              onChange={(e) => handleChange("tax_id", e.target.value)}
              placeholder="الرقم الضريبي"
              className="h-11 rounded-xl font-bold"
              dir="ltr"
            />
          </div>

          {!isEdit && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-black text-slate-700">الرصيد الافتتاحي</Label>
              <Input
                type="number"
                value={form.opening_balance}
                onChange={(e) => handleChange("opening_balance", e.target.value)}
                placeholder="0.00"
                className="h-11 rounded-xl font-bold"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs font-black text-slate-700">حد الائتمان</Label>
            <Input
              type="number"
              value={form.credit_limit}
              onChange={(e) => handleChange("credit_limit", e.target.value)}
              placeholder="0.00"
              className="h-11 rounded-xl font-bold"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-xs font-black text-slate-700">ملاحظات</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="ملاحظات إضافية..."
              className="min-h-[80px] rounded-xl font-bold"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => setIsOpen(false)}>إلغاء</Button>
          <Button className="h-10 rounded-xl" onClick={() => void handleSubmit()} disabled={saving}>
            <Save className="size-4" /> {saving ? "جاري الحفظ..." : isEdit ? "حفظ التغييرات" : "إضافة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
