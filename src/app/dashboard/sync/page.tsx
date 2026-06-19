"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, RefreshCw, Wifi, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { syncManager, type SyncStatus } from "@/lib/sync/sync-manager"
import { cn } from "@/lib/utils"

export default function SyncPage() {
  const auth = useAuth()
  const [serverStatus, setServerStatus] = useState<{ status: string; last_sync: string; pending_changes: number } | null>(null)
  const [clientStatus, setClientStatus] = useState<SyncStatus>(syncManager.status)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      await syncManager.refreshPending()
      const response = await fetch(`/api/sync?pharmacy_id=${auth.activePharmacyId}&status=${navigator.onLine ? "1" : "0"}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { status: string; last_sync: string; pending_changes: number }
      if (!response.ok) throw new Error("فشل تحميل حالة المزامنة")
      setServerStatus(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل حالة المزامنة")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => {
    const unsubscribe = syncManager.subscribe(setClientStatus)
    return () => { unsubscribe() }
  }, [])
  useEffect(() => { void load() }, [load])

  const triggerSync = async () => {
    setSyncing(true)
    try {
      await syncManager.forceSync()
      const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error("فشلت المزامنة")
      toast.success(data.message ?? "تمت المزامنة بنجاح")
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشلت المزامنة")
    } finally {
      setSyncing(false)
    }
  }

  const isOnline = clientStatus.online && serverStatus?.status !== "offline"
  const pending = clientStatus.pendingMutations + (serverStatus?.pending_changes ?? 0)
  const lastSync = clientStatus.lastSync ?? serverStatus?.last_sync ?? null

  return (
    <PageAccess permission="sync:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="المزامنة" subtitle="حالة المزامنة المحلية والأونلاين مع تتبع التغييرات المعلقة." icon={RefreshCw} actions={
          <Button className="h-10 rounded-xl" disabled={syncing || clientStatus.isSyncing || !isOnline} onClick={() => void triggerSync()}>
            <RefreshCw className={cn("size-4", (syncing || clientStatus.isSyncing) && "animate-spin")} /> مزامنة الآن
          </Button>
        } />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              {isOnline ? <Wifi className="size-8 text-emerald-500" /> : <WifiOff className="size-8 text-rose-500" />}
              <div><p className="text-xs font-black text-slate-400">الحالة</p><p className={cn("mt-1 text-xl font-black", isOnline ? "text-emerald-700" : "text-rose-700")}>{isOnline ? "متصل" : "غير متصل"}</p></div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">آخر مزامنة</p><p className="mt-2 text-lg font-black text-slate-950">{lastSync ? new Date(lastSync).toLocaleString("ar-EG") : "—"}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">التغييرات المعلقة</p><p className="mt-2 text-xl font-black text-amber-600">{pending.toLocaleString("ar-EG")}</p></CardContent></Card>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <h3 className="mb-3 text-base font-black text-slate-950">حالة جداول البيانات</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["الأصناف", "items"],
                ["المبيعات", "sales"],
                ["المشتريات", "purchases"],
                ["المخزون", "inventory"],
              ].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="font-bold text-slate-700">{label}</span>
                  <Badge variant="outline" className={cn("font-black", pending > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                    <CheckCircle2 className="size-3 ml-1" /> {pending > 0 ? "يوجد معلق" : "متزامن"}
                  </Badge>
                </div>
              ))}
            </div>
            {loading ? <p className="mt-4 text-xs font-black text-slate-400">جاري تحديث الحالة...</p> : null}
          </CardContent>
        </Card>
      </section>
    </PageAccess>
  )
}
