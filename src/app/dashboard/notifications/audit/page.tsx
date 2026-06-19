"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Archive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NotificationService } from "@/features/notifications/services/notification-service"
import type { DeletedNotificationRow } from "@/types/notifications"
import { cn } from "@/lib/utils"
import { LoadingState } from "@/components/shared/loading-state"
import { EmptyState } from "@/components/shared/empty-state"

const typeBadge: Record<string, string> = {
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  error: "bg-red-50 text-red-700 border-red-200",
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("ar-EG", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function NotificationAuditPage() {
  const router = useRouter()
  const [rows, setRows] = useState<DeletedNotificationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    NotificationService.fetchDeleted().then(setRows).finally(() => setLoading(false))
  }, [])

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5 px-4 pb-8 text-right">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/notifications")} className="shrink-0 rounded-xl">
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">سجل المحذوفات</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">الإشعارات التي تم حذفها سابقاً</p>
        </div>
      </div>

      {loading ? (
        <LoadingState text="جاري تحميل المحذوفات..." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Archive} title="لا توجد إشعارات محذوفة" description="سيظهر هنا سجل الإشعارات التي تم حذفها" />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black border", typeBadge[row.notif_type] ?? typeBadge.info)}>
                {row.notif_type === "warning" ? "تحذير" : row.notif_type === "success" ? "نجاح" : row.notif_type === "error" ? "خطأ" : "معلومة"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-800">{row.title}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400 leading-relaxed">{row.description}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-bold text-slate-300">
                  <span>تم الإنشاء: {formatDate(row.created_at)}</span>
                  <span>تم الحذف: {formatDate(row.deleted_at)}</span>
                </div>
              </div>
              <Badge variant={row.was_read ? "secondary" : "default"} className="rounded-full shrink-0 text-[10px]">
                {row.was_read ? "مقروء" : "غير مقروء"}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
