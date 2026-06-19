"use client"

import { Lock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import type { Permission } from "@/lib/auth/permissions"

export function PageAccess({ permission, children, message = "ليست لديك صلاحية فتح هذه الصفحة" }: { permission: Permission; children: React.ReactNode; message?: string }) {
  const auth = useAuth()
  if (auth.loading) {
    return null
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
