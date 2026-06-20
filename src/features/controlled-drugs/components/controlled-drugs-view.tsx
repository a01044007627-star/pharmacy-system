"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Pill, Search, X } from "lucide-react"
import { PageAccess } from "@/components/auth/page-access"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"

const ACTION_LABELS: Record<string, string> = {
  received: "استلام",
  dispensed: "صرف",
  destroyed: "إتلاف",
  transfer: "تحويل",
  adjustment: "تسوية",
}

const ACTION_COLORS: Record<string, string> = {
  received: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dispensed: "bg-amber-100 text-amber-700 border-amber-200",
  destroyed: "bg-red-100 text-red-700 border-red-200",
  transfer: "bg-blue-100 text-blue-700 border-blue-200",
  adjustment: "bg-purple-100 text-purple-700 border-purple-200",
}

export function ControlledDrugsView() {
  const auth = useAuth()
  const pharmacyId = auth.activePharmacyId
  const branchId = auth.activeBranchId

  const [entries, setEntries] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [actionFilter, setActionFilter] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [searchText, setSearchText] = useState("")

  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const LIMIT = 50

  const fetchEntries = useCallback(async (resetOffset = true) => {
    if (!pharmacyId) return
    const currentOffset = resetOffset ? 0 : offset
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pharmacy_id: pharmacyId, limit: String(LIMIT), offset: String(currentOffset) })
      if (branchId) params.set("branch_id", branchId)
      if (actionFilter) params.set("action", actionFilter)
      if (fromDate) params.set("from", fromDate)
      if (toDate) params.set("to", toDate)
      if (searchText.trim()) params.set("search", searchText.trim())

      const response = await fetch(`/api/controlled-drugs?${params.toString()}`, { cache: "no-store" })
      if (!response.ok) throw new Error("فشل تحميل السجل")
      const data = await response.json()
      if (resetOffset) {
        setEntries(data.entries ?? [])
        setOffset(0)
      } else {
        setEntries((prev) => [...prev, ...(data.entries ?? [])])
      }
      setTotal(data.total ?? 0)
      setHasMore(Boolean(data.hasMore))
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ في تحميل السجل")
    } finally {
      setLoading(false)
    }
  }, [pharmacyId, branchId, actionFilter, fromDate, toDate, searchText, offset])

  useEffect(() => {
    setOffset(0)
    fetchEntries(true)
  }, [pharmacyId, branchId, actionFilter, fromDate, toDate, searchText])

  function loadMore() {
    setOffset((prev) => prev + LIMIT)
  }

  useEffect(() => {
    if (offset > 0) fetchEntries(false)
  }, [offset])

  if (!pharmacyId) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Alert>
          <AlertCircle className="size-5" />
          <AlertTitle>اختر صيدلية أولًا</AlertTitle>
          <AlertDescription>يجب اختيار صيدلية لعرض سجل الأدوية المراقبة.</AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-6 py-6 text-right">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">سجل الأدوية المراقبة</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">جدول الأدوية المخدرة والمراقبة — صادر ووارد</p>
          </div>
          <Badge variant="outline" className="rounded-full px-4 py-1.5 text-sm font-black">
            إجمالي {total} حركة
          </Badge>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-black text-slate-500">نوع الحركة</Label>
                <Select value={actionFilter} onValueChange={(v) => setActionFilter(v === "all" ? "" : v ?? "")}>
                  <SelectTrigger className="h-9 w-36 rounded-xl border-slate-200 text-xs font-bold">
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="received">استلام</SelectItem>
                    <SelectItem value="dispensed">صرف</SelectItem>
                    <SelectItem value="destroyed">إتلاف</SelectItem>
                    <SelectItem value="transfer">تحويل</SelectItem>
                    <SelectItem value="adjustment">تسوية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-black text-slate-500">من تاريخ</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-40 rounded-xl border-slate-200 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-black text-slate-500">إلى تاريخ</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-40 rounded-xl border-slate-200 text-xs" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-xs font-black text-slate-500">بحث</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="مريض، دكتور، روشتة..."
                    className="h-9 rounded-xl border-slate-200 pr-9 text-xs"
                  />
                  {searchText && (
                    <button onClick={() => setSearchText("")} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-5" />
            <AlertTitle>خطأ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="p-0">
            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <div className="size-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
              </div>
            ) : entries.length === 0 ? (
              <div className="py-16">
                <EmptyState
                  icon={Pill}
                  title="لا توجد حركات"
                  description="لم يتم تسجيل أي حركة على الأدوية المراقبة بعد."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-2 border-slate-100">
                      <TableHead className="text-xs font-black text-slate-500">التاريخ</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">الصنف</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">الحركة</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">الكمية</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">المريض</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">الدكتور</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">رقم الروشتة</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">الفرع</TableHead>
                      <TableHead className="text-xs font-black text-slate-500">ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <TableCell className="whitespace-nowrap text-xs font-bold text-slate-700">
                          {new Date(entry.created_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-bold text-slate-900">{entry.pharmacy_items?.name_ar ?? "—"}</div>
                          {entry.pharmacy_items?.sku && <div className="text-xs text-slate-400">{entry.pharmacy_items.sku}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("rounded-full border text-xs font-black", ACTION_COLORS[entry.action] ?? "bg-slate-100 text-slate-700")}>
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-black text-slate-900">{entry.quantity}</TableCell>
                        <TableCell className="text-xs font-bold text-slate-700">{entry.patient_name ?? "—"}</TableCell>
                        <TableCell className="text-xs font-bold text-slate-700">{entry.doctor_name ?? "—"}</TableCell>
                        <TableCell className="text-xs font-bold text-slate-700">{entry.prescription_number ?? "—"}</TableCell>
                        <TableCell className="text-xs font-bold text-slate-700">{entry.pharmacy_branches?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-slate-500" title={entry.notes ?? ""}>{entry.notes ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={loadMore} disabled={loading} className="rounded-xl font-black">
              {loading ? "جاري التحميل..." : "عرض المزيد"}
            </Button>
          </div>
        )}
      </section>
    </PageAccess>
  )
}
