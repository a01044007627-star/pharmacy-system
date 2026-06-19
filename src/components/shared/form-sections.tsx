"use client"

import { type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export function AddItemSection({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border border-slate-150/70 bg-white py-0 shadow-xs", className)}>
      <CardHeader className="bg-transparent px-5 pt-5 pb-2">
        <div className="flex items-center gap-3 text-right">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/5 text-brand border border-brand/10">
            {icon}
          </span>
          <CardTitle className="text-base font-black tracking-tight text-slate-800">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-2">{children}</CardContent>
    </Card>
  )
}

export function AccountingMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string
  value: string
  tone?: "slate" | "emerald" | "amber"
}) {
  const toneClass = {
    slate: "border-slate-100 bg-slate-50/50 text-slate-800",
    emerald: "border-emerald-100 bg-emerald-50/50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50/50 text-amber-800",
  }[tone]

  return (
    <div className={cn("rounded-xl border px-4 py-3 text-right transition duration-200 hover:shadow-xs", toneClass)}>
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className="mt-1.5 text-lg font-black tabular-nums">{value}</p>
    </div>
  )
}

export function InventoryToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 text-right transition hover:bg-slate-50">
      <Checkbox checked={checked} onCheckedChange={(nextChecked) => onChange(nextChecked === true)} className="size-5 rounded-md border-slate-300 data-checked:bg-brand" />
      <span className="text-sm font-black text-slate-800">{label}</span>
    </label>
  )
}
