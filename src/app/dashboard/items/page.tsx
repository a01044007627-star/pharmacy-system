"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { ItemsListView } from "@/features/inventory/components/items-list-view"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export default function ItemsPage() {
  const [uploading, setUploading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState<{ total_rows?: number; imported?: number; skipped?: number; errors?: number; error_details?: Array<{ row: number; message: string }>; skipped_details?: Array<{ row: number; message: string }> } | null>(null)

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/items/import", { method: "POST", body: formData })
      const data = await response.json().catch(() => ({})) as { total_rows?: number; imported?: number; skipped?: number; errors?: number; error_details?: Array<{ row: number; message: string }>; skipped_details?: Array<{ row: number; message: string }>; error?: string }
      if (!response.ok) throw new Error(data.error ?? (data.errors ? `فشل استيراد ${data.errors} صف` : "فشل الاستيراد"))
      setImportResult(data)
      toast.success(`تم استيراد ${data.imported ?? 0} صنف من أصل ${data.total_rows ?? 0}${data.skipped ? `، تم تخطي ${data.skipped}` : ""}${data.errors ? `، ${data.errors} أخطاء` : ""}`)
      if (data.errors && data.error_details?.length) {
        data.error_details.slice(0, 5).forEach((err) => toast.error(`صف ${err.row}: ${err.message}`))
      }
    } catch (error) {
      setImportResult(null)
      toast.error(error instanceof Error ? error.message : "فشل استيراد الأدوية والأصناف")
    } finally {
      setUploading(false)
      if (event.target) event.target.value = ""
    }
  }

  return (
    <>
      <PageAccess permission="inventory:read">
        <ItemsListView mode="active" />
      </PageAccess>
      <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-2">
        <Dialog open={showImport} onOpenChange={setShowImport}>
          <Button className="h-12 rounded-2xl shadow-xl gap-2" onClick={() => { setImportResult(null); setShowImport(true) }}><FileSpreadsheet className="size-5" /> استيراد Excel</Button>
          <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
            <DialogHeader><DialogTitle className="text-lg font-black">استيراد الأدوية والأصناف من Excel</DialogTitle></DialogHeader>
            <div className="space-y-4 p-2">
              <div className="space-y-2 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm font-bold text-slate-600">
                <p>الاستيراد يدعم بيانات الصيدلية: الاسم العربي والإنجليزي، الباركودات، الشركة المنتجة، المادة الفعالة، التركيز، الشكل الدوائي، حجم العبوة، الوحدة، المجموعة، أسعار الشراء والبيع، التشغيلة، الصلاحية، الرصيد الافتتاحي ومكان التخزين.</p>
                <button type="button" onClick={() => { window.location.href = "/api/items/import" }} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-sky-700 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50">
                  <Download className="size-4" /> تحميل قالب Excel جاهز
                </button>
              </div>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-8 transition hover:border-brand">
                <Upload className="size-8 text-slate-400" />
                <span className="font-bold text-slate-500">اختر ملف Excel</span>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void handleImport(e)} disabled={uploading} />
              </label>
              {importResult ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-black text-slate-700">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <span>إجمالي الصفوف: {(importResult.total_rows ?? 0).toLocaleString("ar-EG")}</span>
                    <span>تم الاستيراد: {(importResult.imported ?? 0).toLocaleString("ar-EG")}</span>
                    <span>تم التخطي: {(importResult.skipped ?? 0).toLocaleString("ar-EG")}</span>
                    <span>أخطاء: {(importResult.errors ?? 0).toLocaleString("ar-EG")}</span>
                  </div>
                  {importResult.error_details?.length ? (
                    <div className="mt-2 rounded-xl bg-white/70 p-2 text-xs leading-6 text-rose-700">
                      {importResult.error_details.slice(0, 3).map((err) => <p key={`${err.row}-${err.message}`}>صف {err.row}: {err.message}</p>)}
                    </div>
                  ) : null}
                  <Button className="mt-3 h-9 rounded-xl" onClick={() => window.location.reload()}>تحديث قائمة الأدوية والأصناف</Button>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setShowImport(false)} disabled={uploading}>إلغاء</Button>
              {uploading ? <Button className="rounded-xl" disabled><Loader2 className="size-4 animate-spin" /> جاري الاستيراد...</Button> : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
