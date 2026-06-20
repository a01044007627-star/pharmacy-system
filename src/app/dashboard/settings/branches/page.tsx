"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Store, MapPin, CheckCircle2, XCircle, Phone, Mail, User, FileText, Building } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SettingsEntityService } from "@/features/settings/services/settings-entity-service"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { LoadingState } from "@/components/shared/loading-state"
import { EmptyState } from "@/components/shared/empty-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"

interface Branch {
  id: string
  pharmacy_id: string
  code: string
  name: string
  address?: string
  district?: string
  city?: string
  country?: string
  postal_code?: string
  phone?: string
  email?: string
  manager_name?: string
  manager_phone?: string
  tax_id?: string
  commercial_register?: string
  notes?: string
  is_default: boolean
  status: "active" | "inactive" | "closed"
}

const statusOptions = [
  { value: "active", label: "نشط" },
  { value: "inactive", label: "غير نشط" },
  { value: "closed", label: "مغلق" },
]

type BranchStatus = "active" | "inactive" | "closed"

const initialForm = {
  code: "", name: "", address: "", district: "", city: "", country: "مصر",
  postal_code: "", phone: "", email: "", manager_name: "", manager_phone: "",
  tax_id: "", commercial_register: "", notes: "", is_default: false, status: "active" as BranchStatus,
}

function BranchesContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("branches")
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...initialForm })
  const [saving, setSaving] = useState(false)

  const canWriteBranches = can("branches:write") && canWrite

  const loadBranches = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const data = await SettingsEntityService.list<Branch>("branches")
      setBranches(data)
    } catch {
      toast.error("فشل تحميل الفروع")
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadBranches() }, [loadBranches])

  function resetForm() {
    setForm({ ...initialForm })
    setEditingId(null)
    setShowForm(false)
  }

  function setField<K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  function setStatus(value: string | null) {
    if (value === "active" || value === "inactive" || value === "closed") setForm((p) => ({ ...p, status: value }))
  }

  async function handleSubmit() {
    if (!canWriteBranches) { toast.error("ليست لديك صلاحية تعديل الفروع"); return }
    if (!form.name.trim() || !form.code.trim()) { toast.error("اسم الفرع والكود مطلوبان"); return }

    setSaving(true)
    try {
      const payload = { ...form }
      if (editingId) {
        await SettingsEntityService.update<Branch>("branches", editingId, payload as unknown as Record<string, unknown>)
        toast.success("تم تحديث الفرع")
      } else {
        await SettingsEntityService.create<Branch>("branches", payload as unknown as Record<string, unknown>)
        toast.success("تم إضافة الفرع")
      }
      resetForm()
      await loadBranches()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الفرع")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, isDefault: boolean) {
    if (!canWriteBranches) { toast.error("ليست لديك صلاحية حذف الفروع"); return }
    if (isDefault) { toast.error("لا يمكن حذف الفرع الافتراضي"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذا الفرع؟")) return
    try {
      await SettingsEntityService.remove("branches", id)
      toast.success("تم حذف الفرع")
      await loadBranches()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حذف الفرع")
    }
  }

  function startEdit(branch: Branch) {
    setForm({
      code: branch.code,
      name: branch.name,
      address: branch.address ?? "",
      district: branch.district ?? "",
      city: branch.city ?? "مصر",
      country: branch.country ?? "مصر",
      postal_code: branch.postal_code ?? "",
      phone: branch.phone ?? "",
      email: branch.email ?? "",
      manager_name: branch.manager_name ?? "",
      manager_phone: branch.manager_phone ?? "",
      tax_id: branch.tax_id ?? "",
      commercial_register: branch.commercial_register ?? "",
      notes: branch.notes ?? "",
      is_default: branch.is_default,
      status: branch.status,
    })
    setEditingId(branch.id)
    setShowForm(true)
  }

  function input(label: string, key: keyof typeof initialForm, placeholder?: string, type = "text") {
    return (
      <div className="grid gap-1.5 text-right">
        <span className="text-xs font-black text-slate-700">{label}</span>
        <Input value={String(form[key])} onChange={(e) => setField(key, type === "number" ? e.target.value : e.target.value)} placeholder={placeholder} type={type} className="h-9 rounded-lg" dir="rtl" />
      </div>
    )
  }

  if (!canRead) {
    return (
      <LoadingState text="ليس لديك صلاحية الوصول" minHeight="min-h-[200px]" />
    )
  }

  if (loading) {
    return <LoadingState text="جاري تحميل الفروع..." />
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        title="إدارة الفروع"
        subtitle="إضافة وتعديل وحذف فروع الصيدلية والمخازن"
        icon={Building}
        actions={canWriteBranches ? (
          <Button variant="default" size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="size-4" />
            إضافة فرع
          </Button>
        ) : undefined}
      />

      {showForm ? (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-base font-black text-slate-900">
              {editingId ? "تعديل فرع" : "إضافة فرع جديد"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-4">
            <div>
              <h3 className="mb-3 text-sm font-black text-slate-800">معلومات أساسية</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {input("كود الفرع *", "code", "BR-001")}
                {input("اسم الفرع *", "name", "الفرع الرئيسي")}
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">الحالة</span>
                  <Select value={form.status} onValueChange={setStatus}>
                    <SelectTrigger className="h-9 rounded-lg"><SelectValue>{statusOptions.find((o) => o.value === form.status)?.label ?? "نشط"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-black text-slate-800">العنوان</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {input("العنوان", "address", "عنوان الفرع")}
                {input("الحي", "district", "الحي")}
                {input("المدينة", "city", "المدينة")}
                {input("الدولة", "country", "الدولة")}
                {input("الرمز البريدي", "postal_code", "0")}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-black text-slate-800">جهات الاتصال</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {input("رقم الهاتف", "phone", "+966 5X XXX XXXX")}
                {input("البريد الإلكتروني", "email", "branch@pharmacy.com", "email")}
                {input("المسؤول", "manager_name", "اسم مدير الفرع")}
                {input("هاتف المسؤول", "manager_phone", "+966 5X XXX XXXX")}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-black text-slate-800">مستندات رسمية</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {input("الرقم الضريبي", "tax_id", "الرقم الضريبي للفرع")}
                {input("السجل التجاري", "commercial_register", "رقم السجل التجاري")}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-black text-slate-800">إعدادات إضافية</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">ملاحظات</span>
                  <Textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="ملاحظات إضافية" className="min-h-20 rounded-xl" dir="rtl" />
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-right">
                  <Switch checked={form.is_default} onCheckedChange={(v) => setField("is_default", v)} />
                  <div>
                    <span className="text-sm font-bold text-slate-800">فرع افتراضي</span>
                    <p className="text-xs font-semibold text-slate-400">يستخدم كفرع رئيسي في العمليات</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={handleSubmit} disabled={saving}>
                {saving ? "جاري الحفظ…" : editingId ? "تحديث" : "إضافة"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetForm}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {branches.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={Store}
              title="لا توجد فروع بعد"
              description="لم يتم إضافة أي فرع حتى الآن"
              action={canWriteBranches ? (
                <Button variant="outline" size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
                  <Plus className="size-4" />
                  إضافة فرع
                </Button>
              ) : undefined}
            />
          </div>
        ) : branches.map((branch) => (
          <Card key={branch.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                    <Store className="size-5" />
                  </span>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">{branch.name}</span>
                      {branch.is_default ? (
                        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-black text-brand">افتراضي</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">كود: {branch.code}</p>
                  </div>
                </div>
                <span>
                  {branch.status === "active" ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : branch.status === "inactive" ? (
                    <XCircle className="size-4 text-amber-400" />
                  ) : (
                    <XCircle className="size-4 text-red-400" />
                  )}
                </span>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                {branch.address ? <p className="flex items-center gap-1.5"><MapPin className="size-3.5 shrink-0" />{branch.address}{branch.city ? `, ${branch.city}` : ""}</p> : null}
                {branch.phone ? <p className="flex items-center gap-1.5"><Phone className="size-3.5 shrink-0" />{branch.phone}</p> : null}
                {branch.email ? <p className="flex items-center gap-1.5"><Mail className="size-3.5 shrink-0" />{branch.email}</p> : null}
                {branch.manager_name ? <p className="flex items-center gap-1.5"><User className="size-3.5 shrink-0" />{branch.manager_name}</p> : null}
                {branch.tax_id ? <p className="flex items-center gap-1.5"><FileText className="size-3.5 shrink-0" />ضريبي: {branch.tax_id}</p> : null}
              </div>

              {canWriteBranches ? (
                <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
                  <Button variant="ghost" size="icon-xs" onClick={() => startEdit(branch)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(branch.id, branch.is_default)} disabled={branch.is_default}>
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function BranchesPage() {
  return (
    <SettingsLayout>
      <BranchesContent />
    </SettingsLayout>
  )
}
