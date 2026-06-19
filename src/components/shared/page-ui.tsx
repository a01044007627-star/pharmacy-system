import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export const dashboardInputClass = "h-10 rounded-xl border-slate-200 bg-white text-sm shadow-none focus-visible:border-brand focus-visible:ring-brand/15"
export const dashboardSelectTriggerClass = "h-10 rounded-xl border-slate-200 bg-white text-sm shadow-none focus-visible:border-brand focus-visible:ring-brand/15"
export const dashboardTextareaClass = "min-h-24 rounded-xl border-slate-200 bg-white text-sm shadow-none focus-visible:border-brand focus-visible:ring-brand/15"

const dashboardPanelClass =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"

const dashboardHeaderIconClass =
  "flex size-11 shrink-0 items-center justify-center rounded-xl border border-brand/10 bg-brand-muted text-brand"

const dashboardTitleClass =
  "text-xl font-black tracking-tight text-slate-950 md:text-2xl leading-[1.5]"

const dashboardSubtitleClass =
  "mt-1 text-sm font-semibold leading-6 text-slate-500"

type DashboardPageHeaderProps = {
  title: string
  subtitle?: string
  icon: LucideIcon
  actions?: ReactNode
  className?: string
  iconClassName?: string
}

export function DashboardPageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className,
  iconClassName,
}: DashboardPageHeaderProps) {
  return (
    <Card className={cn(dashboardPanelClass, "overflow-visible", className)} dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 text-right">
          <span className={cn(dashboardHeaderIconClass, iconClassName)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className={dashboardTitleClass}>{title}</h1>
            {subtitle ? <p className={dashboardSubtitleClass}>{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </Card>
  )
}
