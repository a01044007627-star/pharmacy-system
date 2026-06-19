"use client"

import { useCallback, useState } from "react"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type CloseoutResult = {
  entry?: { id: string; entry_number: string; total_debit: number; total_credit: number }
  summary?: { period: string; total_income: number; total_expenses: number; net_profit: number; lines_count: number }
  error?: string
}

export function CloseoutView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<CloseoutResult | null>(null)

  const canWrite = auth.can("financials:write") || auth.isDeveloper
  const money = useCallback((v: number) => `${Number(v || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  async function generateCloseout() {
    if (!period) { toast.error("اختر الفترة"); return }
    setProcessing(true)
    setResult(null)
    try {
      const res = await fetch("/api/accounts/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, period }),
      })
      const data = (await res.json().catch(() => ({}))) as CloseoutResult
      if (!res.ok) throw new Error(data.error ?? "فشل الإقفال")
      setResult(data)
      toast.success("تم إنشاء قيد الإقفال الحسابي")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الإقفال الحسابي")
    } finally { setProcessing(false) }
  }

  return (
    <PageAccess permission="financials:write">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="الإقفال الحسابي"
          subtitle="إقفال حسابات الإيرادات والمصروفات لفترة محاسبية."
          icon={Lock}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-black">إنشاء قيد إقفال</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-1.5 max-w-xs">
              <Label className="font-black">الفترة</Label>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-11 rounded-xl" />
            </div>
            <Button className="h-11 rounded-xl" disabled={processing || !period || !canWrite} onClick={() => void generateCloseout()}>
              {processing ? <Loader2 className="size-4 animate-spin" /> : null}
              {processing ? "جارٍ إنشاء القيد..." : "إنشاء قيد الإقفال"}
            </Button>
          </CardContent>
        </Card>

        {result?.summary ? (
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-lg font-black">ملخص الإقفال — {result.summary.period}</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                  <p className="text-xs font-black text-slate-400">إجمالي الإيرادات</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">{money(result.summary.total_income)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                  <p className="text-xs font-black text-slate-400">إجمالي المصروفات</p>
                  <p className="mt-2 text-2xl font-black text-rose-600">{money(result.summary.total_expenses)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                  <p className="text-xs font-black text-slate-400">صافي الربح / الخسارة</p>
                  <p className={cn("mt-2 text-2xl font-black", result.summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600")}>
                    {money(result.summary.net_profit)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                  <p className="text-xs font-black text-slate-400">عدد بنود القيد</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{result.summary.lines_count}</p>
                </div>
              </div>

              {result.entry ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-black text-slate-700">رقم قيد الإقفال: <span className="text-brand">{result.entry.entry_number}</span></p>
                  <p className="text-sm font-black text-slate-700 mt-1">إجمالي المدين: {money(result.entry.total_debit)}</p>
                  <p className="text-sm font-black text-slate-700">إجمالي الدائن: {money(result.entry.total_credit)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </PageAccess>
  )
}
