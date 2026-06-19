"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-h-[290px] flex-col items-center justify-center text-center", className)}>
      <span className="flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="size-8" />
      </span>
      <h2 className="mt-5 text-lg font-black text-slate-900">{title}</h2>
      <p className="mt-2 text-sm font-bold text-slate-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  )
}
