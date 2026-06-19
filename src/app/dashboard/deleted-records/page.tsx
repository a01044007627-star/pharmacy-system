"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

export default function DeletedRecordsPage() {
  const auth = useAuth()
  const [records, setRecords] = useState<Record<string, unknown[]>>({})
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState("all")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/deleted-records?pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { records?: Record<string, unknown[]>; tables?: string[] }
      if (!response.ok) throw new Error("فشل تحميل السجلات المحذوفة")
      setRecords(data.records ?? {})
      setTables(data.tables ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل السجلات المحذوفة")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const tableNames: Record<string, string> = {
    pharmacy_items: "الأصناف",
    pharmacy_purchases: "المشتريات",
    pharmacy_sales: "المبيعات",
    pharmacy_partners: "الشركاء",
    pharmacy_employees: "الموظفين",
  }

  const allEntries = Object.entries(records).flatMap(([table, rows]) =>
    (rows as unknown[]).map((row) => ({ table, row: row as Record<string, unknown> }))
  )

  const filtered = selectedTable === "all" ? allEntries : allEntries.filter((e) => e.table === selectedTable)

  return (
    <PageAccess permission="deleted-records:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="السجلات المحذوفة" subtitle="عرض السجلات المحذوفة من النظام." icon={Trash2} actions={
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
        } />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <NativeSelect value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className="max-w-xs">
              <NativeSelectOption value="all">كل الجداول</NativeSelectOption>
              {tables.map((t) => <NativeSelectOption key={t} value={t}>{tableNames[t] ?? t}</NativeSelectOption>)}
            </NativeSelect>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          {loading ? <SkeletonRows count={6} /> : filtered.length === 0 ? (
            <EmptyState icon={Trash2} title="لا توجد سجلات محذوفة" description="السجلات المحذوفة ستظهر هنا للمراجعة." />
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((entry, idx) => (
                <div key={idx} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-black text-slate-600">{tableNames[entry.table] ?? entry.table}</Badge>
                      <span className="text-sm font-bold text-slate-700">#{String(entry.row.id ?? entry.row.code ?? "—")}</span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {entry.row.deleted_at ? new Date(String(entry.row.deleted_at)).toLocaleString("ar-EG") : "—"}
                    </span>
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                    {JSON.stringify(entry.row, null, 1)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
