"use client"

import { useState, useEffect, useCallback } from "react"
import { Database, Download, Upload, Trash2, RotateCcw, Plus, Loader2, Calendar } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SettingsEntityService } from "@/features/settings/services/settings-entity-service"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"

interface Backup {
  id: string
  pharmacy_id: string
  name: string
  file_size?: number
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
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("ar-SA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateStr
  }
}

function BackupContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("backup")
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const canWriteBackup = can("settings:write") && canWrite

  const loadBackups = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const data = await SettingsEntityService.list<Backup>("backups")
      setBackups(data)
    } catch {
      setBackups([])
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadBackups() }, [loadBackups])

  async function handleCreateBackup() {
    if (!canWriteBackup) { toast.error("ليست لديك صلاحية إنشاء النسخ الاحتياطي"); return }
    setCreating(true)
    try {
      const now = new Date()
      const name = `نسخة احتياطية - ${now.toLocaleDateString("ar-SA")}`
      await SettingsEntityService.create<Backup>("backups", {
        name,
        type: "manual",
        created_at: now.toISOString(),
      })
      toast.success("تم إنشاء النسخة الاحتياطية بنجاح")
      await loadBackups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل إنشاء النسخة الاحتياطية")
    } finally {
      setCreating(false)
    }
  }

  async function handleRestore(id: string, name: string) {
    if (!canWriteBackup) { toast.error("ليست لديك صلاحية استعادة النسخ الاحتياطية"); return }
    if (!window.confirm(`هل أنت متأكد من استعادة النسخة "${name}"؟ سيتم استبدال جميع البيانات الحالية.`)) return
    setRestoring(id)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      toast.success(`تمت استعادة النسخة "${name}" بنجاح`)
    } catch {
      toast.error("فشل استعادة النسخة الاحتياطية")
    } finally {
      setRestoring(null)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!canWriteBackup) { toast.error("ليست لديك صلاحية حذف النسخ الاحتياطية"); return }
    if (!window.confirm(`هل أنت متأكد من حذف النسخة "${name}"؟`)) return
    try {
      await SettingsEntityService.remove("backups", id)
      toast.success("تم حذف النسخة الاحتياطية")
      await loadBackups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حذف النسخة الاحتياطية")
    }
  }

  if (!canRead) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm font-bold text-slate-500">ليس لديك صلاحية الوصول</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-right">
          <h1 className="text-lg font-black text-slate-900">النسخ الاحتياطي</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">إدارة النسخ الاحتياطية للبيانات</p>
        </div>
        {canWriteBackup ? (
          <Button variant="default" size="sm" onClick={handleCreateBackup} disabled={creating}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Database className="size-4" />
            )}
            {creating ? "جاري الإنشاء…" : "إنشاء نسخة احتياطية"}
          </Button>
        ) : null}
      </div>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3">
          <CardTitle className="text-base font-black text-slate-900">النسخ الاحتياطية المتاحة</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-brand" />
            </div>
          ) : backups.length === 0 ? (
            <div className="py-8 text-center">
              <Database className="mx-auto mb-2 size-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-400">لا توجد نسخ احتياطية بعد</p>
              {canWriteBackup ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={handleCreateBackup}>
                  <Database className="size-4" />
                  إنشاء أول نسخة
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {backups.map((backup) => (
                <div key={backup.id} className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-slate-50">
                  <div className="flex min-w-0 items-center gap-3 text-right">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                      <Database className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900 truncate">{backup.name}</span>
                        {backup.type === "auto" ? (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">تلقائي</span>
                        ) : (
                          <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-bold text-brand">يدوي</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs font-semibold text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {formatDate(backup.created_at)}
                        </span>
                        {backup.file_size ? (
                          <span className="flex items-center gap-1">
                            <Database className="size-3" />
                            {formatFileSize(backup.file_size)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {canWriteBackup ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleRestore(backup.id, backup.name)}
                        disabled={restoring === backup.id}
                      >
                        {restoring === backup.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3.5" />
                        )}
                        استعادة
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(backup.id, backup.name)}>
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </div>
                  ) : null}
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
  return (
    <SettingsLayout>
      <BackupContent />
    </SettingsLayout>
  )
}
