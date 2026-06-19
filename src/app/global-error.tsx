"use client"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-gradient-to-br from-slate-50 to-white p-4 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-black text-slate-900">خطأ في النظام</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">{error.message || "حدث خطأ جذري في التطبيق"}</p>
          </div>
          <button
            onClick={reset}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  )
}
