"use client"

import { useEffect, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorFallbackProps {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
  description?: string
  icon?: ReactNode
}

export function ErrorFallback({ error, reset, title, description, icon }: ErrorFallbackProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[Page Error]", error)
    }
  }, [error])

  return (
    <div
      dir="rtl"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center"
    >
      <span className="flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        {icon ?? <AlertTriangle className="size-8" strokeWidth={2} />}
      </span>

      <div className="space-y-2">
        <h2 className="text-xl font-black text-slate-800">{title ?? "حدث خطأ"}</h2>
        <p className="max-w-sm text-sm font-semibold text-slate-500">
          {description ?? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى."}
        </p>
      </div>

      <Button onClick={reset} className="gap-2 rounded-xl">
        <RefreshCw className="size-4" />
        إعادة المحاولة
      </Button>
    </div>
  )
}
