"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Package, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type BalanceRow = {
  item_id: string
  branch_id: string
  quantity: number
  item: { id: string; name_ar: string; sku: string | null; unit: string | null } | null
  branch: { id: string; name: string; code: string | null } | null
}

type ResponseData = {
  records?: BalanceRow[]
  summary?: { total_items: number; total_quantity: number; out_of_stock: number }
  error?: string
}

export function StockBalancesView() {
  const auth = useAuth()
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [summary, setSummary] = useState({ total_items: 0, total_quantity: 0, out_of_stock: 0 })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [branchId, setBranchId] = useState("all")

  const canChooseAllBranches = auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: branchId,
        limit: "500",
      })
      if (query) params.set("query", query)
      const response = await fetch(`/api/inventory/stock-balances?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الأرصدة")
      setRows(data.records ?? [])
      setSummary(data.summary ?? { total_items: 0, total_quantity: 0, out_of_stock: 0 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الأرصدة")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId, branchId, query])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 300)
    return () => window.clearTimeout(timeout)
  }, [load])

  const cards = useMemo(() => [
    { label: "عدد الأصناف", value: summary.total_items.toLocaleString("ar-EG"), tone: "text-slate-950" },
    { label: "إجمالي الكميات", value: summary.total_quantity.toLocaleString("ar-EG"), tone: "text-brand" },
    { label: "نفد المخزون", value: summary.out_of_stock.toLocaleString("ar-EG"), tone: "text-rose-600" },
    { label: "متوسط الكمية", value: summary.total_items > 0 ? Math.round(summary.total_quantity / summary.total_items).toLocaleString("ar-EG") : "0", tone: "text-blue-700" },
  ], [summary])

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="أرصدة المخزون"
          subtitle="عرض أرصدة الأصناف الحالية في فروع الصيدلية."
          icon={Package}
          actions={(
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم الصنف..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {canChooseAllBranches ? <NativeSelectOption value="all">كل الفروع</NativeSelectOption> : null}
              {auth.branches.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
            </NativeSelect>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label} className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-black text-slate-400">{card.label}</p>
                <p className={cn("mt-2 text-xl font-black", card.tone)}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Package} title="لا توجد أرصدة" description="لم يتم العثور على أرصدة للأصناف." />
          ) : (
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الصنف</TableHead>
                  <TableHead className="text-center">SKU</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">الكمية</TableHead>
                  <TableHead className="text-center">الوحدة</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={`${row.item_id}-${row.branch_id}-${i}`}>
                    <TableCell className="font-black">{row.item?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-center font-bold text-slate-500">{row.item?.sku ?? "—"}</TableCell>
                    <TableCell className="font-bold">{row.branch?.name ?? "—"}</TableCell>
                    <TableCell className={cn("text-center font-black", Number(row.quantity) <= 0 ? "text-rose-600" : "text-emerald-700")}>
                      {Number(row.quantity).toLocaleString("ar-EG")}
                    </TableCell>
                    <TableCell className="text-center text-slate-500">{row.item?.unit ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", Number(row.quantity) > 10 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : Number(row.quantity) > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                        {Number(row.quantity) > 10 ? "متوفر" : Number(row.quantity) > 0 ? "محدود" : "نفد"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
