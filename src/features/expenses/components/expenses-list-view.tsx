"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Eye, Plus, RefreshCw, Search, Wallet, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { downloadCsv as saveCsv } from "@/lib/csv-utils"
import { cn } from "@/lib/utils"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { syncManager } from "@/lib/sync/sync-manager"
import { network } from "@/lib/network"

type ExpenseRow = {
  id: string
  title: string
  category_id?: string | null
  category_name?: string | null
  amount: number
  tax_amount: number
  total: number
  payment_method: string
  paid_to?: string | null
  notes?: string | null
  expense_date: string
  voided_at?: string | null
  branch?: { id: string; name: string } | null
}

type ExpenseCategory = {
  id: string
  name: string
  parent_id?: string | null
  sort_order: number
}

type Branch = {
  id: string
  name: string
  code?: string | null
}

export function ExpensesListView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [summary, setSummary] = useState({ count: 0, total: 0, tax: 0 })
  const [query, setQuery] = useState("")
  const [categoryId, setCategoryId] = useState("all")
  const [branchId, setBranchId] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ExpenseRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const [formTitle, setFormTitle] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formTax, setFormTax] = useState("")
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formBranchId, setFormBranchId] = useState("")
  const [formPaymentMethod, setFormPaymentMethod] = useState("cash")
  const [formPaidTo, setFormPaidTo] = useState("")
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 16))
  const [formNotes, setFormNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const [catName, setCatName] = useState("")
  const [catSaving, setCatSaving] = useState(false)

  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: branchId,
        query,
        category_id: categoryId !== "all" ? categoryId : "",
        page: String(page),
        page_size: "25",
      })
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const response = await fetch(`/api/expenses?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { expenses?: ExpenseRow[]; summary?: { count: number; total: number; tax: number }; pagination?: { totalPages: number }; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المصروفات")
      setRows(data.expenses ?? [])
      setSummary(data.summary ?? { count: 0, total: 0, tax: 0 })
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      const pharmacyId = auth.activePharmacyId
      if (pharmacyId && (!network.isOnline || error instanceof TypeError)) {
        const [cachedExpenses, cachedBranches] = await Promise.all([
          localDB.getTableRows("pharmacy_expenses"),
          localDB.getTableRows("pharmacy_branches"),
        ])
        const branchMap = new Map(cachedBranches.map((row) => [String(row.id ?? ""), { id: String(row.id ?? ""), name: String(row.name ?? "") }]))
        const needle = query.trim().toLowerCase()
        const filtered = cachedExpenses.filter((row) => {
          if (String(row.pharmacy_id ?? "") !== pharmacyId || row.voided_at) return false
          if (branchId !== "all" && String(row.branch_id ?? "") !== branchId) return false
          if (categoryId !== "all" && String(row.category_id ?? "") !== categoryId) return false
          const date = String(row.expense_date ?? "").slice(0, 10)
          if (dateFrom && date < dateFrom) return false
          if (dateTo && date > dateTo) return false
          if (needle && ![row.title, row.paid_to, row.category_name].some((value) => String(value ?? "").toLowerCase().includes(needle))) return false
          return true
        }).sort((a, b) => String(b.expense_date ?? "").localeCompare(String(a.expense_date ?? "")))
        const start = (page - 1) * 25
        const offlineRows = filtered.slice(start, start + 25).map((row) => ({
          ...row,
          id: String(row.id), title: String(row.title ?? ""), amount: Number(row.amount ?? 0), tax_amount: Number(row.tax_amount ?? 0),
          total: Number(row.total ?? 0), payment_method: String(row.payment_method ?? "cash"), expense_date: String(row.expense_date ?? ""),
          branch: branchMap.get(String(row.branch_id ?? "")) ?? null,
        })) as ExpenseRow[]
        setRows(offlineRows)
        setSummary({ count: filtered.length, total: filtered.reduce((sum, row) => sum + Number(row.total ?? 0), 0), tax: filtered.reduce((sum, row) => sum + Number(row.tax_amount ?? 0), 0) })
        setTotalPages(Math.max(1, Math.ceil(filtered.length / 25)))
        toast.warning("تم عرض المصروفات المحفوظة على الجهاز")
      } else {
        toast.error(error instanceof Error ? error.message : "فشل تحميل المصروفات")
      }
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, branchId, categoryId, dateFrom, dateTo, page, query])

  const loadBootstrap = useCallback(async () => {
    if (!auth.activePharmacyId) return
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, branch_id: auth.activeBranchId ?? "", bootstrap: "1" })
      const response = await fetch(`/api/expenses?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { categories?: ExpenseCategory[]; branches?: Branch[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل البيانات")
      setCategories(data.categories ?? [])
      setBranches(data.branches ?? [])
    } catch (error) {
      if (!network.isOnline || error instanceof TypeError) {
        const [cachedCategories, cachedBranches] = await Promise.all([
          localDB.getTableRows("pharmacy_expense_categories"), localDB.getTableRows("pharmacy_branches"),
        ])
        setCategories(cachedCategories.filter((row) => row.pharmacy_id === auth.activePharmacyId).map((row) => ({ id: String(row.id), name: String(row.name ?? ""), parent_id: row.parent_id ? String(row.parent_id) : null, sort_order: Number(row.sort_order ?? 0) })))
        setBranches(cachedBranches.filter((row) => row.pharmacy_id === auth.activePharmacyId).map((row) => ({ id: String(row.id), name: String(row.name ?? ""), code: row.code ? String(row.code) : null })))
      } else toast.error(error instanceof Error ? error.message : "فشل تحميل التصنيفات")
    }
  }, [auth.activeBranchId, auth.activePharmacyId])

  useEffect(() => { void loadBootstrap() }, [loadBootstrap])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  function openCreate() {
    setFormTitle("")
    setFormAmount("")
    setFormTax("")
    setFormCategoryId("")
    setFormBranchId(auth.activeBranchId ?? "")
    setFormPaymentMethod("cash")
    setFormPaidTo("")
    setFormDate(new Date().toISOString().slice(0, 16))
    setFormNotes("")
    setExpenseOpen(true)
  }

  async function saveExpense() {
    if (!formTitle.trim()) { toast.error("أدخل اسم المصروف"); return }
    if (!formBranchId) { toast.error("اختر الفرع"); return }
    const requestId = crypto.randomUUID()
    const body = {
      pharmacy_id: auth.activePharmacyId,
      branch_id: formBranchId,
      title: formTitle.trim(),
      amount: Number(formAmount) || 0,
      tax_amount: Number(formTax) || 0,
      category_id: formCategoryId || null,
      payment_method: formPaymentMethod,
      paid_to: formPaidTo.trim() || null,
      expense_date: new Date(formDate).toISOString(),
      notes: formNotes.trim() || null,
      client_request_id: requestId,
    }
    setSaving(true)
    try {
      const response = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await response.json().catch(() => ({})) as { expense?: Record<string, unknown>; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ المصروف")
      if (data.expense) await localDB.putTableRow("pharmacy_expenses", data.expense, true)
      toast.success("تم تسجيل المصروف وربطه بالخزنة والقيد المحاسبي")
      setExpenseOpen(false)
      await load()
    } catch (error) {
      if (auth.activePharmacyId && (!network.isOnline || error instanceof TypeError)) {
        const category = categories.find((row) => row.id === formCategoryId)
        const localId = `offline-expense-${requestId}`
        const total = Math.max(0, Number(formAmount) || 0) + Math.max(0, Number(formTax) || 0)
        const localExpense = { id: localId, ...body, category_name: category?.name ?? "مصروفات عامة", total, created_by: auth.user?.id ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), offline_pending: true }
        await localDB.putTableRow("pharmacy_expenses", localExpense, false)
        await queueApiRequest({ path: "/api/expenses", method: "POST", body, label: `مصروف ${formTitle.trim()}` })
        if (formPaymentMethod === "cash") {
          const shifts = await localDB.getTableRows("pharmacy_shifts")
          const open = shifts.find((row) => row.pharmacy_id === auth.activePharmacyId && row.branch_id === formBranchId && row.user_id === auth.user?.id && row.status === "open")
          if (open) {
            const expenses = Number(open.total_expenses ?? 0) + total
            await localDB.putTableRow("pharmacy_shifts", { ...open, total_expenses: expenses, expected_balance: Number(open.opening_balance ?? 0) + Number(open.cash_sales ?? 0) - expenses, updated_at: new Date().toISOString() }, false)
          }
        }
        await syncManager.refreshPending()
        toast.warning("تم حفظ المصروف على الجهاز وسيُرسل تلقائيًا عند رجوع الإنترنت")
        setExpenseOpen(false)
        await load()
      } else toast.error(error instanceof Error ? error.message : "فشل حفظ المصروف")
    } finally {
      setSaving(false)
    }
  }

  async function saveCategory() {
    if (!catName.trim()) { toast.error("أدخل اسم التصنيف"); return }
    setCatSaving(true)
    try {
      const response = await fetch("/api/expenses/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, name: catName.trim() }),
      })
      const data = await response.json().catch(() => ({})) as { category?: ExpenseCategory; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إضافة التصنيف")
      toast.success("تم إضافة التصنيف")
      setCatName("")
      setCategories((prev) => [...prev, data.category!])
    } catch (error) {
      if (auth.activePharmacyId && (!network.isOnline || error instanceof TypeError)) {
        const id = `offline-expense-category-${crypto.randomUUID()}`
        const body = { pharmacy_id: auth.activePharmacyId, name: catName.trim(), client_request_id: id }
        const localCategory: ExpenseCategory & { pharmacy_id: string; updated_at: string } = { id, pharmacy_id: auth.activePharmacyId, name: catName.trim(), parent_id: null, sort_order: 0, updated_at: new Date().toISOString() }
        await localDB.putTableRow("pharmacy_expense_categories", localCategory, false)
        await queueApiRequest({ path: "/api/expenses/categories", method: "POST", body, label: `تصنيف مصروف ${catName.trim()}` })
        await syncManager.refreshPending()
        setCategories((prev) => [...prev, localCategory])
        setCatName("")
        toast.warning("تم حفظ التصنيف على الجهاز وسيُزامن عند رجوع الإنترنت")
      } else toast.error(error instanceof Error ? error.message : "فشل إضافة التصنيف")
    } finally {
      setCatSaving(false)
    }
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetailLoading(true)
    setDetail(null)
    try {
      const response = await fetch(`/api/expenses/${id}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { expense?: ExpenseRow; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المصروف")
      setDetail(data.expense ?? null)
    } catch (error) {
      if (!network.isOnline || error instanceof TypeError) {
        const cached = await localDB.getTableRow("pharmacy_expenses", id)
        if (cached) setDetail({ ...cached, id: String(cached.id), title: String(cached.title ?? ""), amount: Number(cached.amount ?? 0), tax_amount: Number(cached.tax_amount ?? 0), total: Number(cached.total ?? 0), payment_method: String(cached.payment_method ?? "cash"), expense_date: String(cached.expense_date ?? "") } as ExpenseRow)
        else toast.error("المصروف غير محفوظ على الجهاز")
      } else toast.error(error instanceof Error ? error.message : "فشل تحميل المصروف")
    } finally {
      setDetailLoading(false)
    }
  }

  async function voidExpense() {
    if (!detail) return
    const reason = window.prompt(`سبب إلغاء المصروف "${detail.title}":`, "إلغاء مصروف")
    if (reason === null) return
    setVoiding(true)
    try {
      const response = await fetch(`/api/expenses/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إلغاء المصروف")
      toast.success("تم إلغاء المصروف")
      setDetailId(null)
      setDetail(null)
      await load()
    } catch (error) {
      if (auth.activePharmacyId && (!network.isOnline || error instanceof TypeError)) {
        await queueApiRequest({ path: `/api/expenses/${detail.id}`, method: "PATCH", body: { action: "void", reason }, label: `إلغاء مصروف ${detail.title}` })
        const cached = await localDB.getTableRow("pharmacy_expenses", detail.id)
        if (cached) await localDB.putTableRow("pharmacy_expenses", { ...cached, voided_at: new Date().toISOString(), void_reason: reason, updated_at: new Date().toISOString() }, false)
        await syncManager.refreshPending()
        toast.warning("تم إلغاء المصروف على الجهاز وسيُعكس محاسبيًا عند رجوع الإنترنت")
        setDetailId(null); setDetail(null); await load()
      } else toast.error(error instanceof Error ? error.message : "فشل إلغاء المصروف")
    } finally {
      setVoiding(false)
    }
  }

  function exportExpensesCsv() {
    const data = [
      ["العنوان", "التصنيف", "الفرع", "المبلغ", "الضريبة", "الإجمالي", "طريقة الدفع", "المدفوع لـ", "التاريخ"],
      ...rows.map((row) => [row.title, row.category_name ?? "", row.branch?.name ?? "", String(row.amount), String(row.tax_amount), String(row.total), row.payment_method, row.paid_to ?? "", row.expense_date]),
    ]
    saveCsv("المصروفات.csv", data)
  }

  const cards = useMemo(() => [
    ["عدد المصروفات", summary.count.toLocaleString("ar-EG"), "text-slate-950"],
    ["إجمالي المصروفات", money(summary.total), "text-rose-600"],
    ["إجمالي الضريبة", money(summary.tax), "text-amber-600"],
  ], [money, summary])

  const canWrite = auth.isDeveloper || auth.can("financials:write")

  return (
    <PageAccess permission="financials:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="المصروفات"
          subtitle="تسجيل ومتابعة مصروفات الصيدلية اليومية والدورية."
          icon={Wallet}
          actions={(
            <>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
              <Button variant="outline" className="h-10 rounded-xl" disabled={!rows.length} onClick={exportExpensesCsv}><Download className="size-4" /> تصدير</Button>
              <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogTrigger render={<Button variant="outline" className="h-10 rounded-xl"><Plus className="size-4" /> تصنيف</Button>} />
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle className="font-black">إدارة التصنيفات</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      {categories.map((cat) => (
                        <div key={cat.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm font-bold">
                          <span>{cat.name}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="اسم التصنيف الجديد" className="h-11 rounded-xl" />
                      <Button className="h-11 rounded-xl font-black" disabled={catSaving || !catName.trim()} onClick={() => void saveCategory()}>
                        {catSaving ? "..." : "إضافة"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              {canWrite ? (
                <Button className="h-10 rounded-xl" onClick={openCreate}><Plus className="size-4" /> مصروف</Button>
              ) : null}
            </>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="بحث بالعنوان أو المدفوع لـ..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل التصنيفات</NativeSelectOption>
              {categories.map((cat) => <NativeSelectOption key={cat.id} value={cat.id}>{cat.name}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الفروع</NativeSelectOption>
              {branches.map((br) => <NativeSelectOption key={br.id} value={br.id}>{br.name}</NativeSelectOption>)}
            </NativeSelect>
            <div className="flex gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="h-11 rounded-xl" />
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="h-11 rounded-xl" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map(([label, value, tone]) => (
            <Card key={label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className={cn("mt-2 text-xl font-black", tone)}>{value}</p></CardContent></Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Wallet} title="لا توجد مصروفات" description="سجل أول مصروف للصيدلية." />
          ) : (
            <Table className="min-w-[1000px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">العنوان</TableHead><TableHead className="text-right">التصنيف</TableHead><TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-center">المبلغ</TableHead><TableHead className="text-center">الضريبة</TableHead><TableHead className="text-center">الإجمالي</TableHead>
                <TableHead className="text-center">طريقة الدفع</TableHead><TableHead className="text-center">التاريخ</TableHead><TableHead className="text-center">عرض</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.title}</TableCell><TableCell className="font-bold">{row.category_name ?? "—"}</TableCell><TableCell>{row.branch?.name ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{money(row.amount)}</TableCell><TableCell className="text-center font-black text-amber-600">{money(row.tax_amount)}</TableCell><TableCell className="text-center font-black text-rose-600">{money(row.total)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{row.payment_method === "cash" ? "نقدي" : row.payment_method === "card" ? "بطاقة" : row.payment_method === "bank-transfer" ? "تحويل" : "محفظة"}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.expense_date).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center"><Button size="icon" variant="ghost" onClick={() => openDetail(row.id)}><Eye className="size-4" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>التالي</Button></div>
          </div>
        </Card>

        <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle className="font-black">تسجيل مصروف جديد</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label className="font-bold">العنوان</Label>
                <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="اسم المصروف" className="h-11 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="font-bold">المبلغ</Label>
                  <Input type="number" min="0" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" className="h-11 rounded-xl" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-bold">الضريبة</Label>
                  <Input type="number" min="0" value={formTax} onChange={(e) => setFormTax(e.target.value)} placeholder="0.00" className="h-11 rounded-xl" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="font-bold">التصنيف</Label>
                  <NativeSelect value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)}>
                    <NativeSelectOption value="">بدون تصنيف</NativeSelectOption>
                    {categories.map((cat) => <NativeSelectOption key={cat.id} value={cat.id}>{cat.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label className="font-bold">الفرع</Label>
                  <NativeSelect value={formBranchId} onChange={(e) => setFormBranchId(e.target.value)}>
                    {branches.map((br) => <NativeSelectOption key={br.id} value={br.id}>{br.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="font-bold">طريقة الدفع</Label>
                  <NativeSelect value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value)}>
                    <NativeSelectOption value="cash">نقدي</NativeSelectOption><NativeSelectOption value="card">بطاقة</NativeSelectOption><NativeSelectOption value="wallet">محفظة</NativeSelectOption><NativeSelectOption value="bank-transfer">تحويل بنكي</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label className="font-bold">المدفوع لـ</Label>
                  <Input value={formPaidTo} onChange={(e) => setFormPaidTo(e.target.value)} placeholder="اسم المستفيد" className="h-11 rounded-xl" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="font-bold">التاريخ</Label>
                <Input type="datetime-local" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="h-11 rounded-xl" />
              </div>
              <div className="grid gap-2">
                <Label className="font-bold">ملاحظات</Label>
                <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="ملاحظات..." className="min-h-20 rounded-xl" />
              </div>
              <Button className="h-11 w-full rounded-xl font-black" disabled={saving} onClick={() => void saveExpense()}>
                {saving ? "جاري الحفظ..." : "حفظ المصروف"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!detailId} onOpenChange={(open) => { if (!open) { setDetailId(null); setDetail(null) } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="font-black">تفاصيل المصروف</DialogTitle></DialogHeader>
            {detailLoading ? <p className="py-4 text-center font-bold text-slate-500">جاري التحميل...</p> : detail ? (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between"><span className="font-bold text-slate-500">العنوان</span><strong>{detail.title}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">التصنيف</span><strong>{detail.category_name ?? "—"}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">الفرع</span><strong>{detail.branch?.name ?? "—"}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">المبلغ</span><strong>{money(detail.amount)}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">الضريبة</span><strong>{money(detail.tax_amount)}</strong></div>
                  <div className="flex justify-between text-rose-600"><span className="font-bold">الإجمالي</span><strong>{money(detail.total)}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">طريقة الدفع</span><strong>{detail.payment_method === "cash" ? "نقدي" : detail.payment_method === "card" ? "بطاقة" : "تحويل"}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">المدفوع لـ</span><strong>{detail.paid_to ?? "—"}</strong></div>
                  <div className="flex justify-between"><span className="font-bold text-slate-500">التاريخ</span><strong>{new Date(detail.expense_date).toLocaleString("ar-EG")}</strong></div>
                  {detail.notes ? <div className="flex justify-between"><span className="font-bold text-slate-500">ملاحظات</span><strong>{detail.notes}</strong></div> : null}
                </div>
                {detail.voided_at ? (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 font-black text-rose-700">ملغي</Badge>
                ) : (auth.isDeveloper || auth.can("financials:write")) ? (
                  <Button variant="destructive" className="h-11 w-full rounded-xl font-black" disabled={voiding} onClick={() => void voidExpense()}>
                    <XCircle className="size-4" /> {voiding ? "جاري الإلغاء..." : "إلغاء المصروف"}
                  </Button>
                ) : null}
              </div>
            ) : <p className="py-4 text-center font-bold text-rose-600">المصروف غير موجود</p>}
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
