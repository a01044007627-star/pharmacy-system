"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function LoadingState({
  text = "جاري التحميل...",
  className,
  minHeight = "min-h-[300px]",
}: {
  text?: string
  className?: string
  minHeight?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", minHeight, className)}>
      <Loader2 className="size-6 animate-spin text-brand" />
      <p className="text-sm font-bold text-slate-500">{text}</p>
    </div>
  )
}

export function LoadingSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 p-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  )
}
