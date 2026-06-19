"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift, Package, Percent, Plus, RefreshCw, Search, Tag, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type CouponRow = {
  id: string
  code: string
  discount_type: string
  discount_value: number
  min_purchase: number
  max_uses: number
  used_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
}

type BundleItem = {
  item_id: string
  quantity: number
}

type BundleRow = {
  id: string
  name: string
  price: number
  total_original_price: number
  is_active: boolean
  items: BundleItem[]
}

type CouponResponse = { coupons?: CouponRow[]; pagination?: { totalPages: number }; error?: string }
type BundleResponse = { bundles?: BundleRow[]; pagination?: { totalPages: number }; error?: string }

export function PromotionsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const canWrite = auth.isDeveloper || auth.can("sales:write")

  const [tab, setTab] = useState<"coupons" | "bundles">("coupons")

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="العروض والخصومات"
          subtitle="إدارة كوبونات الخصم وباقات المنتجات."
          icon={Gift}
          actions={(
            <div className="flex gap-2">
              <Button variant={tab === "coupons" ? "default" : "outline"} className="h-10 rounded-xl" onClick={() => setTab("coupons")}>
                <Tag className="size-4" /> كوبونات
              </Button>
              <Button variant={tab === "bundles" ? "default" : "outline"} className="h-10 rounded-xl" onClick={() => setTab("bundles")}>
                <Package className="size-4" /> باقات
              </Button>
            </div>
          )}
        />

        {tab === "coupons" ? <CouponsSection auth={auth} settings={settings} money={money} canWrite={canWrite} /> : null}
        {tab === "bundles" ? <BundlesSection auth={auth} settings={settings} money={money} canWrite={canWrite} /> : null}
      </section>
    </PageAccess>
  )
}

function CouponsSection({ auth, settings, money, canWrite }: { auth: ReturnType<typeof useAuth>; settings: ReturnType<typeof useAppSettings>; money: (value: number) => string; canWrite: boolean }) {
  const [rows, setRows] = useState<CouponRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ code: "", discount_type: "percentage", discount_value: "", min_purchase: "", max_uses: "", valid_from: "", valid_until: "", is_active: true })

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query, page: String(page), page_size: "25" })
      const response = await fetch(`/api/sales/coupons?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as CouponResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الكوبونات")
      setRows(data.coupons ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الكوبونات")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId, page, query])

  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t) }, [load])

  function openCreate() {
    setEditId(null)
    setForm({ code: "", discount_type: "percentage", discount_value: "", min_purchase: "", max_uses: "", valid_from: "", valid_until: "", is_active: true })
    setDialogOpen(true)
  }

  function openEdit(coupon: CouponRow) {
    setEditId(coupon.id)
    setForm({
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: String(coupon.discount_value),
      min_purchase: String(coupon.min_purchase),
      max_uses: String(coupon.max_uses),
      valid_from: coupon.valid_from ?? "",
      valid_until: coupon.valid_until ?? "",
      is_active: coupon.is_active,
    })
    setDialogOpen(true)
  }

  async function save() {
    if (!form.code.trim()) { toast.error("كود الكوبون مطلوب"); return }
    if (!Number(form.discount_value) || Number(form.discount_value) <= 0) { toast.error("قيمة الخصم مطلوبة"); return }
    try {
      const url = editId ? "/api/sales/coupons" : "/api/sales/coupons"
      const method = editId ? "PATCH" : "POST"
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editId ? { id: editId } : { pharmacy_id: auth.activePharmacyId }),
          code: form.code.trim(),
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value),
          min_purchase: Number(form.min_purchase) || 0,
          max_uses: Number(form.max_uses) || 0,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
          is_active: form.is_active,
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ الكوبون")
      toast.success(editId ? "تم تحديث الكوبون" : "تم إنشاء الكوبون")
      setDialogOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ الكوبون")
    }
  }

  async function deleteCoupon(coupon: CouponRow) {
    if (!window.confirm(`حذف الكوبون "${coupon.code}"؟`)) return
    try {
      const params = new URLSearchParams({ id: coupon.id, pharmacy_id: auth.activePharmacyId! })
      const response = await fetch(`/api/sales/coupons?${params.toString()}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حذف الكوبون")
      toast.success("تم حذف الكوبون")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف الكوبون")
    }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardContent className="flex gap-3 p-4">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="بحث بكود الكوبون..." className="h-11 rounded-2xl pr-10 font-bold" />
          </div>
          {canWrite ? <Button className="h-11 rounded-2xl font-black" onClick={openCreate}><Plus className="size-4" /> كوبون جديد</Button> : null}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-black">{editId ? "تعديل كوبون" : "كوبون جديد"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><label className="mb-1 block text-xs font-black text-slate-700">الكود</label><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="مثال: SALE20" className="h-10 rounded-xl font-bold" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">النوع</label>
                <NativeSelect value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}>
                  <NativeSelectOption value="percentage">نسبة مئوية</NativeSelectOption>
                  <NativeSelectOption value="fixed">قيمة ثابتة</NativeSelectOption>
                </NativeSelect>
              </div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">القيمة</label><Input value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} type="number" min="0" step="0.01" className="h-10 rounded-xl font-bold" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">أقل فاتورة</label><Input value={form.min_purchase} onChange={(e) => setForm((f) => ({ ...f, min_purchase: e.target.value }))} type="number" min="0" className="h-10 rounded-xl font-bold" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">أقصى استخدام</label><Input value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))} type="number" min="0" className="h-10 rounded-xl font-bold" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-black text-slate-700">من تاريخ</label><Input value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} type="date" className="h-10 rounded-xl font-bold" /></div>
              <div><label className="mb-1 block text-xs font-black text-slate-700">إلى تاريخ</label><Input value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} type="date" className="h-10 rounded-xl font-bold" /></div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={form.is_active} onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: !!checked }))} /><span className="text-sm font-bold select-none">نشط</span></label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={() => void save()}>حفظ</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
        {loading ? <SkeletonRows count={5} /> : rows.length === 0 ? (
          <EmptyState icon={Tag} title="لا توجد كوبونات" description="لم يتم إنشاء أي كوبون خصم بعد." />
        ) : (
          <Table className="min-w-[850px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الكود</TableHead>
                <TableHead className="text-center">النوع</TableHead>
                <TableHead className="text-center">القيمة</TableHead>
                <TableHead className="text-center">أقل فاتورة</TableHead>
                <TableHead className="text-center">استخدام</TableHead>
                <TableHead className="text-center">نشط</TableHead>
                <TableHead className="text-center">الفترة</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell className="font-black text-brand">{coupon.code}</TableCell>
                  <TableCell className="text-center">{coupon.discount_type === "percentage" ? "نسبة" : "قيمة"}</TableCell>
                  <TableCell className="text-center font-black">{coupon.discount_type === "percentage" ? `${coupon.discount_value}%` : money(coupon.discount_value)}</TableCell>
                  <TableCell className="text-center font-black">{money(coupon.min_purchase)}</TableCell>
                  <TableCell className="text-center font-black">{coupon.used_count}/{coupon.max_uses || "∞"}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", coupon.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{coupon.is_active ? "نشط" : "متوقف"}</Badge></TableCell>
                  <TableCell className="text-center text-xs font-bold">
                    {coupon.valid_from ? new Date(coupon.valid_from).toLocaleDateString("ar-EG") : "—"} / {coupon.valid_until ? new Date(coupon.valid_until).toLocaleDateString("ar-EG") : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {canWrite ? <Button size="icon" variant="ghost" onClick={() => openEdit(coupon)} title="تعديل"><Percent className="size-4" /></Button> : null}
                      {canWrite ? <Button size="icon" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => void deleteCoupon(coupon)} title="حذف"><Trash2 className="size-4" /></Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>السابق</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>التالي</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function BundlesSection({ auth, settings, money, canWrite }: { auth: ReturnType<typeof useAuth>; settings: ReturnType<typeof useAppSettings>; money: (value: number) => string; canWrite: boolean }) {
  const [rows, setRows] = useState<BundleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query, page: String(page), page_size: "25" })
      const response = await fetch(`/api/sales/bundles?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as BundleResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الباقات")
      setRows(data.bundles ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الباقات")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId, page, query])

  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t) }, [load])

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="بحث باسم الباقة..." className="h-11 rounded-2xl pr-10 font-bold" />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
        {loading ? <SkeletonRows count={5} /> : rows.length === 0 ? (
          <EmptyState icon={Package} title="لا توجد باقات" description="لم يتم إنشاء أي باقة منتجات بعد." />
        ) : (
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-center">السعر</TableHead>
                <TableHead className="text-center">السعر الأصلي</TableHead>
                <TableHead className="text-center">الخصم</TableHead>
                <TableHead className="text-center">عدد الأصناف</TableHead>
                <TableHead className="text-center">نشط</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((bundle) => {
                const discount = bundle.total_original_price > 0
                  ? Math.round((1 - bundle.price / bundle.total_original_price) * 100)
                  : 0
                return (
                  <TableRow key={bundle.id}>
                    <TableCell className="font-black text-slate-950">{bundle.name}</TableCell>
                    <TableCell className="text-center font-black text-brand">{money(bundle.price)}</TableCell>
                    <TableCell className="text-center font-black text-slate-500 line-through">{money(bundle.total_original_price)}</TableCell>
                    <TableCell className="text-center font-black text-emerald-600">{discount}%</TableCell>
                    <TableCell className="text-center font-black">{bundle.items.length}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", bundle.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                        {bundle.is_active ? "نشط" : "متوقف"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}>السابق</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((v) => v + 1)}>التالي</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
