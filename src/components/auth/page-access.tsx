"use client"

import { Loader2, Lock, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/auth-context"
import type { Permission } from "@/lib/auth/permissions"

export function PageAccess({ permission, children, message = "ليست لديك صلاحية فتح هذه الصفحة" }: { permission: Permission; children: React.ReactNode; message?: string }) {
  const auth = useAuth()

  if (auth.loading) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-32 items-center justify-center gap-3 p-5 text-sm font-black text-slate-600">
            <Loader2 className="size-5 animate-spin text-brand" /> جاري تحميل الصلاحيات ونطاق الصيدلية...
          </CardContent>
        </Card>
      </section>
    )
  }

  if (auth.user && auth.error && !auth.activePharmacyId) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-rose-100 bg-rose-50">
          <CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 p-5 text-center">
            <p className="font-black text-rose-700">تعذر تحميل الصيدلية والصلاحيات: {auth.error}</p>
            <Button variant="outline" className="rounded-xl bg-white" onClick={() => void auth.refreshAuth()}>
              <RefreshCw className="size-4" /> إعادة التحميل
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (!auth.isDeveloper && !auth.can(permission)) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-amber-100 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-5 text-sm font-black text-amber-700">
            <Lock className="size-5" /> {message}
          </CardContent>
        </Card>
      </section>
    )
  }
  return <>{children}</>
}
