"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, EyeOff, Loader2, Plus, RefreshCw, Wallet } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SkeletonRows } from "@/components/shared/empty-state"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type RegisterTransaction = {
  id: string; register_id: string; transaction_type: string; amount: number; reference: string | null; notes: string | null; created_at: string
}

type CashRegister = {
  id: string; branch_id: string; name: string; opening_balance: number; closing_balance: number; status: string
  branch: { id: string; name: string; code: string | null } | null
  transactions?: RegisterTransaction[]
}

type ResponseData = { registers?: CashRegister[]; error?: string }

export function CashRegisterView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formName, setFormName] = useState("")
  const [formBranchId, setFormBranchId] = useState("")
  const [formOpening, setFormOpening] = useState("0")

  const canWrite = auth.can("financials:write") || auth.isDeveloper
  const money = useCallback((v: number) => `${Number(v || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/accounts/cash-registers?pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as ResponseData
      if (!res.ok) throw new Error(data.error ?? "فشل التحميل")
      setRegisters(data.registers ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الخزائن")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  function resetForm() { setFormName(""); setFormBranchId(""); setFormOpening("0") }

  async function addRegister() {
    if (!formName) { toast.error("اسم الخزنة مطلوب"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/accounts/cash-registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: formBranchId || auth.activeBranchId,
          name: formName,
          opening_balance: Number(formOpening) || 0,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الإضافة")
      toast.success("تم إضافة الخزنة")
      setShowAdd(false); resetForm(); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إضافة الخزنة")
    } finally { setSaving(false) }
  }

  const summary = useMemo(() => {
    const totalOpening = registers.reduce((s, r) => s + Number(r.opening_balance || 0), 0)
    const totalClosing = registers.reduce((s, r) => s + Number(r.closing_balance || 0), 0)
    const openCount = registers.filter((r) => r.status === "open").length
    return { totalOpening, totalClosing, openCount, totalCount: registers.length }
  }, [registers])

  return (
    <PageAccess permission="financials:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="الخزينة"
          subtitle="إدارة الخزائن النقدية للصيدلية وعرض الأرصدة."
          icon={Wallet}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? (
                <Button className="h-10 rounded-xl" onClick={() => { resetForm(); setShowAdd(true) }}>
                  <Plus className="size-4" /> إضافة خزنة
                </Button>
              ) : null}
            </>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">عدد الخزائن</p><p className="mt-2 text-xl font-black text-slate-950">{summary.totalCount.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">الخزائن المفتوحة</p><p className="mt-2 text-xl font-black text-emerald-700">{summary.openCount.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي الافتتاحي</p><p className="mt-2 text-xl font-black text-brand">{money(summary.totalOpening)}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي الختامي</p><p className="mt-2 text-xl font-black text-blue-700">{money(summary.totalClosing)}</p></CardContent></Card>
        </div>

        {loading ? <SkeletonRows count={4} /> : registers.length === 0 ? (
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
              <Wallet className="size-12 text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-500">لا توجد خزائن بعد. أضف أول خزنة.</p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4">
            {registers.map((register) => (
              <Card key={register.id} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
                <CardHeader
                  className={cn("flex cursor-pointer flex-row items-center justify-between border-b border-slate-100 px-4 py-3", expandedId === register.id ? "bg-brand-muted/30" : "bg-slate-50/50")}
                  onClick={() => setExpandedId((prev) => prev === register.id ? null : register.id)}
                >
                  <div className="flex items-center gap-3">
                    <Wallet className="size-5 text-brand" />
                    <CardTitle className="text-base font-black">{register.name}</CardTitle>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-black", register.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                      {register.status === "open" ? "مفتوحة" : "مغلقة"}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-black">{money(register.closing_balance)}</span>
                    <span className="text-xs text-slate-400">{register.branch?.name ?? "—"}</span>
                    {expandedId === register.id ? <EyeOff className="size-4 text-slate-400" /> : <Eye className="size-4 text-slate-400" />}
                  </div>
                </CardHeader>
                {expandedId === register.id ? (
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-black text-slate-500">الرصيد الافتتاحي</p><p className="mt-1 text-lg font-black text-slate-700">{money(register.opening_balance)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-black text-slate-500">الرصيد الختامي</p><p className="mt-1 text-lg font-black text-brand">{money(register.closing_balance)}</p></div>
                    </div>
                    <p className="text-xs font-black text-slate-400 mb-2">حركات الخزنة</p>
                    {(!register.transactions || register.transactions.length === 0) ? (
                      <p className="text-sm font-bold text-slate-400 text-center py-4">لا توجد حركات</p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[500px]">
                          <thead><tr className="border-b border-slate-100 bg-slate-50"><th className="p-2 text-right text-xs font-black text-slate-500">النوع</th><th className="p-2 text-center text-xs font-black text-slate-500">المبلغ</th><th className="p-2 text-right text-xs font-black text-slate-500">المرجع</th><th className="p-2 text-center text-xs font-black text-slate-500">التاريخ</th></tr></thead>
                          <tbody>{register.transactions.map((tx) => (
                            <tr key={tx.id} className="border-b border-slate-50">
                              <td className="p-2 text-sm font-bold">{tx.transaction_type}</td>
                              <td className={cn("p-2 text-center font-black", Number(tx.amount) >= 0 ? "text-emerald-700" : "text-rose-600")}>{money(tx.amount)}</td>
                              <td className="p-2 text-sm text-slate-500">{tx.reference ?? "—"}</td>
                              <td className="p-2 text-center text-xs font-bold">{new Date(tx.created_at).toLocaleString("ar-EG")}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        )}

        <Dialog open={showAdd} onOpenChange={(open) => !open && setShowAdd(false)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">إضافة خزنة جديدة</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5"><Label className="font-black">اسم الخزنة</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: خزنة رئيسية" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5">
                <Label className="font-black">الفرع</Label>
                <NativeSelect value={formBranchId} onChange={(e) => setFormBranchId(e.target.value)}>
                  <NativeSelectOption value="">اختر الفرع</NativeSelectOption>
                  {auth.branches.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="space-y-1.5"><Label className="font-black">الرصيد الافتتاحي</Label><Input type="number" min="0" value={formOpening} onChange={(e) => setFormOpening(e.target.value)} className="h-11 rounded-xl" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setShowAdd(false)}>إلغاء</Button>
              <Button className="rounded-xl" disabled={saving || !formName} onClick={() => void addRegister()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} إضافة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
