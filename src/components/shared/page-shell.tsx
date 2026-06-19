import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import { Info, Plus, BarChart3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
import { TableRow, TableCell } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type PageShellVariant = "page" | "module"

export interface PageShellProps {
  title: string
  subtitle?: string
  variant?: PageShellVariant
  badge?: string
  icon?: ComponentType<{ className?: string }>
  actionLabel?: string
  actionHref?: string
  actionIcon?: ReactNode
  onAction?: () => void
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function PageShell({
  title,
  subtitle,
  variant = "page",
  badge,
  icon: Icon,
  actionLabel,
  actionHref,
  actionIcon,
  onAction,
  actions,
  children,
  className,
}: PageShellProps) {
  if (variant === "module") {
    return (
      <section dir="rtl" className={cn("mx-auto flex w-full max-w-[1500px] flex-col gap-4 pb-8 text-right", className)}>
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-start gap-2">
              {badge ? (
                <Badge variant="outline" className="border-brand/20 bg-brand-subtle px-3 py-1 font-black text-brand">
                  {badge}
                </Badge>
              ) : null}
              <span className="text-xs font-black text-slate-400">من صفحات النظام المرجعية</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 max-w-3xl text-sm font-semibold leading-7 text-slate-500">{subtitle}</p> : null}
          </div>
          {actionLabel && actionHref ? (
            <Link
              href={actionHref}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-hover"
            >
              <Plus className="size-5" strokeWidth={2.2} />
              {actionLabel}
            </Link>
          ) : null}
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </section>
    )
  }

  return (
    <section dir="rtl" className={cn("page-container block-gap-lg", className)}>
      {Icon || actions ? (
        <div className="page-header text-right">
          <div className="flex min-w-0 items-center gap-3 text-right">
            {Icon ? (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-brand/10 bg-brand-muted text-brand">
                <Icon className="size-5" />
              </span>
            ) : null}
            <div className="min-w-0">
              <h1 className="heading-xl arabic-leading-tight">{title}</h1>
              {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actionLabel ? (
              <Button
                type="button"
                onClick={onAction}
                render={actionHref ? <Link href={actionHref} /> : undefined}
                nativeButton={!actionHref}
                className="btn-brand gap-2"
              >
                {actionIcon ?? <Plus className="size-5" strokeWidth={2.2} />}
                {actionLabel}
              </Button>
            ) : null}
            {actions}
          </div>
        </div>
      ) : (
        <div className="page-header text-right">
          <div className="text-right">
            <h1 className="heading-xl arabic-leading-tight">{title}</h1>
            {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
          </div>
          {actionLabel ? (
            <Button
              type="button"
              onClick={onAction}
              render={actionHref ? <Link href={actionHref} /> : undefined}
              nativeButton={!actionHref}
              className="btn-brand gap-2"
            >
              {actionIcon ?? <Plus className="size-5" strokeWidth={2.2} />}
              {actionLabel}
            </Button>
          ) : null}
        </div>
      )}
      {children}
    </section>
  )
}

export interface DashboardPageShellProps {
  title: string
  subtitle?: string
  actionLabel?: string
  actionHref?: string
  actionIcon?: ReactNode
  onAction?: () => void
  children: ReactNode
  className?: string
}

export function DashboardPageShell(props: DashboardPageShellProps) {
  return <PageShell {...props} variant="page" />
}

export function DashboardCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("rounded-xl border-slate-200 bg-white py-0 shadow-sm", className)}>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}

const toneClass: Record<string, string> = {
  blue: "border-blue-100 bg-blue-50 text-blue-700",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  rose: "border-rose-100 bg-rose-50 text-rose-700",
  slate: "border-slate-100 bg-slate-50 text-slate-700",
}

export function ModuleShell({
  title,
  subtitle,
  badge,
  actionLabel,
  actionHref,
  children,
}: {
  title: string
  subtitle: string
  badge?: string
  actionLabel?: string
  actionHref?: string
  children: ReactNode
}) {
  return (
    <PageShell title={title} subtitle={subtitle} variant="module" badge={badge} actionLabel={actionLabel} actionHref={actionHref}>
      {children}
    </PageShell>
  )
}

export type StatCard = {
  label: string
  value: string
  hint?: string
  tone?: "blue" | "emerald" | "amber" | "rose" | "slate"
}

export function StatsGrid({ stats }: { stats: StatCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="rounded-xl border-slate-200 bg-white py-0 shadow-sm">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="text-right">
              <p className="text-xs font-black text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{stat.value}</p>
              {stat.hint ? <p className="mt-1 text-xs font-semibold text-slate-400">{stat.hint}</p> : null}
            </div>
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl border",
                toneClass[stat.tone ?? "blue"]
              )}
            >
              <BarChart3 className="size-6" strokeWidth={2.2} />
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Card className="rounded-xl border-slate-200 bg-white py-0 shadow-sm">
      <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">{children}</CardContent>
    </Card>
  )
}

export function FieldBox({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-right", className)}>
      <span className="text-xs font-black text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export { NativeSelect }

export type ActionCard = {
  title: string
  description: string
  href?: string
  icon: ReactNode
  badge?: string
}

export function ActionGrid({ actions }: { actions: ActionCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => {
        const content = (
          <Card className="h-full rounded-xl border-slate-200 bg-white py-0 shadow-sm transition hover:border-brand/30 hover:shadow-md">
            <CardContent className="flex h-full items-start gap-3 p-4 text-right">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand ring-1 ring-brand/15">
                {action.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-start gap-2">
                  {action.badge ? (
                    <Badge variant="outline" className="font-black text-slate-600">
                      {action.badge}
                    </Badge>
                  ) : null}
                  <h3 className="text-base font-black text-slate-950">{action.title}</h3>
                </div>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{action.description}</p>
              </div>
            </CardContent>
          </Card>
        )

        return action.href ? (
          <Link key={action.title} href={action.href}>
            {content}
          </Link>
        ) : (
          <div key={action.title}>{content}</div>
        )
      })}
    </div>
  )
}

export function DataCard({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="rounded-xl border-slate-200 bg-white py-0 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-black text-slate-950">{title}</CardTitle>
          {icon ? <span className="text-brand">{icon}</span> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}

export function EmptyRow({
  colSpan,
  text = "لا توجد بيانات فعلية بعد. سيتم ربطها بقاعدة البيانات في مرحلة التنفيذ.",
}: {
  colSpan: number
  text?: string
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-sm font-semibold text-slate-400">
        {text}
      </TableCell>
    </TableRow>
  )
}

export { TableRow, TableCell }

export function PageNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-right text-sm font-semibold leading-7 text-blue-800">
      <Info className="mt-0.5 size-5 shrink-0" strokeWidth={2.2} />
      <p>{children}</p>
    </div>
  )
}
