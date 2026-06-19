"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowRight, CalendarDays, Printer, Truck, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { LoadingState } from "@/components/shared/loading-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAppSettings } from "@/contexts/settings-context"
import { useAuth } from "@/contexts/auth-context"

type Purchase = {
  id: string
  purchase_number: string
  supplier_name: string
  status: string
  payment_status: string
  payment_method: string
  subtotal: number
  discount_total: number
  tax_total: number
  shipping_fee: number
  total: number
  paid_amount: number
  due_amount: number
  purchase_date: string
  notes?: string | null
  voided_at?: string | null
  branch?: { name: string } | null
}

type Line = {
  id: string
  item_name: string
  unit?: string | null
  batch_number?: string | null
  expiry_date?: string | null
  quantity: number
  buy_price: number
  sell_price: number
  discount: number
  net_total: number
}

export function PurchaseDetailView({ purchaseId }: { purchaseId: string }) {
  const settings = useAppSettings()
  const auth = useAuth()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [voiding, setVoiding] = useState(false)
  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  useEffect(() => {
    fetch(`/api/purchases/${purchaseId}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { purchase?: Purchase; lines?: Line[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل تحميل فاتورة الشراء")
        setPurchase(data.purchase ?? null)
        setLines(data.lines ?? [])
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "فشل تحميل فاتورة الشراء"))
      .finally(() => setLoading(false))
  }, [purchaseId])

  if (loading) return <LoadingState text="جاري تحميل فاتورة الشراء..." />
  if (!purchase) return <div dir="rtl" className="page-container py-10 text-center font-black text-slate-500">فاتورة الشراء غير موجودة.</div>

  async function voidPurchase() {
    if (!purchase) return
    const reason = window.prompt(`سبب إلغاء الفاتورة ${purchase.purchase_number}:`, "إلغاء فاتورة شراء مستلمة")
    if (reason === null) return
    setVoiding(true)
    try {
      const response = await fetch(`/api/purchases/${purchase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إلغاء فاتورة الشراء")
      toast.success("تم إلغاء الفاتورة وعكس المخزون وحساب المورد")
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إلغاء فاتورة الشراء")
    } finally {
      setVoiding(false)
    }
  }

  return (
    <PageAccess permission="purchases:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <div className="responsive-toolbar">
          <Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/purchases" />}><ArrowRight className="size-4" /> المشتريات</Button>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
            {(auth.isDeveloper || auth.can("purchases:void")) && !purchase.voided_at && purchase.status !== "void" ? (
              <Button variant="destructive" className="h-10 rounded-xl" disabled={voiding} onClick={() => void voidPurchase()}><XCircle className="size-4" /> إلغاء الفاتورة</Button>
            ) : null}
          </div>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]">
          <div className="flex gap-3"><span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Truck className="size-6" /></span><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black">{purchase.purchase_number}</h1><Badge variant="outline" className={purchase.voided_at || purchase.status === "void" ? "border-rose-200 bg-rose-50 font-black text-rose-700" : "border-emerald-200 bg-emerald-50 font-black text-emerald-700"}>{purchase.voided_at || purchase.status === "void" ? "ملغاة" : "مستلمة"}</Badge></div><p className="mt-2 text-sm font-bold text-slate-500">المورد: {purchase.supplier_name} — الفرع: {purchase.branch?.name ?? "—"}</p><p className="mt-1 text-xs font-bold text-slate-400">{new Date(purchase.purchase_date).toLocaleString("ar-EG")}</p></div></div>
          <div className="rounded-2xl bg-brand px-6 py-4 text-center text-white"><p className="text-xs font-black text-white/70">إجمالي الفاتورة</p><p className="mt-1 text-2xl font-black">{money(purchase.total)}</p></div>
        </CardContent></Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">بنود الفاتورة والتشغيلات</CardTitle></CardHeader>
          <Table className="min-w-[950px]"><TableHeader><TableRow>
            <TableHead className="text-right">الصنف</TableHead><TableHead className="text-center">التشغيلة / الصلاحية</TableHead><TableHead className="text-center">الكمية</TableHead><TableHead className="text-center">شراء</TableHead><TableHead className="text-center">بيع</TableHead><TableHead className="text-center">خصم</TableHead><TableHead className="text-center">الصافي</TableHead>
          </TableRow></TableHeader><TableBody>{lines.map((line) => <TableRow key={line.id}>
            <TableCell className="font-black">{line.item_name}</TableCell>
            <TableCell className="text-center">{line.batch_number || line.expiry_date ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700"><CalendarDays className="size-3" /> {line.batch_number ?? "بدون رقم"} — {line.expiry_date ? new Date(`${line.expiry_date}T00:00:00`).toLocaleDateString("ar-EG") : "بدون صلاحية"}</span> : "—"}</TableCell>
            <TableCell className="text-center font-black">{Number(line.quantity).toLocaleString("ar-EG")} {line.unit ?? ""}</TableCell><TableCell className="text-center">{money(line.buy_price)}</TableCell><TableCell className="text-center text-emerald-700">{money(line.sell_price)}</TableCell><TableCell className="text-center text-rose-600">{money(line.discount)}</TableCell><TableCell className="text-center font-black text-brand">{money(line.net_total)}</TableCell>
          </TableRow>)}</TableBody></Table>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
          {[
            ["قبل الخصم", purchase.subtotal], ["الخصم", purchase.discount_total], ["الضريبة", purchase.tax_total],
            ["الشحن", purchase.shipping_fee], ["الإجمالي", purchase.total], ["المدفوع", purchase.paid_amount], ["المتبقي", purchase.due_amount],
          ].map(([label, value]) => <Card key={String(label)} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">{label}</p><p className="mt-2 text-base font-black">{money(Number(value))}</p></CardContent></Card>)}
        </div>
        {purchase.notes ? <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4 text-sm font-bold text-slate-600">{purchase.notes}</CardContent></Card> : null}
      </section>
    </PageAccess>
  )
}
