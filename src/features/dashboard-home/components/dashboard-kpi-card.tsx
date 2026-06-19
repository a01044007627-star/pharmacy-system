"use client"

import { memo } from "react"
import { Info } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DashboardKpi, DashboardTone } from "../types"

const toneClasses: Record<DashboardTone, { icon: string; info: string; border: string; glow: string }> = {
  blue: { icon: "bg-sky-100 text-sky-600", info: "text-sky-700", border: "hover:border-sky-200", glow: "group-hover:bg-sky-50/70" },
  green: { icon: "bg-emerald-100 text-emerald-600", info: "text-emerald-700", border: "hover:border-emerald-200", glow: "group-hover:bg-emerald-50/70" },
  amber: { icon: "bg-amber-100 text-amber-600", info: "text-amber-700", border: "hover:border-amber-200", glow: "group-hover:bg-amber-50/70" },
  red: { icon: "bg-rose-100 text-rose-500", info: "text-rose-600", border: "hover:border-rose-200", glow: "group-hover:bg-rose-50/70" },
  purple: { icon: "bg-violet-100 text-violet-600", info: "text-violet-700", border: "hover:border-violet-200", glow: "group-hover:bg-violet-50/70" },
  cyan: { icon: "bg-cyan-100 text-cyan-600", info: "text-cyan-700", border: "hover:border-cyan-200", glow: "group-hover:bg-cyan-50/70" },
  slate: { icon: "bg-slate-100 text-slate-600", info: "text-slate-700", border: "hover:border-slate-300", glow: "group-hover:bg-slate-50/70" },
}

function formatDashboardMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

interface DashboardKpiCardProps {
  item: DashboardKpi
  onOpenDailyProfit?: () => void
  loading?: boolean
}

export const DashboardKpiCard = memo(function DashboardKpiCard({ item, onOpenDailyProfit, loading }: DashboardKpiCardProps) {
  const Icon = item.icon
  const tone = toneClasses[item.tone]
  const clickable = Boolean(item.opensDailyProfit && onOpenDailyProfit)

  return (
    <Card className={cn("overflow-hidden rounded-3xl border-slate-200 bg-white py-0 shadow-[0_10px_26px_rgba(15,23,42,0.07)] transition-colors", tone.border)}>
      <CardContent className="p-0">
        <div
          onClick={clickable ? onOpenDailyProfit : undefined}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onKeyDown={clickable ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDailyProfit?.() } } : undefined}
          className={cn(
            "group flex min-h-[116px] w-full items-center justify-between gap-5 px-6 py-5 text-right outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
            clickable ? "cursor-pointer" : "cursor-default",
            tone.glow,
          )}
        >
          <span className={cn("flex size-15 shrink-0 items-center justify-center rounded-full", tone.icon)}>
            <Icon className="size-7" strokeWidth={2.15} />
          </span>

          <span className="flex min-w-0 flex-1 flex-col items-end gap-1">
            <span className="flex max-w-full items-center justify-end gap-1.5 text-[15px] font-black leading-6 text-slate-500">
              {item.info ? (
                <TooltipProvider delay={80}>
                  <Tooltip>
                    <TooltipTrigger>
                      <span className="inline-flex">
                        <Info className={cn("size-4", tone.info)} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[290px] text-center text-xs font-bold leading-5">
                      {item.info}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              <span className="line-clamp-2">{item.label}</span>
            </span>

            {loading ? (
              <Skeleton className="mt-2 h-7 w-32 rounded-lg" />
            ) : (
              <span dir="ltr" className="mt-1 block text-left text-[24px] font-black leading-none tabular-nums text-slate-950">
                <span className="text-[17px]">ج.م</span> {formatDashboardMoney(item.value)}
              </span>
            )}

            {item.hint ? <span className="mt-1 block text-xs font-bold text-slate-400">{item.hint}</span> : null}
          </span>
        </div>
      </CardContent>
    </Card>
  )
})
