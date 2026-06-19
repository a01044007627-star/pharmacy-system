"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Download, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { syncManager, type SyncStatus } from "@/lib/sync/sync-manager"
import { network } from "@/lib/network"
import { CORE_OFFLINE_ROUTES, OFFLINE_APP_VERSION } from "@/lib/pwa/core-routes"
import { postWarmRequest } from "@/components/pwa/pwa-bootstrap"
import { cn } from "@/lib/utils"

const READY_KEY = "pharmacy-offline-ready"

type ReadyState = { version?: string; pharmacyId?: string | null; branchId?: string | null; cached?: number; preparedAt?: string }

function readReady(pharmacyId?: string | null): ReadyState | null {
  if (typeof window === "undefined") return null
  try {
    const value = JSON.parse(localStorage.getItem(READY_KEY) ?? "null") as ReadyState | null
    return value?.version === OFFLINE_APP_VERSION && value.pharmacyId === pharmacyId ? value : null
  } catch { return null }
}

export default function SyncPage() {
  const auth = useAuth()
  const [serverStatus, setServerStatus] = useState<{ status: string; last_sync: string; pending_changes: number } | null>(null)
  const [clientStatus, setClientStatus] = useState<SyncStatus>(syncManager.status)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [ready, setReady] = useState<ReadyState | null>(null)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    setReady(readReady(auth.activePharmacyId))
    try {
      await syncManager.refreshPending()
      const reachable = await network.check()
      if (!reachable) {
        setServerStatus((current) => current ? { ...current, status: "offline" } : { status: "offline", last_sync: "", pending_changes: 0 })
        return
      }
      const response = await fetch(`/api/sync?pharmacy_id=${auth.activePharmacyId}&status=1`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { status: string; last_sync: string; pending_changes: number }
      if (!response.ok) throw new Error("فشل تحميل حالة المزامنة")
      setServerStatus(data)
    } catch (error) {
      if (network.isOnline) toast.error(error instanceof Error ? error.message : "فشل تحميل حالة المزامنة")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => {
    const unsubscribe = syncManager.subscribe(setClientStatus)
    return () => { unsubscribe() }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const update = () => setReady(readReady(auth.activePharmacyId))
    window.addEventListener("pharmacy-offline-ready-updated", update)
    return () => window.removeEventListener("pharmacy-offline-ready-updated", update)
  }, [auth.activePharmacyId])

  const triggerSync = async () => {
    setSyncing(true)
    try {
      if (!(await network.check())) throw new Error("لا يوجد اتصال حقيقي بالخادم")
      await syncManager.forceSync()
      const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error("فشلت المزامنة")
      toast.success(data.message ?? "تمت المزامنة بنجاح")
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشلت المزامنة")
    } finally { setSyncing(false) }
  }

  const prepareOffline = async () => {
    if (!auth.activePharmacyId) { toast.error("اختر الصيدلية أولًا"); return }
    if (!("serviceWorker" in navigator)) { toast.error("المتصفح لا يدعم التشغيل دون إنترنت"); return }
    setPreparing(true)
    try {
      if (!(await network.check())) throw new Error("يلزم اتصال موثوق بالخادم لتجهيز الجهاز أول مرة")
      const registration = await navigator.serviceWorker.ready
      const cached = await postWarmRequest(registration, CORE_OFFLINE_ROUTES)
      if (cached <= 0) throw new Error("لم يتم تنزيل صفحات التشغيل؛ حدّث الصفحة ثم أعد المحاولة")
      await syncManager.syncCoreData(true)
      const prepared: ReadyState = {
        version: OFFLINE_APP_VERSION,
        pharmacyId: auth.activePharmacyId,
        branchId: auth.activeBranchId,
        cached,
        preparedAt: new Date().toISOString(),
      }
      localStorage.setItem(READY_KEY, JSON.stringify(prepared))
      setReady(prepared)
      toast.success("تم تجهيز الجهاز للعمل دون إنترنت")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تجهيز الجهاز للأوفلاين")
    } finally { setPreparing(false) }
  }

  const isOnline = clientStatus.online && serverStatus?.status !== "offline"
  const pending = clientStatus.pendingMutations + (serverStatus?.pending_changes ?? 0)
  const lastSync = clientStatus.lastSync ?? serverStatus?.last_sync ?? null

  return (
    <PageAccess permission="sync:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="المزامنة والعمل دون إنترنت" subtitle="تنزيل ملفات وبيانات الصيدلية على الجهاز ومزامنة العمليات المعلقة بأمان." icon={RefreshCw} actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 rounded-xl" disabled={preparing || !isOnline} onClick={() => void prepareOffline()}>
              <Download className={cn("size-4", preparing && "animate-bounce")} /> تجهيز الجهاز للأوفلاين
            </Button>
            <Button className="h-10 rounded-xl" disabled={syncing || clientStatus.isSyncing || !isOnline} onClick={() => void triggerSync()}>
              <RefreshCw className={cn("size-4", (syncing || clientStatus.isSyncing) && "animate-spin")} /> مزامنة الآن
            </Button>
          </div>
        } />

        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 p-4">
            {isOnline ? <Wifi className="size-8 text-emerald-500" /> : <WifiOff className="size-8 text-rose-500" />}
            <div><p className="text-xs font-black text-slate-400">الاتصال بالخادم</p><p className={cn("mt-1 text-xl font-black", isOnline ? "text-emerald-700" : "text-rose-700")}>{isOnline ? "متصل" : "غير متصل"}</p></div>
          </CardContent></Card>
          <Card className={cn("rounded-2xl shadow-sm", ready ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40")}><CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className={cn("size-8", ready ? "text-emerald-600" : "text-amber-600")} />
            <div><p className="text-xs font-black text-slate-500">تشغيل الجهاز دون إنترنت</p><p className={cn("mt-1 text-lg font-black", ready ? "text-emerald-700" : "text-amber-700")}>{ready ? "جاهز" : "يحتاج تجهيز"}</p></div>
          </CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">آخر مزامنة</p><p className="mt-2 text-base font-black text-slate-950">{lastSync ? new Date(lastSync).toLocaleString("ar-EG") : "—"}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">التغييرات المعلقة</p><p className="mt-2 text-xl font-black text-amber-600">{pending.toLocaleString("ar-EG")}</p></CardContent></Card>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5">
          <h3 className="mb-3 text-base font-black text-slate-950">حالة بيانات التشغيل المحلية</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {["الأصناف والباركود", "المخزون والتشغيلات", "الإعدادات والفروع", "وردية الكاشير"].map((label) => (
              <div key={label} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="font-bold text-slate-700">{label}</span>
                <Badge variant="outline" className={cn("font-black", ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                  <CheckCircle2 className="ml-1 size-3" /> {ready ? "مجهز" : "غير مكتمل"}
                </Badge>
              </div>
            ))}
          </div>
          {ready?.preparedAt ? <p className="mt-4 text-xs font-bold text-slate-500">آخر تجهيز: {new Date(ready.preparedAt).toLocaleString("ar-EG")} — {Number(ready.cached ?? 0).toLocaleString("ar-EG")} صفحة تشغيل.</p> : null}
          {loading ? <p className="mt-4 text-xs font-black text-slate-400">جاري تحديث الحالة...</p> : null}
        </CardContent></Card>
      </section>
    </PageAccess>
  )
}
