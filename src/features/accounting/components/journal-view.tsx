"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, Eye, EyeOff, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { cn } from "@/lib/utils"

type JournalLine = {
  id: string; entry_id: string; account_id: string; debit: number; credit: number; description: string | null
  account?: { id: string; code: string; name: string; type: string } | null
}

type JournalEntry = {
  id: string; entry_number: string; entry_date: string; description: string | null
  total_debit: number; total_credit: number; created_at: string
  lines?: JournalLine[]
}

type ResponseData = {
  entries?: JournalEntry[]
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: string
}

export function JournalView() {
  const auth = useAuth()
  const settings = useAppSettings()
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [rows, setRows] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const money = useCallback((v: number) => `${Number(v || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`, [currency])

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        pharmacy_id: auth.activePharmacyId,
        page: String(page),
        page_size: "25",
        expand_lines: expandedId ? "true" : "false",
      })
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const res = await fetch(`/api/accounts/journal?${params.toString()}`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as ResponseData
      if (!res.ok) throw new Error(data.error ?? "فشل التحميل")
      setRows(data.entries ?? [])
      setTotalPages(data.pagination?.totalPages ?? 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل قيود اليومية")
    } finally { setLoading(false) }
  }, [auth.activePharmacyId, dateFrom, dateTo, expandedId, page])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timeout)
  }, [load])

  function toggleExpand(entryId: string) {
    setExpandedId((prev) => prev === entryId ? null : entryId)
  }

  return (
    <PageAccess permission="financials:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="دفتر الأستاذ"
          subtitle="سجل قيود اليومية المحاسبية مع إمكانية عرض التفاصيل."
          icon={BookOpen}
          actions={(
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
          )}
        />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="grid min-w-0 gap-3 p-4 md:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} type="date" className="h-11 rounded-2xl pr-10 font-bold" />
            </div>
            <Input value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} type="date" placeholder="إلى تاريخ" className="h-11 rounded-2xl font-bold" />
            <Button variant="outline" className="h-11 rounded-2xl" onClick={() => { setDateFrom(""); setDateTo(""); setPage(1) }}>مسح الفلتر</Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : rows.length === 0 ? (
            <EmptyState icon={BookOpen} title="لا توجد قيود يومية" description="لم يتم تسجيل أي قيد بعد." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center w-10"></TableHead>
                    <TableHead className="text-right">رقم القيد</TableHead>
                    <TableHead className="text-right">البيان</TableHead>
                    <TableHead className="text-center">المدين</TableHead>
                    <TableHead className="text-center">الدائن</TableHead>
                    <TableHead className="text-center">التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => (
                    <>
                      <TableRow key={entry.id} className="cursor-pointer" onClick={() => toggleExpand(entry.id)}>
                        <TableCell className="text-center">
                          <Button size="icon" variant="ghost" className="size-7">
                            {expandedId === entry.id ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-black text-brand">{entry.entry_number}</TableCell>
                        <TableCell className="font-bold text-sm">{entry.description ?? "—"}</TableCell>
                        <TableCell className="text-center font-black">{money(entry.total_debit)}</TableCell>
                        <TableCell className="text-center font-black">{money(entry.total_credit)}</TableCell>
                        <TableCell className="text-center text-xs font-bold">{new Date(entry.entry_date).toLocaleDateString("ar-EG")}</TableCell>
                      </TableRow>
                      {expandedId === entry.id && entry.lines ? (
                        <TableRow key={`${entry.id}-lines`}>
                          <TableCell colSpan={6} className="bg-slate-50/50 p-0">
                            <Table className="min-w-[800px]">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-right pr-8 text-xs">الحساب</TableHead>
                                  <TableHead className="text-center text-xs">كود</TableHead>
                                  <TableHead className="text-center text-xs">مدين</TableHead>
                                  <TableHead className="text-center text-xs">دائن</TableHead>
                                  <TableHead className="text-right text-xs">بيان</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {entry.lines.map((line) => (
                                  <TableRow key={line.id}>
                                    <TableCell className="pr-8 text-sm font-bold">{line.account?.name ?? "—"}</TableCell>
                                    <TableCell className="text-center text-xs text-slate-500">{line.account?.code ?? "—"}</TableCell>
                                    <TableCell className="text-center font-bold text-emerald-700">{line.debit > 0 ? money(line.debit) : "—"}</TableCell>
                                    <TableCell className="text-center font-bold text-rose-700">{line.credit > 0 ? money(line.credit) : "—"}</TableCell>
                                    <TableCell className="text-sm text-slate-500">{line.description ?? "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs font-black text-slate-500">صفحة {page.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((v) => Math.max(1, v - 1))}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>التالي</Button>
            </div>
          </div>
        </Card>
      </section>
    </PageAccess>
  )
}
