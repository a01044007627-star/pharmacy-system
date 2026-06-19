"use client"

import { useCallback, useEffect, useState } from "react"
import { Calendar, Database, Download, Loader2, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SettingsEntityService } from "@/features/settings/services/settings-entity-service"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"

interface Backup {
  id: string
  pharmacy_id: string
  name: string
  file_size?: number
  status?: string
  metadata?: Record<string, unknown>
  created_at: string
  type: "manual" | "auto"
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "غير معروف"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return Number.isNaN(date.getTime()) ? dateStr : date.toLocaleString("ar-EG")
}

function filenameFromHeader(header: string | null) {
  const match = header?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? `pharmacy-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
}

function BackupContent() {
  const auth = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("backup")
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const canExport = auth.can("settings:write") && canWrite

  const loadBackups = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      setBackups(await SettingsEntityService.list<Backup>("backups"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل سجل النسخ")
      setBackups([])
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { void loadBackups() }, [loadBackups])

  async function handleExport() {
    if (!canExport || !auth.activePharmacyId) { toast.error("ليست لديك صلاحية تصدير النسخة"); return }
    setCreating(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId })
      const response = await fetch(`/api/settings/backup-export?${params.toString()}`, { cache: "no-store" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? "فشل تصدير النسخة")
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filenameFromHeader(response.headers.get("content-disposition"))
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success("تم إنشاء وتنزيل نسخة تشغيلية فعلية")
      await loadBackups()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تصدير النسخة")
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!canExport || !window.confirm(`حذف سجل النسخة "${name}"؟ لن يحذف الملف الذي نزلته على جهازك.`)) return
    try {
      await SettingsEntityService.remove("backups", id)
      toast.success("تم حذف سجل النسخة")
      await loadBackups()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف سجل النسخة")
    }
  }

  if (!canRead) return <div className="flex min-h-[300px] items-center justify-center"><p className="text-sm font-bold text-slate-500">ليس لديك صلاحية الوصول</p></div>

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-right"><h1 className="text-lg font-black text-slate-900">النسخ والتصدير</h1><p className="mt-1 text-sm font-semibold text-slate-500">تصدير بيانات الصيدلية الفعلية إلى ملف JSON قابل للحفظ خارج المنظومة.</p></div>
        {canExport ? <Button size="sm" onClick={() => void handleExport()} disabled={creating}>{creating ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{creating ? "جاري جمع البيانات…" : "تصدير نسخة فعلية"}</Button> : null}
      </div>

      <Alert className="rounded-2xl border-blue-200 bg-blue-50 text-blue-950"><ShieldCheck className="size-4" /><AlertTitle className="font-black">نسخة تشغيلية حقيقية وليست محاكاة</AlertTitle><AlertDescription className="font-semibold">يتم قراءة الجداول الفعلية وحفظ أعداد السجلات وبصمة SHA-256. الاستعادة التلقائية غير مفعلة عمدًا حتى لا تُستبدل بيانات العميل بدون معاملة قاعدة بيانات آمنة؛ استخدم ملف التصدير مع مسؤول قاعدة البيانات.</AlertDescription></Alert>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-base font-black text-slate-900">سجل النسخ المصدّرة</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex items-center justify-center py-10"><Loader2 className="size-6 animate-spin text-brand" /></div> : backups.length === 0 ? (
            <div className="py-8 text-center"><Database className="mx-auto mb-2 size-10 text-slate-300" /><p className="text-sm font-bold text-slate-400">لا توجد نسخ مصدّرة بعد</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {backups.map((backup) => (
                <div key={backup.id} className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-slate-50">
                  <div className="flex min-w-0 items-center gap-3 text-right">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand"><Database className="size-5" /></span>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-black text-slate-900">{backup.name}</span><span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-bold text-brand">{backup.status === "created_with_warnings" ? "تم مع تنبيهات" : "تم التصدير"}</span></div><div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400"><span className="flex items-center gap-1"><Calendar className="size-3" />{formatDate(backup.created_at)}</span><span>{formatFileSize(backup.file_size)}</span></div></div>
                  </div>
                  {canExport ? <Button variant="ghost" size="icon-xs" onClick={() => void handleDelete(backup.id, backup.name)} title="حذف السجل"><Trash2 className="size-3.5 text-red-500" /></Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function BackupPage() {
  return <SettingsLayout><BackupContent /></SettingsLayout>
}
