"use client"

export default function LoadingPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-50 to-white">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-[3px] border-brand-muted border-t-brand" />
        <p className="text-sm font-bold text-slate-400">جاري التحميل…</p>
      </div>
    </div>
  )
}
