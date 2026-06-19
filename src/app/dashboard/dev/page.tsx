"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Code, Database, HardDrive, Monitor, RefreshCw, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type EnvCheck = { key: string; label: string; present: boolean }

export default function DevPanelPage() {
  const auth = useAuth()

  const envVars: EnvCheck[] = [
    { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase URL", present: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase Anon Key", present: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Service Role Key", present: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
    { key: "UPLOADTHING_TOKEN", label: "UploadThing Token", present: !!process.env.UPLOADTHING_TOKEN },
    { key: "NEXT_PUBLIC_APP_URL", label: "App URL", present: !!process.env.NEXT_PUBLIC_APP_URL },
  ]

  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null)

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { status: string; timestamp: string }
      setHealth(data)
    } catch {
      setHealth({ status: "error", timestamp: new Date().toISOString() })
    }
  }, [])

  useEffect(() => { void checkHealth() }, [checkHealth])

  if (!auth.isDeveloper) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-amber-100 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-5 text-sm font-black text-amber-700">
            <Code className="size-5" /> لوحة المطورين متاحة فقط لمطوري النظام.
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border border-brand/10 bg-brand-muted text-brand">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-950 md:text-2xl">لوحة المطورين</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">أدوات ومعلومات النظام للمطورين.</p>
            </div>
          </div>
          <Badge className="rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-700 ring-1 ring-amber-200">
            <Monitor className="ml-1 size-3.5" /> وضع المطور
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><HardDrive className="size-4 text-brand" /> صحة النظام</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
              <span className="font-bold text-slate-700">حالة API</span>
              <Badge variant="outline" className={cn("font-black", health?.status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                {health?.status === "ok" ? "سليمة" : "خطأ"}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
              <span className="font-bold text-slate-700">آخر فحص</span>
              <span className="text-xs font-bold text-slate-500">{health?.timestamp ? new Date(health.timestamp).toLocaleString("ar-EG") : "—"}</span>
            </div>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void checkHealth()}><RefreshCw className="size-3 ml-1" /> إعادة الفحص</Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Database className="size-4 text-brand" /> متغيرات البيئة</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {envVars.map((env) => (
              <div key={env.key} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-2.5">
                <div><span className="text-xs font-bold text-slate-500">{env.label}</span><p className="text-xs font-black text-slate-700" dir="ltr">{env.key}</p></div>
                {env.present ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-rose-500" />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Monitor className="size-4 text-brand" /> معلومات النظام</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"><span className="font-bold text-slate-700">Next.js</span><span className="text-xs font-black">{process.env.__NEXT_VERSION ?? "16.x"}</span></div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"><span className="font-bold text-slate-700">Node.js</span><span className="text-xs font-black">{typeof process !== "undefined" ? (process.version ?? "—") : "—"}</span></div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"><span className="font-bold text-slate-700">البيئة</span><span className="text-xs font-black">{process.env.NODE_ENV ?? "—"}</span></div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"><span className="font-bold text-slate-700">المستخدم</span><span className="text-xs font-black">{auth.user?.email ?? "—"}</span></div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Code className="size-4 text-brand" /> الإجراءات</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <Button variant="outline" className="w-full justify-start rounded-xl font-bold" onClick={() => { window.localStorage.clear(); toast.success("تم مسح الكاش") }}><RefreshCw className="size-4 ml-2" /> مسح الكاش المحلي</Button>
            <Button variant="outline" className="w-full justify-start rounded-xl font-bold" onClick={() => { toast.success("تمت إعادة التحميل"); window.location.reload() }}><RefreshCw className="size-4 ml-2" /> إعادة تحميل الصفحة</Button>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
