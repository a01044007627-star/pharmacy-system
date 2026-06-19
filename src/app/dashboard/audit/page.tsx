"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type AuditEvent = {
  id: string
  event_type: string
  severity: "info" | "warning" | "error" | "critical"
  source: string
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

const severityLabel = { info: "معلومة", warning: "تحذير", error: "خطأ", critical: "حرج" }
const sourceLabel: Record<string, string> = { all: "كل المصادر", sales: "المبيعات", purchases: "المشتريات", inventory: "المخزون", partners: "العملاء والموردون", settings: "الإعدادات" }
const severityClass = {
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  critical: "border-red-200 bg-red-50 text-red-800",
}

export default function AuditEventsPage() {
  const auth = useAuth()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("all")
  const [severity, setSeverity] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId ?? "all",
        page: String(page),
        page_size: "30",
        query,
        source,
        severity,
      })
      const response = await fetch(`/api/audit-events?${params}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as {
        events?: AuditEvent[]
        pagination?: { totalPages: number }
        error?: string
      }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل سجل المراجعة")
      setEvents(data.events ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل سجل المراجعة")
    } finally {
      setLoading(false)
    }
  }, [auth.activeBranchId, auth.activePharmacyId, page, query, severity, source])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  return (
    <PageAccess permission="auth:audit.read" message="ليست لديك صلاحية عرض سجل المراجعة">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="سجل المراجعة"
          subtitle="متابعة العمليات الحساسة في المبيعات والمشتريات والمخزون والإعدادات."
          icon={ShieldCheck}
          actions={
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          }
        />
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="ابحث في العملية أو الوصف..." className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <Select value={source} onValueChange={(value) => { setSource(value ?? "all"); setPage(1) }}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue>{sourceLabel[source] ?? "كل المصادر"}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المصادر</SelectItem>
                <SelectItem value="sales">المبيعات</SelectItem>
                <SelectItem value="purchases">المشتريات</SelectItem>
                <SelectItem value="inventory">المخزون</SelectItem>
                <SelectItem value="partners">العملاء والموردون</SelectItem>
                <SelectItem value="settings">الإعدادات</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(value) => { setSeverity(value ?? "all"); setPage(1) }}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue>{severity === "all" ? "كل المستويات" : severityLabel[severity as keyof typeof severityLabel]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستويات</SelectItem>
                <SelectItem value="info">معلومة</SelectItem>
                <SelectItem value="warning">تحذير</SelectItem>
                <SelectItem value="error">خطأ</SelectItem>
                <SelectItem value="critical">حرج</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={7} /> : events.length === 0 ? (
            <EmptyState icon={Activity} title="لا توجد أحداث" description="ستظهر العمليات الحساسة هنا تلقائيًا." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-center">المصدر</TableHead>
                <TableHead className="text-center">المستوى</TableHead>
                <TableHead className="text-right">العملية</TableHead>
                <TableHead className="text-right">الوصف</TableHead>
                <TableHead className="text-right">التفاصيل</TableHead>
              </TableRow></TableHeader>
              <TableBody>{events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs font-bold">{new Date(event.created_at).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline">{event.source}</Badge></TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className={severityClass[event.severity]}>{severityLabel[event.severity]}</Badge></TableCell>
                  <TableCell className="font-black">{event.event_type}</TableCell>
                  <TableCell className="font-bold text-slate-600">{event.description || "—"}</TableCell>
                  <TableCell><pre className="max-h-24 max-w-80 overflow-auto rounded-xl bg-slate-50 p-2 text-[11px]">{JSON.stringify(event.metadata ?? {}, null, 1)}</pre></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
