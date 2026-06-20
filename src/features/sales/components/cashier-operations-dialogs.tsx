"use client"

import { useEffect, useMemo, useState } from "react"
import {
  type LucideIcon,
  AlertTriangle,
  Calculator,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  ListChecks,
  Percent,
  Receipt,
  RefreshCw,
  Save,
  Search,
  ShoppingCart,
  Wallet,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { money } from "@/lib/formatters"
import type { CashierShiftSnapshot } from "@/features/sales/types/cashier-session"

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours <= 0) return `${rest} دقيقة`
  return `${hours} س ${rest} د`
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" | "warning" }) {
  return (
    <div className={cn(
      "rounded-2xl border p-3",
      tone === "success" && "border-emerald-200 bg-emerald-50",
      tone === "danger" && "border-rose-200 bg-rose-50",
      tone === "warning" && "border-amber-200 bg-amber-50",
      tone === "default" && "border-slate-200 bg-slate-50",
    )}>
      <div className="text-[11px] font-black text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black tabular-nums text-slate-950">{value}</div>
    </div>
  )
}

export function CashierSessionDialog({
  open,
  onOpenChange,
  snapshot,
  currency,
  loading,
  onRefresh,
  onOpenSale,
  title = "الجلسة الحالية",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: CashierShiftSnapshot | null
  currency: string
  loading?: boolean
  onRefresh?: () => void
  onOpenSale?: (saleId: string) => void
  title?: string
}) {
  const metrics = snapshot?.metrics
  useEffect(() => {
    if (!open || !onRefresh || snapshot?.shift.status === "closed") return
    const timer = window.setInterval(onRefresh, 15_000)
    return () => window.clearInterval(timer)
  }, [onRefresh, open, snapshot?.shift.status])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="z-[140] max-w-3xl rounded-3xl p-0 text-right">
        <DialogHeader className="border-b border-slate-200 p-5 text-right">
          <div className="flex items-center justify-between gap-3 pl-10">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl font-black">
                <ListChecks className="size-5 text-brand" /> {title}
              </DialogTitle>
              <DialogDescription className="mt-1 font-bold">
                {snapshot?.shift.status === "closed"
                  ? "ملخص التقفيل النهائي والفواتير والحركة المسجلة داخل الجلسة."
                  : "عرض حي بدون إغلاق الوردية — الأرقام تُقرأ من الفواتير والدرج الحالي."}
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          </div>
        </DialogHeader>

        <div className="max-h-[72dvh] space-y-4 overflow-y-auto p-5 pharmacy-scrollbar">
          {!snapshot || !metrics ? (
            <div className="grid min-h-52 place-items-center text-sm font-black text-slate-400">
              {loading ? "جارٍ تحميل تفاصيل الجلسة..." : "لا توجد بيانات جلسة متاحة"}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={snapshot.shift.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}>
                  {snapshot.shift.status === "open" ? "جلسة مفتوحة" : "جلسة مغلقة"}
                </Badge>
                <Badge variant="outline"><Clock className="ml-1 size-3" /> {durationLabel(metrics.durationMinutes)}</Badge>
                <Badge variant="outline">{metrics.invoiceCount.toLocaleString("ar-EG")} فاتورة</Badge>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="صافي المبيعات" value={money(metrics.netSales, currency)} tone="success" />
                <Stat label="إجمالي الخصومات" value={money(metrics.discountTotal, currency)} tone={metrics.discountTotal > 0 ? "warning" : "default"} />
                <Stat label="المدفوع" value={money(metrics.paidTotal, currency)} />
                <Stat label="الآجل / المتبقي" value={money(metrics.dueTotal, currency)} tone={metrics.dueTotal > 0 ? "warning" : "default"} />
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label="رصيد بداية الوردية" value={money(metrics.openingBalance, currency)} />
                <Stat label="المصروفات" value={money(metrics.expensesTotal, currency)} tone={metrics.expensesTotal > 0 ? "warning" : "default"} />
                <Stat label="المتوقع في الدرج" value={money(metrics.expectedDrawer, currency)} tone="success" />
                {metrics.actualDrawer != null ? <Stat label="الفعلي عند الإغلاق" value={money(metrics.actualDrawer, currency)} /> : null}
                {metrics.drawerDifference != null ? (
                  <Stat
                    label="فرق الدرج"
                    value={money(metrics.drawerDifference, currency)}
                    tone={Math.abs(metrics.drawerDifference) < 0.01 ? "success" : "danger"}
                  />
                ) : null}
              </div>

              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-950"><Wallet className="size-4 text-brand" /> توزيع التحصيل</h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Stat label="نقدي" value={money(metrics.cashCollected, currency)} />
                  <Stat label="بطاقة" value={money(metrics.cardCollected, currency)} />
                  <Stat label="محفظة" value={money(metrics.walletCollected, currency)} />
                  <Stat label="تحويل" value={money(metrics.transferCollected, currency)} />
                  <Stat label="دفع متعدد" value={money(metrics.mixedCollected, currency)} />
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-950"><Receipt className="size-4 text-brand" /> آخر فواتير الجلسة</h4>
                <div className="space-y-2">
                  {snapshot.recentSales.map((sale) => (
                    <button
                      key={sale.id}
                      type="button"
                      onClick={() => onOpenSale?.(sale.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-right transition hover:border-brand/30 hover:bg-brand/[0.03]"
                    >
                      <Receipt className="size-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-slate-950">{sale.invoice_number} — {sale.customer_name}</span>
                        <span className="block text-[11px] font-bold text-slate-400">{new Date(sale.sale_date).toLocaleString("ar-EG")}</span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-brand">{money(sale.total, currency)}</span>
                      <ExternalLink className="size-4 shrink-0 text-slate-400" />
                    </button>
                  ))}
                  {snapshot.recentSales.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">لا توجد فواتير داخل الجلسة حتى الآن.</p> : null}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CashierCloseDialog({
  open,
  onOpenChange,
  expected,
  currency,
  loading,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expected: number
  currency: string
  loading?: boolean
  onConfirm: (actual: number, notes: string) => void
}) {
  const [actualText, setActualText] = useState(String(expected.toFixed(2)))
  const [notes, setNotes] = useState("")
  useEffect(() => {
    if (open) {
      setActualText(String(expected.toFixed(2)))
      setNotes("")
    }
  }, [expected, open])
  const actual = Number(actualText)
  const safeActual = Number.isFinite(actual) ? Math.max(0, actual) : 0
  const difference = safeActual - expected

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="z-[140] max-w-lg rounded-3xl text-right">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><Wallet className="size-5 text-brand" /> تقفيل جلسة الكاشير</DialogTitle>
          <DialogDescription className="font-bold">راجع الرصيد المتوقع، ثم أدخل النقدية الفعلية. سيظهر فرق الدرج قبل التأكيد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="المتوقع في الدرج" value={money(expected, currency)} />
          <Stat label="فرق الدرج" value={money(difference, currency)} tone={Math.abs(difference) < 0.01 ? "success" : "danger"} />
        </div>
        <label className="space-y-1.5">
          <Label className="font-black">النقدية الفعلية</Label>
          <Input dir="ltr" inputMode="decimal" value={actualText} onChange={(event) => setActualText(event.target.value)} className="h-12 rounded-2xl text-center text-lg font-black" autoFocus />
        </label>
        <label className="space-y-1.5">
          <Label className="font-black">ملاحظات التقفيل</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-11 rounded-2xl" placeholder="اختياري — سبب العجز أو الزيادة" />
        </label>
        {Math.abs(difference) >= 0.01 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> يوجد فرق درج بقيمة {money(difference, currency)} وسيتم تسجيله في تفاصيل الوردية.
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={loading}>رجوع</Button>
          <Button className="rounded-xl" onClick={() => onConfirm(safeActual, notes)} disabled={loading || !Number.isFinite(actual)}>
            {loading ? <RefreshCw className="size-4 animate-spin" /> : <Wallet className="size-4" />} تأكيد التقفيل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SHORTCUTS: Array<[string, string, LucideIcon]> = [
  ["F2", "التركيز على بحث الصنف", Search],
  ["F3", "فتح الآلة الحاسبة", Calculator],
  ["F4", "إظهار أو إخفاء قائمة الأصناف", ShoppingCart],
  ["F6", "عرض الجلسة الحالية حيًا", ListChecks],
  ["F7", "فتح خصم الفاتورة", Percent],
  ["F8", "العمليات الأخيرة", Receipt],
  ["F9", "حفظ مسودة", Save],
  ["F10", "فتح لوحة النظام دون إغلاق الجلسة", ExternalLink],
  ["F12", "حفظ سريع نقدي", Wallet],
  ["Alt + 2", "حفظ ببطاقة", CreditCard],
  ["Alt + 3", "حفظ آجل", Receipt],
  ["Alt + 4", "دفع متعدد", Wallet],
]

export function CashierShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="z-[140] max-w-xl rounded-3xl text-right">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><FileText className="size-5 text-brand" /> اختصارات الكاشير</DialogTitle>
          <DialogDescription className="font-bold">اختصارات ثابتة لتقليل استخدام الماوس وتسريع البيع.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {SHORTCUTS.map(([key, label, Icon]) => (
            <div key={String(key)} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <Icon className="size-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-sm font-bold text-slate-700">{String(label)}</span>
              <kbd className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-950 shadow-sm">{String(key)}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InvoiceDiscountDialog({
  open,
  onOpenChange,
  subtotal,
  currentDiscount,
  maxPercent,
  currency,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subtotal: number
  currentDiscount: number
  maxPercent: number
  currency: string
  onApply: (value: number) => void
}) {
  const [valueText, setValueText] = useState(String(currentDiscount))
  useEffect(() => { if (open) setValueText(String(currentDiscount)) }, [currentDiscount, open])
  const maxValue = subtotal * (maxPercent / 100)
  const value = useMemo(() => Math.min(maxValue, Math.max(0, Number(valueText) || 0)), [maxValue, valueText])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="z-[140] max-w-md rounded-3xl text-right">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><Percent className="size-5 text-brand" /> خصم الفاتورة</DialogTitle>
          <DialogDescription className="font-bold">متاح للمالك أو المدير أو الصيدلي أو من لديه صلاحية الخصم.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 15, 20].map((percent) => (
            <Button key={percent} variant="outline" className="rounded-xl" onClick={() => setValueText(String(Math.min(maxValue, subtotal * percent / 100).toFixed(2)))}>{percent}%</Button>
          ))}
        </div>
        <label className="space-y-1.5">
          <Label className="font-black">قيمة الخصم</Label>
          <Input dir="ltr" inputMode="decimal" value={valueText} onChange={(event) => setValueText(event.target.value)} className="h-12 rounded-2xl text-center text-lg font-black" autoFocus />
        </label>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-600">
          الحد الأقصى المسموح: <span className="font-black text-slate-950">{money(maxValue, currency)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="rounded-xl" onClick={() => { onApply(value); onOpenChange(false) }}><Percent className="size-4" /> تطبيق الخصم</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
