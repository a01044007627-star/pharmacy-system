"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowRight, CalendarDays, Printer, Receipt, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { LoadingState } from "@/components/shared/loading-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type SaleDetail = {
  id: string
  invoice_number: string
  customer_name: string
  status: string
  payment_status: string
  payment_method: string
  subtotal: number
  discount_total: number
  tax_total: number
  total: number
  paid_amount: number
  due_amount: number
  sale_date: string
  voided_at?: string | null
  branch?: { name: string; code?: string | null } | null
}

type SaleLine = {
  id: string
  item_name: string
  barcode?: string | null
  unit?: string | null
  quantity: number
  unit_price: number
  discount: number
  net_total: number
  batch?: { batch_number?: string | null; expiry_date?: string | null } | null
}

type DetailResponse = {
  sale?: SaleDetail
  lines?: SaleLine[]
  error?: string
}

export function SaleDetailView({ saleId }: { saleId: string }) {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [lines, setLines] = useState<SaleLine[]>([])
  const [loading, setLoading] = useState(true)
  const [voiding, setVoiding] = useState(false)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/sales/${saleId}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as DetailResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الفاتورة")
      setSale(data.sale ?? null)
      setLines(data.lines ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الفاتورة")
    } finally {
      setLoading(false)
    }
  }, [saleId])

  useEffect(() => { void load() }, [load])

  async function voidSale() {
    if (!sale) return
    const reason = window.prompt(`سبب إلغاء الفاتورة ${sale.invoice_number}:`, "إلغاء من تفاصيل الفاتورة")
    if (reason === null) return
    setVoiding(true)
    try {
      const response = await fetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إلغاء الفاتورة")
      toast.success("تم إلغاء الفاتورة وعكس آثارها")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إلغاء الفاتورة")
    } finally {
      setVoiding(false)
    }
  }

  if (loading) return <LoadingState text="جاري تحميل فاتورة البيع..." />
  if (!sale) return <div dir="rtl" className="page-container py-8 text-center font-black text-slate-500">الفاتورة غير موجودة.</div>

  const canVoid = (auth.isDeveloper || auth.can("sales:void")) && !sale.voided_at && sale.status !== "void"

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <div className="responsive-toolbar">
          <Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/sales" />}>
            <ArrowRight className="size-4" /> رجوع للمبيعات
          </Button>
          <div className="responsive-actions">
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => window.print()}>
              <Printer className="size-4" /> طباعة
            </Button>
            {canVoid ? (
              <Button variant="destructive" className="h-10 rounded-xl" onClick={() => void voidSale()} disabled={voiding}>
                <XCircle className="size-4" /> إلغاء الفاتورة
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_auto]">
            <div className="flex items-start gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Receipt className="size-6" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black text-slate-950">{sale.invoice_number}</h1>
                  <Badge variant="outline" className={cn("font-black", sale.voided_at || sale.status === "void" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                    {sale.voided_at || sale.status === "void" ? "ملغاة" : "فاتورة بيع"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-bold text-slate-500">العميل: {sale.customer_name} — الفرع: {sale.branch?.name ?? "—"}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">{new Date(sale.sale_date).toLocaleString("ar-EG")}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-brand px-6 py-4 text-center text-white">
              <p className="text-xs font-black text-white/70">إجمالي الفاتورة</p>
              <p className="mt-1 text-2xl font-black">{money(sale.total)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-black">بنود الفاتورة</CardTitle>
          </CardHeader>
          <Table className="min-w-[850px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الصنف</TableHead>
                <TableHead className="text-center">التشغيلة / الصلاحية</TableHead>
                <TableHead className="text-center">الكمية</TableHead>
                <TableHead className="text-center">السعر</TableHead>
                <TableHead className="text-center">الخصم</TableHead>
                <TableHead className="text-center">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="font-black text-slate-950">{line.item_name}</div>
                    <div className="text-xs font-bold text-slate-400" dir="ltr">{line.barcode ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    {line.batch ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
                        <CalendarDays className="size-3" />
                        {line.batch.batch_number ?? "بدون رقم"} — {line.batch.expiry_date ? new Date(`${line.batch.expiry_date}T00:00:00`).toLocaleDateString("ar-EG") : "بدون تاريخ"}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-center font-black">{Number(line.quantity).toLocaleString("ar-EG")} {line.unit ?? ""}</TableCell>
                  <TableCell className="text-center">{money(line.unit_price)}</TableCell>
                  <TableCell className="text-center text-rose-600">{money(line.discount)}</TableCell>
                  <TableCell className="text-center font-black text-brand">{money(line.net_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["قبل الخصم", sale.subtotal],
            ["الخصم", sale.discount_total],
            ["الضريبة", sale.tax_total],
            ["المدفوع", sale.paid_amount],
            ["المتبقي", sale.due_amount],
          ].map(([label, value]) => (
            <Card key={String(label)} className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-black text-slate-400">{label}</p>
                <p className="mt-2 text-lg font-black text-slate-950">{money(Number(value))}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </PageAccess>
  )
}
