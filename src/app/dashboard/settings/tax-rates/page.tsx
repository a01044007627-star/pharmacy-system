"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Percent, Layers, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { TaxRateService } from "@/features/settings/services/tax-rate-service"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { LoadingState } from "@/components/shared/loading-state"
import { EmptyState } from "@/components/shared/empty-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"

interface TaxRate {
  id: string
  pharmacy_id: string
  name: string
  rate: number
  is_active: boolean
}

interface TaxGroup {
  id: string
  pharmacy_id: string
  name: string
  description?: string
  is_active: boolean
}

interface TaxGroupMember {
  id: string
  pharmacy_id: string
  group_id: string
  tax_rate_id: string
}

function TaxContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("tax")
  const [rates, setRates] = useState<TaxRate[]>([])
  const [groups, setGroups] = useState<TaxGroup[]>([])
  const [groupMembers, setGroupMembers] = useState<TaxGroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"rates" | "groups">("rates")

  const [rateForm, setRateForm] = useState({ name: "", rate: 0 })
  const [rateEditId, setRateEditId] = useState<string | null>(null)
  const [showRateForm, setShowRateForm] = useState(false)

  const [groupForm, setGroupForm] = useState({ name: "", description: "", selectedRates: [] as string[] })
  const [groupEditId, setGroupEditId] = useState<string | null>(null)
  const [showGroupForm, setShowGroupForm] = useState(false)

  const [saving, setSaving] = useState(false)

  const canWriteTax = can("settings:write") && canWrite

  const loadData = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const [ratesData, groupsData, membersData] = await Promise.all([
        TaxRateService.getTaxRates(),
        TaxRateService.getTaxGroups(),
        TaxRateService.getTaxGroupMembers(),
      ])
      setRates(ratesData)
      setGroups(groupsData)
      setGroupMembers(membersData)
    } catch {
      // tables may not exist yet
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadData() }, [loadData])

  function resetRateForm() { setRateForm({ name: "", rate: 0 }); setRateEditId(null); setShowRateForm(false) }

  async function handleRateSubmit() {
    if (!canWriteTax) { toast.error("ليست لديك صلاحية تعديل الضرائب"); return }
    if (!rateForm.name.trim() || rateForm.rate <= 0) { toast.error("اسم الضريبة والنسبة مطلوبان"); return }
    setSaving(true)
    try {
      if (rateEditId) {
        await TaxRateService.saveTaxRate({ id: rateEditId, name: rateForm.name, rate: rateForm.rate } as TaxRate)
        toast.success("تم تحديث الضريبة")
      } else {
        await TaxRateService.saveTaxRate({ name: rateForm.name, rate: rateForm.rate, is_active: true } as TaxRate)
        toast.success("تم إضافة الضريبة")
      }
      resetRateForm(); await loadData()
    } catch (err) { toast.error(err instanceof Error ? err.message : "فشل حفظ الضريبة")
    } finally { setSaving(false) }
  }

  async function handleRateDelete(id: string) {
    if (!canWriteTax) { toast.error("ليست لديك صلاحية حذف الضرائب"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذه الضريبة؟")) return
    try { await TaxRateService.deleteTaxRate(id); toast.success("تم حذف الضريبة"); await loadData()
    } catch (err) { toast.error(err instanceof Error ? err.message : "فشل حذف الضريبة") }
  }

  function resetGroupForm() { setGroupForm({ name: "", description: "", selectedRates: [] }); setGroupEditId(null); setShowGroupForm(false) }

  async function handleGroupSubmit() {
    if (!canWriteTax) { toast.error("ليست لديك صلاحية تعديل المجموعات"); return }
    if (!groupForm.name.trim()) { toast.error("اسم المجموعة مطلوب"); return }
    setSaving(true)
    try {
      const savedGroup = groupEditId
        ? await TaxRateService.saveTaxGroup({ id: groupEditId, name: groupForm.name, description: groupForm.description } as TaxGroup)
        : await TaxRateService.saveTaxGroup({ name: groupForm.name, description: groupForm.description, is_active: true } as TaxGroup)

      const groupId = groupEditId ?? savedGroup.id
      const existingMembers = groupMembers.filter((member) => member.group_id === groupId)
      const selected = new Set(groupForm.selectedRates)
      await Promise.all([
        ...existingMembers
          .filter((member) => !selected.has(member.tax_rate_id))
          .map((member) => TaxRateService.deleteTaxGroupMember(member.id)),
        ...groupForm.selectedRates
          .filter((rateId) => !existingMembers.some((member) => member.tax_rate_id === rateId))
          .map((rateId) => TaxRateService.addTaxGroupMember({
            pharmacy_id: "",
            group_id: groupId,
            tax_rate_id: rateId,
          } as TaxGroupMember)),
      ])

      toast.success(groupEditId ? "تم تحديث المجموعة" : "تم إضافة المجموعة")
      resetGroupForm(); await loadData()
    } catch (err) { toast.error(err instanceof Error ? err.message : "فشل حفظ المجموعة")
    } finally { setSaving(false) }
  }

  const handleGroupDelete = useCallback(async (id: string) => {
    if (!canWriteTax) { toast.error("ليست لديك صلاحية حذف المجموعات"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذه المجموعة؟")) return
    try { await TaxRateService.deleteTaxGroup(id); toast.success("تم حذف المجموعة"); await loadData()
    } catch (err) { toast.error(err instanceof Error ? err.message : "فشل حذف المجموعة") }
  }, [canWriteTax, loadData])

  if (!canRead) {
    return <LoadingState text="ليس لديك صلاحية الوصول" minHeight="min-h-[200px]" />
  }

  if (loading) {
    return <LoadingState text="جاري تحميل الضرائب..." />
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        title="الضرائب"
        subtitle="إدارة معدلات الضرائب والمجموعات"
        icon={Percent}
      />

      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab("rates")}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === "rates" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          معدلات الضرائب
        </button>
        <button
          onClick={() => setActiveTab("groups")}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === "groups" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          مجموعات الضرائب
        </button>
      </div>

      {activeTab === "rates" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWriteTax ? (
              <Button variant="default" size="sm" onClick={() => { resetRateForm(); setShowRateForm(true) }}>
                <Plus className="size-4" />
                إضافة ضريبة
              </Button>
            ) : null}
          </div>

          {showRateForm ? (
            <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-100 px-4 py-3">
                <CardTitle className="text-base font-black text-slate-900">
                  {rateEditId ? "تعديل ضريبة" : "إضافة ضريبة جديدة"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4 p-4">
                <div className="grid flex-1 gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">اسم الضريبة</span>
                  <Input value={rateForm.name} onChange={(e) => setRateForm((p) => ({ ...p, name: e.target.value }))} placeholder="ضريبة القيمة المضافة" className="h-9 rounded-lg" />
                </div>
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">النسبة %</span>
                  <Input type="number" value={rateForm.rate} onChange={(e) => setRateForm((p) => ({ ...p, rate: Number(e.target.value) }))} min={0} max={100} step={0.01} className="h-9 w-24 rounded-lg text-left" dir="ltr" />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleRateSubmit} disabled={saving}>
                    {saving ? "…" : rateEditId ? "تحديث" : "إضافة"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetRateForm}>إلغاء</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rates.length === 0 ? (
              <div className="col-span-full">
                <EmptyState icon={Percent} title="لا توجد ضرائب بعد" description="لم يتم إضافة أي ضريبة حتى الآن" />
              </div>
            ) : rates.map((rate) => (
              <Card key={rate.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <Percent className="size-5" />
                    </span>
                    <div className="text-right">
                      <span className="text-sm font-black text-slate-900">{rate.name}</span>
                      <p className="text-xs font-bold text-amber-600">{rate.rate}%</p>
                    </div>
                  </div>
                  {canWriteTax ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => { setRateForm({ name: rate.name, rate: rate.rate }); setRateEditId(rate.id); setShowRateForm(true) }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleRateDelete(rate.id)}>
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWriteTax ? (
              <Button variant="default" size="sm" onClick={() => { resetGroupForm(); setShowGroupForm(true) }}>
                <Plus className="size-4" />
                إضافة مجموعة
              </Button>
            ) : null}
          </div>

          {showGroupForm ? (
            <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-100 px-4 py-3">
                <CardTitle className="text-base font-black text-slate-900">
                  {groupEditId ? "تعديل مجموعة" : "إضافة مجموعة جديدة"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">اسم المجموعة</span>
                  <Input value={groupForm.name} onChange={(e) => setGroupForm((p) => ({ ...p, name: e.target.value }))} placeholder="مجموعة الضرائب الأساسية" className="h-9 rounded-lg" />
                </div>
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">الوصف</span>
                  <Input value={groupForm.description} onChange={(e) => setGroupForm((p) => ({ ...p, description: e.target.value }))} placeholder="وصف المجموعة" className="h-9 rounded-lg" />
                </div>
                {rates.length > 0 ? (
                  <div className="text-right">
                    <span className="mb-2 block text-xs font-black text-slate-700">الضرائب في المجموعة</span>
                    <div className="flex flex-wrap gap-2">
                      {rates.map((rate) => {
                        const selected = groupForm.selectedRates.includes(rate.id)
                        return (
                          <button
                            key={rate.id}
                            onClick={() => setGroupForm((p) => ({
                              ...p,
                              selectedRates: selected
                                ? p.selectedRates.filter((id) => id !== rate.id)
                                : [...p.selectedRates, rate.id],
                            }))}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${selected ? "border-brand bg-brand-subtle text-brand" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                          >
                            {selected ? <Check className="size-3" /> : null}
                            {rate.name} ({rate.rate}%)
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleGroupSubmit} disabled={saving}>
                    {saving ? "…" : groupEditId ? "تحديث" : "إضافة"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetGroupForm}>إلغاء</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.length === 0 ? (
              <div className="col-span-full">
                <EmptyState icon={Layers} title="لا توجد مجموعات بعد" description="لم يتم إضافة أي مجموعة ضرائب حتى الآن" />
              </div>
            ) : groups.map((group) => (
              <Card key={group.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                        <Layers className="size-5" />
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-black text-slate-900">{group.name}</span>
                        {group.description ? <p className="text-xs font-semibold text-slate-500">{group.description}</p> : null}
                      </div>
                    </div>
                    {canWriteTax ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            setGroupForm({
                              name: group.name,
                              description: group.description ?? "",
                              selectedRates: groupMembers.filter((m) => m.group_id === group.id).map((m) => m.tax_rate_id),
                            })
                            setGroupEditId(group.id)
                            setShowGroupForm(true)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => handleGroupDelete(group.id)}>
                          <Trash2 className="size-3.5 text-red-500" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {groupMembers.filter((m) => m.group_id === group.id).map((m) => {
                      const rate = rates.find((r) => r.id === m.tax_rate_id)
                      return rate ? (
                        <span key={m.id} className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          {rate.name} ({rate.rate}%)
                        </span>
                      ) : null
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TaxPage() {
  return (
    <SettingsLayout>
      <TaxContent />
    </SettingsLayout>
  )
}
