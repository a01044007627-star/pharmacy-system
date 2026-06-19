import type { ComponentType, ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const toneClasses = {
  brand: "border-brand/10 bg-brand-muted text-brand",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-600",
  neutral: "border-slate-200 bg-slate-50 text-slate-500",
}

export function AppStatePage({
  title,
  description,
  icon: Icon,
  tone = "brand",
  actions,
}: {
  title: string
  description: ReactNode
  icon: ComponentType<{ className?: string }>
  tone?: keyof typeof toneClasses
  actions?: ReactNode
}) {
  return (
    <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-dashboard-bg p-4 text-right sm:p-6">
      <Card className="w-full max-w-lg overflow-hidden py-0">
        <CardContent className="flex flex-col items-center p-7 text-center sm:p-9">
          <span className={cn("mb-5 flex size-16 items-center justify-center rounded-lg border", toneClasses[tone])}>
            <Icon className="size-8" />
          </span>
          <h1 className="text-xl font-black text-slate-950 sm:text-2xl">{title}</h1>
          <div className="mt-2 max-w-md text-sm font-semibold leading-7 text-slate-500">{description}</div>
          {actions ? <div className="mt-6 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">{actions}</div> : null}
        </CardContent>
      </Card>
    </main>
  )
}
