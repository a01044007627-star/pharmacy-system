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

type OrderRow = {
  id: string
  order_number: string
  customer_name: string
  status: string
  total: number
  shipping_fee: number
  created_at: string
  branch?: { id: string; name: string } | null
}

type StatusOption = { value: string; label: string }

type ResponseData = {
  orders?: OrderRow[]
  statuses?: StatusOption[]
  pagination?: { totalPages: number }
  error?: string
}

function statusBadgeColor(value: string) {
  const colors: Record<string, string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    confirmed: "border-blue-200 bg-blue-50 text-blue-700",
    preparing: "border-purple-200 bg-purple-50 text-purple-700",
    shipped: "border-indigo-200 bg-indigo-50 text-indigo-700",
    delivered: "border-emerald-200 bg-emerald-50 text-emerald-700",
    cancelled: "border-rose-200 bg-rose-50 text-rose-700",
    returned: "border-slate-200 bg-slate-50 text-slate-700",
  }
  return colors[value] ?? "border-slate-200 bg-slate-50 text-slate-700"
}

export function ShippingView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<OrderRow[]>([])
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) {
      setRows([])
      setLoading(auth.loading)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId ?? "all",
        query,
        status: statusFilter,
        page: String(page),
        page_size: "25",
      })
      const response = await fetch(`/api/sales/shipping?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل طلبات الشحن")
      setRows(data.orders ?? [])
      setStatusOptions(data.statuses ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل طلبات الشحن")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, auth.loading, page, query, statusFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  async function updateStatus(order: OrderRow, newStatus: string) {
    if (order.status === newStatus) return
    try {
      const response = await fetch("/api/sales/shipping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, status: newStatus, pharmacy_id: auth.activePharmacyId }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحديث حالة الطلب")
      toast.success("تم تحديث حالة الطلب")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث حالة الطلب")
    }
  }

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="إدارة الشحن"
          subtitle="متابعة طلبات التوصيل والشحن - تحديث الحالات."
          icon={Truck}
          actions={(
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="رقم الطلب أو اسم العميل..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              {statusOptions.map((opt) => (
                <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={Truck} title="لا توجد طلبات شحن" description="لم يتم إنشاء أي طلب شحن بعد." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم الطلب</TableHead>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">الإجمالي</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">التاريخ</TableHead>
                  <TableHead className="text-center">تحديث الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-black text-brand">{order.order_number}</TableCell>
                    <TableCell className="font-bold">{order.customer_name}</TableCell>
                    <TableCell>{order.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center font-black">{money(order.total)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", statusBadgeColor(order.status))}>
                        {statusOptions.find((s) => s.value === order.status)?.label ?? order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(order.created_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        {(auth.isDeveloper || auth.can("sales:write")) ? (
                          <NativeSelect
                            value={order.status}
                            onChange={(event) => void updateStatus(order, event.target.value)}
                            className="w-36"
                            selectClassName="h-8 text-xs rounded-xl"
                          >
                            {statusOptions.map((opt) => (
                              <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                            ))}
                          </NativeSelect>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">—</span>
                        )}
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
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
