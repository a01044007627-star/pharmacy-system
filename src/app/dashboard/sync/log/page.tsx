"use client"

import { useEffect, useState } from "react"
import { Clock, RefreshCw, Trash2 } from "lucide-react"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { localDB, type SyncLogEntry } from "@/lib/sync/local-db"
import { cn } from "@/lib/utils"

export default function SyncLogPage() {
  const [logs, setLogs] = useState<SyncLogEntry[]>([])

  async function load() {
    setLogs(await localDB.getSyncLogs(120))
  }

  useEffect(() => { void load() }, [])

  async function clearLogs() {
    await localDB.clearSyncLogs()
    await load()
  }

  return (
    <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
      <DashboardPageHeader title="سجل المزامنة" subtitle="تاريخ عمليات المزامنة المحلية مع الخادم." icon={Clock} actions={
        <div className="flex gap-2">
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className="size-4" /> تحديث</Button>
          <Button variant="ghost" className="h-10 rounded-xl text-rose-600 hover:bg-rose-50" onClick={() => void clearLogs()}><Trash2 className="size-4" /> مسح السجل</Button>
        </div>
      } />

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
        {logs.length === 0 ? (
          <EmptyState icon={Clock} title="لا توجد سجلات" description="سجل المزامنة سيكون متاحاً بعد أول عملية." />
        ) : (
          <Table className="min-w-[800px]">
            <TableHeader><TableRow>
              <TableHead className="text-right">الجدول</TableHead><TableHead className="text-center">الإجراء</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">التفاصيل</TableHead><TableHead className="text-center">التاريخ</TableHead>
            </TableRow></TableHeader>
            <TableBody>{logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-black text-brand">{log.table}</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="font-black">{log.action === "sync" ? "مزامنة" : log.action}</Badge></TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className={cn("font-black", log.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : log.status === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                    {log.status === "success" ? "نجاح" : log.status === "warning" ? "تنبيه" : "فشل"}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-xs font-bold">{log.details}</TableCell>
                <TableCell className="text-center text-xs font-bold">{new Date(log.timestamp).toLocaleString("ar-EG")}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Card>
    </section>
  )
}
