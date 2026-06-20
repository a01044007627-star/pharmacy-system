"use client"

import { AlertCircle, BellRing, CircleAlert, RefreshCw, TriangleAlert, WifiOff, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type CashierAlertSeverity = "error" | "warning" | "info"

export type CashierOperationalAlert = {
  id: string
  severity: CashierAlertSeverity
  title: string
  description: string
  count?: number
  actionLabel?: string
  onAction?: () => void
  actionLoading?: boolean
  dismissible?: boolean
  onDismiss?: () => void
}

const severityStyles: Record<CashierAlertSeverity, { card: string; icon: string }> = {
  error: { card: "border-rose-200 bg-rose-50", icon: "text-rose-600" },
  warning: { card: "border-amber-200 bg-amber-50", icon: "text-amber-700" },
  info: { card: "border-sky-200 bg-sky-50", icon: "text-sky-700" },
}

function AlertIcon({ alert }: { alert: CashierOperationalAlert }) {
  if (alert.id === "offline-sync") return <WifiOff className="size-4" />
  if (alert.severity === "error") return <AlertCircle className="size-4" />
  if (alert.severity === "warning") return <TriangleAlert className="size-4" />
  return <CircleAlert className="size-4" />
}

export function CashierAlertCenter({ alerts }: { alerts: CashierOperationalAlert[] }) {
  const criticalCount = alerts.filter((alert) => alert.severity === "error").length
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length
  const totalCount = alerts.reduce((sum, alert) => sum + Math.max(1, alert.count ?? 1), 0)
  const hasCritical = criticalCount > 0

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black transition",
          alerts.length === 0
            ? "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            : hasCritical
              ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
        )}
        title="مركز تنبيهات الكاشير"
      >
        <BellRing className={cn("size-4", alerts.length > 0 && "animate-pulse")} />
        <span className="hidden sm:inline">التنبيهات</span>
        {totalCount > 0 ? (
          <span className={cn(
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black text-white",
            hasCritical ? "bg-rose-600" : "bg-amber-600",
          )}>
            {totalCount > 99 ? "+99" : totalCount.toLocaleString("ar-EG")}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" sideOffset={8} className="z-[80] w-[min(92vw,420px)] gap-0 overflow-hidden rounded-2xl p-0" dir="rtl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <div className="text-sm font-black text-slate-950">تنبيهات التشغيل</div>
            <div className="mt-0.5 text-xs font-bold text-slate-400">
              {alerts.length === 0
                ? "لا توجد تنبيهات تحتاج تدخلًا"
                : `${criticalCount.toLocaleString("ar-EG")} خطأ و${warningCount.toLocaleString("ar-EG")} تحذير`}
            </div>
          </div>
          <BellRing className="size-5 text-brand" />
        </div>

        <div className="max-h-[60dvh] space-y-2 overflow-auto p-3 pharmacy-scrollbar">
          {alerts.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 px-4 py-5 text-center text-sm font-black text-emerald-700">
              الكاشير جاهز ولا توجد مشاكل معلقة.
            </div>
          ) : alerts.map((alert) => {
            const style = severityStyles[alert.severity]
            return (
              <div key={alert.id} className={cn("rounded-2xl border p-3", style.card)}>
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-0.5 shrink-0", style.icon)}><AlertIcon alert={alert} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-950">{alert.title}</p>
                      {(alert.count ?? 0) > 1 ? (
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-slate-600">{alert.count}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs font-bold leading-6 text-slate-600">{alert.description}</p>
                    {alert.onAction || alert.dismissible ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {alert.onAction ? (
                          <Button size="sm" variant="outline" className="h-8 rounded-xl bg-white/90 text-xs font-black" onClick={alert.onAction} disabled={alert.actionLoading}>
                            <RefreshCw className={cn("size-3.5", alert.actionLoading && "animate-spin")} />
                            {alert.actionLabel ?? "إعادة المحاولة"}
                          </Button>
                        ) : null}
                        {alert.dismissible && alert.onDismiss ? (
                          <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs font-black text-slate-500" onClick={alert.onDismiss}>
                            <X className="size-3.5" /> إخفاء
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
