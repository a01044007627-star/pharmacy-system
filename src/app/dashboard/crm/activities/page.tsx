"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type ActivityRow = {
  id: string
  type: string
  direction: string
  payment_method: string
  amount: number
  reference: string | null
  notes: string | null
  payment_date: string
  partner: { name: string; type: string } | null
}

type ActivitiesResponse = {
  activities?: ActivityRow[]
  pagination?: { totalPages: number }
  error?: string
}

function typeLabel(type: string) {
  switch (type) {
    case "sale": return "بيع"
    case "purchase": return "شراء"
    case "expense": return "مصروف"
    case "return": return "مرتجع"
    case "transfer": return "تحويل"
    default: return type
  }
}

function directionLabel(direction: string) {
  return direction === "in" ? "وارد" : "صادر"
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = { cash: "نقدي", card: "بطاقة", wallet: "محفظة", bank: "تحويل بنكي", cheque: "شيك" }
  return labels[method] ?? method
}

export default function ActivitiesPage() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, page: String(page), page_size: "25" })
      const response = await fetch(`/api/crm/activities?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as ActivitiesResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل النشاطات")
      setRows(data.activities ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل النشاطات")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, page])

  useEffect(() => { void load() }, [load])

  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="نشاطات جهات الاتصال"
          subtitle="سجل المعاملات المالية مع العملاء والموردين."
          icon={Activity}
          actions={(
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
          )}
        />

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Activity} title="لا توجد نشاطات" description="ستظهر معاملات العملاء والموردين هنا." />
          ) : (
            <Table className="min-w-[800px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">جهة الاتصال</TableHead>
                <TableHead className="text-center">النوع</TableHead>
                <TableHead className="text-center">الاتجاه</TableHead>
                <TableHead className="text-center">طريقة الدفع</TableHead>
                <TableHead className="text-center">المبلغ</TableHead>
                <TableHead className="text-center">المرجع</TableHead>
                <TableHead className="text-center">التاريخ</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-slate-950">{row.partner?.name ?? "—"}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-black">{typeLabel(row.type)}</Badge></TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={cn("font-black", row.direction === "in" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                      {directionLabel(row.direction)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center font-bold">{paymentMethodLabel(row.payment_method)}</TableCell>
                  <TableCell className="text-center font-black">{money(row.amount)}</TableCell>
                  <TableCell className="text-center text-xs font-bold" dir="ltr">{row.reference ?? "—"}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.payment_date).toLocaleString("ar-EG")}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
