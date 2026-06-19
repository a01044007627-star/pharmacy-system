"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Package, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type FreeReturnRow = {
  id: string
  title: string
  payload: { lines?: Array<{ item_name?: string; quantity?: number; price?: number }>; reason?: string; total?: number }
  status: string
  created_at: string
  branch?: { id: string; name: string } | null
}

type ReturnLine = {
  item_name: string
  quantity: number
  price: number
}

type ResponseData = {
  returns?: FreeReturnRow[]
  pagination?: { totalPages: number }
  error?: string
}

export function FreeReturnsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<FreeReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [itemName, setItemName] = useState("")
  const [itemQty, setItemQty] = useState("")
  const [itemPrice, setItemPrice] = useState("")

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId ?? "all",
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/sales/free-returns?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المرتجعات الحرة")
      setRows(data.returns ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المرتجعات الحرة")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, page])

  useEffect(() => { void load() }, [load])

  function addLine() {
    const name = itemName.trim()
    const qty = Number(itemQty)
    const price = Number(itemPrice)
    if (!name || qty <= 0 || price <= 0) {
      toast.error("تأكد من إدخال اسم الصنف والكمية والسعر بشكل صحيح")
      return
    }
    setLines((prev) => [...prev, { item_name: name, quantity: qty, price }])
    setItemName("")
    setItemQty("")
    setItemPrice("")
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)

  async function saveReturn() {
    if (lines.length === 0) {
      toast.error("أضف صنفًا واحدًا على الأقل")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/sales/free-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: auth.activePharmacyId,
          branch_id: auth.activeBranchId,
          title: `مرتجع حر - ${new Date().toLocaleDateString("ar-EG")}`,
          reason: reason.trim(),
          total,
          lines: lines.map((line) => ({
            item_name: line.item_name,
            quantity: line.quantity,
            price: line.price,
          })),
        }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تسجيل المرتجع الحر")
      toast.success("تم تسجيل المرتجع الحر")
      setLines([])
      setReason("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تسجيل المرتجع الحر")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="المرتجعات الحرة"
          subtitle="إرجاع أصناف بدون ربط بفاتورة بيع - صناديق تالفة أو منتهية الصلاحية."
icon={ArrowLeft}
          actions={(
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-black">تسجيل مرتجع حر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="اسم الصنف..." className="h-11 rounded-2xl font-bold" />
              <Input value={itemQty} onChange={(e) => setItemQty(e.target.value)} type="number" min="0" step="0.001" placeholder="الكمية..." className="h-11 rounded-2xl font-bold" />
              <Input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} type="number" min="0" step="0.01" placeholder="السعر..." className="h-11 rounded-2xl font-bold" />
              <Button className="h-11 rounded-2xl font-black" onClick={addLine}>
                <Package className="size-4" /> إضافة صنف
              </Button>
            </div>

            {lines.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table className="min-w-[550px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الصنف</TableHead>
                      <TableHead className="text-center">الكمية</TableHead>
                      <TableHead className="text-center">السعر</TableHead>
                      <TableHead className="text-center">الإجمالي</TableHead>
                      <TableHead className="text-center">حذف</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-bold">{line.item_name}</TableCell>
                        <TableCell className="text-center font-black">{Number(line.quantity).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="text-center">{money(line.price)}</TableCell>
                        <TableCell className="text-center font-black text-brand">{money(line.quantity * line.price)}</TableCell>
                        <TableCell className="text-center">
                          <Button size="icon" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => removeLine(index)}>✕</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإرجاع..." className="min-h-24 rounded-2xl" />
              <div className="space-y-3 rounded-2xl bg-slate-950 p-4 text-white">
                <div className="flex justify-between text-base font-black"><span>الإجمالي</span><strong>{money(total)}</strong></div>
                <Button className="h-11 w-full rounded-xl font-black" disabled={saving || lines.length === 0} onClick={() => void saveReturn()}>
                  {saving ? "جاري الحفظ..." : "تسجيل المرتجع الحر"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">سجل المرتجعات الحرة</CardTitle></CardHeader>
          {loading ? <SkeletonRows count={4} /> : rows.length === 0 ? (
            <EmptyState icon={ArrowLeft} title="لا توجد مرتجعات حرة" description="ستظهر هنا المرتجعات غير المرتبطة بفواتير البيع." />
          ) : (
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">عدد الأصناف</TableHead>
                  <TableHead className="text-center">الإجمالي</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const payloadLines = row.payload?.lines ?? []
                  const rowTotal = row.payload?.total ?? 0
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-black text-slate-950">{row.title}</TableCell>
                      <TableCell>{row.branch?.name ?? "—"}</TableCell>
                      <TableCell className="text-center font-black">{payloadLines.length}</TableCell>
                      <TableCell className="text-center font-black text-rose-600">{money(rowTotal)}</TableCell>
                      <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
