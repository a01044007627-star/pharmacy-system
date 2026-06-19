"use client"

import { type ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function FormField({
  id,
  label,
  required,
  hint,
  icon,
  error,
  children,
  className,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  icon?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div data-invalid={!!error} className={cn("grid gap-2 text-right", className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-right text-sm font-black text-slate-800">
        {icon ? <span className="text-brand">{icon}</span> : null}
        <span>{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-right text-xs font-black leading-5 text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-right text-xs font-medium leading-5 text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export function FormSection({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string
  description: string
  icon: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white py-0 shadow-sm", className)}>
      <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex items-start gap-3 text-right">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand ring-1 ring-brand/15">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg font-black tracking-tight text-slate-950">{title}</CardTitle>
            {description ? <CardDescription className="mt-1 text-sm font-semibold leading-6 text-slate-500">{description}</CardDescription> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5 sm:p-6">{children}</CardContent>
    </Card>
  )
}
