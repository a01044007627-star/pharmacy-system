"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Search, Truck } from "lucide-react"
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
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type DeliveryOrder = {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string | null
  shipping_address: string | null
  shipping_status: string | null
  total: number
  created_at: string
}

export default function DeliveryPage() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, query, shipping_status: statusFilter })
      const response = await fetch(`/api/sales?${params.toString()}&shipping=1&page_size=100`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { sales?: DeliveryOrder[] }
      if (!response.ok) throw new Error("فشل تحميل طلبات التوصيل")
      setRows(data.sales?.filter((s) => s.shipping_address) ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل طلبات التوصيل")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId, query, statusFilter])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(t)
  }, [load])

  return (
    <PageAccess permission="delivery:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="التوصيل" subtitle="متابعة طلبات التوصيل والشحن." icon={Truck} actions={
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="رقم الطلب أو اسم العميل..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="pending">قيد الانتظار</NativeSelectOption>
              <NativeSelectOption value="in_transit">قيد التوصيل</NativeSelectOption>
              <NativeSelectOption value="delivered">تم التوصيل</NativeSelectOption>
              <NativeSelectOption value="cancelled">ملغي</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Truck} title="لا توجد طلبات توصيل" description="طلبات التوصيل ستظهر هنا." />
          ) : (
            <Table className="min-w-[1000px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">رقم الطلب</TableHead><TableHead className="text-right">العميل</TableHead><TableHead className="text-right">الهاتف</TableHead>
                <TableHead className="text-right">العنوان</TableHead><TableHead className="text-center">الإجمالي</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">التاريخ</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-black text-brand">{row.order_number}</TableCell>
                  <TableCell className="font-bold">{row.customer_name}</TableCell>
                  <TableCell dir="ltr" className="text-left font-bold">{row.customer_phone ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs font-bold">{row.shipping_address ?? "—"}</TableCell>
                  <TableCell className="text-center font-black">{Number(row.total || 0).toLocaleString("ar-EG")} {currency}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={cn("font-black", row.shipping_status === "delivered" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : row.shipping_status === "in_transit" ? "border-blue-200 bg-blue-50 text-blue-700" : row.shipping_status === "cancelled" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                      {row.shipping_status === "delivered" ? "تم التوصيل" : row.shipping_status === "in_transit" ? "قيد التوصيل" : row.shipping_status === "cancelled" ? "ملغي" : "قيد الانتظار"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleDateString("ar-EG")}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
