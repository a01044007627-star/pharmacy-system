"use client"

import { useCallback, useEffect, useState } from "react"
import { FileText, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
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

type DraftRow = {
  id: string
  title: string
  status: string
  created_by: string
  created_at: string
  updated_at: string
  branch?: { id: string; name: string } | null
}

type ResponseData = {
  drafts?: DraftRow[]
  pagination?: { totalPages: number }
  error?: string
}

function statusLabel(value: string) {
  if (value === "draft") return "مسودة"
  if (value === "completed") return "مكتملة"
  if (value === "cancelled") return "ملغاة"
  return value
}

function statusColor(value: string) {
  if (value === "draft") return "border-amber-200 bg-amber-50 text-amber-700"
  if (value === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (value === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

export function SalesDraftsView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const money = useCallback((value: number) => `${Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
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
      const response = await fetch(`/api/sales/drafts?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as ResponseData
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المسودات")
      setRows(data.drafts ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المسودات")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, page, query, statusFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  async function deleteDraft(draft: DraftRow) {
    if (!window.confirm(`حذف المسودة "${draft.title}"؟`)) return
    try {
      const params = new URLSearchParams({ id: draft.id, pharmacy_id: auth.activePharmacyId! })
      const response = await fetch(`/api/sales/drafts?${params.toString()}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حذف المسودة")
      toast.success("تم حذف المسودة")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف المسودة")
    }
  }

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="مسودات المبيعات"
          subtitle="مسودات فواتير البيع غير المكتملة - إدارة وحذف واستكمال."
          icon={FileText}
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
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="بحث بالعنوان..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <NativeSelect value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="draft">مسودة</NativeSelectOption>
              <NativeSelectOption value="completed">مكتملة</NativeSelectOption>
              <NativeSelectOption value="cancelled">ملغاة</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={5} /> : rows.length === 0 ? (
            <EmptyState icon={FileText} title="لا توجد مسودات" description="لم يتم إنشاء أي مسودة مبيعات بعد." />
          ) : (
            <Table className="min-w-[750px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right">الفرع</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">آخر تعديل</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((draft) => (
                  <TableRow key={draft.id}>
                    <TableCell className="font-black text-slate-950">{draft.title}</TableCell>
                    <TableCell>{draft.branch?.name ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("font-black", statusColor(draft.status))}>{statusLabel(draft.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(draft.updated_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        {(auth.isDeveloper || auth.can("sales:write")) ? (
                          <Button size="icon" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => void deleteDraft(draft)} title="حذف">
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
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
