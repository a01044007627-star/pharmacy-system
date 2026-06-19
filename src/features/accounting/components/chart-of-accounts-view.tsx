"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Folder, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SkeletonRows } from "@/components/shared/empty-state"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Account = {
  id: string; code: string; name: string; type: string
  parent_id: string | null; is_active: boolean
}

type ResponseData = { accounts?: Account[]; error?: string }

const typeLabels: Record<string, string> = {
  asset: "أصل", liability: "خصم", equity: "حقوق ملكية", income: "إيراد", expense: "مصروف",
}

const typeColors: Record<string, string> = {
  asset: "text-blue-700 bg-blue-50 border-blue-200",
  liability: "text-amber-700 bg-amber-50 border-amber-200",
  equity: "text-purple-700 bg-purple-50 border-purple-200",
  income: "text-emerald-700 bg-emerald-50 border-emerald-200",
  expense: "text-rose-700 bg-rose-50 border-rose-200",
}

function buildTree(accounts: Account[], parentId: string | null = null, depth = 0): Account[] {
  return accounts
    .filter((a) => a.parent_id === parentId)
    .flatMap((a) => [a, ...buildTree(accounts, a.id, depth + 1)])
}

export function ChartOfAccountsView() {
  const auth = useAuth()
  const canWrite = auth.can("financials:write") || auth.isDeveloper
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [saving, setSaving] = useState(false)
  const [formCode, setFormCode] = useState("")
  const [formName, setFormName] = useState("")
  const [formType, setFormType] = useState("asset")
  const [formParentId, setFormParentId] = useState("")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId })
      if (query) params.set("query", query)
      const res = await fetch(`/api/accounts/chart-of-accounts?${params.toString()}`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as ResponseData
      if (!res.ok) throw new Error(data.error ?? "فشل التحميل")
      setAccounts(data.accounts ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الحسابات")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId, query])

  useEffect(() => { void load() }, [load])

  const tree = useMemo(() => buildTree(accounts), [accounts])

  const parentOptions = useMemo(() => accounts.filter((a) => a.is_active), [accounts])

  function openAdd() {
    setEditing(null); setFormCode(""); setFormName(""); setFormType("asset"); setFormParentId(""); setShowDialog(true)
  }

  function openEdit(account: Account) {
    setEditing(account); setFormCode(account.code); setFormName(account.name); setFormType(account.type); setFormParentId(account.parent_id ?? ""); setShowDialog(true)
  }

  async function save() {
    if (!formCode || !formName) { toast.error("الكود والاسم مطلوبان"); return }
    setSaving(true)
    try {
      const isEdit = Boolean(editing)
      const url = "/api/accounts/chart-of-accounts"
      const method = isEdit ? "PATCH" : "POST"
      const body: Record<string, unknown> = isEdit
        ? { pharmacy_id: auth.activePharmacyId, account_id: editing!.id, code: formCode, name: formName, type: formType, parent_id: formParentId || null }
        : { pharmacy_id: auth.activePharmacyId, code: formCode, name: formName, type: formType, parent_id: formParentId || null }

      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ")
      toast.success(isEdit ? "تم تحديث الحساب" : "تم إضافة الحساب")
      setShowDialog(false); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحفظ")
    } finally { setSaving(false) }
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`حذف الحساب "${account.name}"؟`)) return
    try {
      const res = await fetch(`/api/accounts/chart-of-accounts?account_id=${account.id}&pharmacy_id=${auth.activePharmacyId}`, { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "فشل الحذف")
      toast.success("تم حذف الحساب"); void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الحذف")
    }
  }

  const depthClass = (account: Account) => {
    const depth = (() => {
      let d = 0; let pid = account.parent_id
      while (pid) { d++; const p = accounts.find((a) => a.id === pid); pid = p?.parent_id ?? null }
      return d
    })()
    return `pr-${Math.min(depth * 6, 24)}`
  }

  return (
    <PageAccess permission="financials:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="شجرة الحسابات"
          subtitle="إدارة دليل الحسابات المحاسبي للصيدلية."
          icon={Folder}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
              </Button>
              {canWrite ? (
                <Button className="h-10 rounded-xl" onClick={openAdd}><Plus className="size-4" /> إضافة حساب</Button>
              ) : null}
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بكود أو اسم الحساب..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={8} /> : tree.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
              <Folder className="size-12 text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-500">لا توجد حسابات بعد. أضف أول حساب.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="p-3 text-right text-xs font-black text-slate-500">الكود</th>
                    <th className="p-3 text-right text-xs font-black text-slate-500">الاسم</th>
                    <th className="p-3 text-center text-xs font-black text-slate-500">النوع</th>
                    <th className="p-3 text-center text-xs font-black text-slate-500">الحالة</th>
                    {canWrite ? <th className="p-3 text-center text-xs font-black text-slate-500">إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {tree.map((account) => (
                    <tr key={account.id} className="border-b border-slate-50 transition hover:bg-slate-50/50">
                      <td className="p-3 text-sm font-bold text-slate-600" style={{ paddingRight: `${((() => { let d = 0; let pid = account.parent_id; while (pid) { d++; const p = accounts.find((a) => a.id === pid); pid = p?.parent_id ?? null } return d })() * 24 + 12)}px` }}>
                        {account.code}
                      </td>
                      <td className="p-3 text-sm font-black text-slate-900">{account.name}</td>
                      <td className="p-3 text-center">
                        <span className={cn("inline-block rounded-lg border px-2.5 py-1 text-xs font-black", typeColors[account.type] ?? "border-slate-200 bg-slate-50 text-slate-700")}>
                          {typeLabels[account.type] ?? account.type}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={cn("inline-block rounded-full px-3 py-0.5 text-xs font-black", account.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                          {account.is_active ? "نشط" : "غير نشط"}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="icon" variant="ghost" className="size-8" onClick={() => openEdit(account)} title="تعديل">
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-8 text-rose-500 hover:bg-rose-50" onClick={() => void deleteAccount(account)} title="حذف">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Dialog open={showDialog} onOpenChange={(open) => !open && setShowDialog(false)}>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">{editing ? "تعديل حساب" : "إضافة حساب"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5"><Label className="font-black">الكود</Label><Input value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="مثال: 1001" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="font-black">الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="اسم الحساب" className="h-11 rounded-xl" /></div>
              <div className="space-y-1.5">
                <Label className="font-black">النوع</Label>
                <NativeSelect value={formType} onChange={(e) => setFormType(e.target.value)}>
                  <NativeSelectOption value="asset">أصل</NativeSelectOption>
                  <NativeSelectOption value="liability">خصم</NativeSelectOption>
                  <NativeSelectOption value="equity">حقوق ملكية</NativeSelectOption>
                  <NativeSelectOption value="income">إيراد</NativeSelectOption>
                  <NativeSelectOption value="expense">مصروف</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label className="font-black">الحساب الأب</Label>
                <NativeSelect value={formParentId} onChange={(e) => setFormParentId(e.target.value)}>
                  <NativeSelectOption value="">لا يوجد (حاسبة رئيسي)</NativeSelectOption>
                  {parentOptions.filter((a) => a.id !== editing?.id).map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>{a.code} - {a.name}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setShowDialog(false)}>إلغاء</Button>
              <Button className="rounded-xl" disabled={saving || !formCode || !formName} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} {editing ? "تحديث" : "إضافة"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
