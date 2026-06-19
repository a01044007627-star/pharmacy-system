"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, Trash2, BellOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NotificationService } from "@/features/notifications/services/notification-service"
import type { NotificationRow } from "@/types/notifications"
import { cn } from "@/lib/utils"

const typeBadge: Record<string, string> = {
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  error: "bg-red-50 text-red-700 border-red-200",
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("ar-EG", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function NotificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [notif, setNotif] = useState<NotificationRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    NotificationService.getById(id).then((row) => {
      setNotif(row)
      if (row && !row.read) {
        NotificationService.markRead(id)
      }
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div dir="rtl" className="flex items-center justify-center py-20">
        <div className="size-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
      </div>
    )
  }

  if (!notif) {
    return (
      <div dir="rtl" className="mx-auto max-w-2xl px-4 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-slate-50 text-slate-300 mx-auto mb-3">
          <BellOff className="size-7" />
        </span>
        <p className="text-sm font-black text-slate-400">الإشعار غير موجود</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/notifications")} className="mt-4 rounded-xl">
          العودة للإشعارات
        </Button>
      </div>
    )
  }

  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-5 px-4 pb-8 text-right">
      <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/notifications")} className="rounded-xl">
        <ArrowLeft className="size-4" />
        العودة
      </Button>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Badge className={cn("rounded-full text-[10px] font-black", typeBadge[notif.notif_type] ?? typeBadge.info)}>
              {notif.notif_type === "warning" ? "تحذير" : notif.notif_type === "success" ? "نجاح" : notif.notif_type === "error" ? "خطأ" : "معلومة"}
            </Badge>
            <h1 className="text-2xl font-black text-slate-900">{notif.title}</h1>
          </div>
          <Badge variant={notif.read ? "secondary" : "default"} className="rounded-full shrink-0">
            {notif.read ? "مقروء" : "جديد"}
          </Badge>
        </div>

        <p className="mt-4 text-sm font-semibold text-slate-600 leading-relaxed">{notif.description}</p>

        <p className="mt-6 text-xs font-bold text-slate-400">{formatDate(notif.created_at)}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {notif.href && (
            <Button variant="default" size="sm" onClick={() => router.push(notif.href!)} className="rounded-xl">
              <ExternalLink className="size-4" />
              الانتقال إلى الصفحة المرتبطة
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { await NotificationService.delete(notif.id); router.push("/dashboard/notifications") }}
            className="rounded-xl text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            <Trash2 className="size-4" />
            حذف
          </Button>
        </div>
      </div>
    </div>
  )
}
