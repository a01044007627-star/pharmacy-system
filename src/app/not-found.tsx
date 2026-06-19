import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-50 to-white p-4">
      <Card className="max-w-md py-0 border-slate-200 shadow-xl">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-black text-slate-900">الصفحة غير موجودة</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">عذراً، لم نتمكن من العثور على الصفحة المطلوبة</p>
          </div>
          <Link href="/" className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground")}>العودة إلى الرئيسية</Link>
        </CardContent>
      </Card>
    </div>
  )
}
