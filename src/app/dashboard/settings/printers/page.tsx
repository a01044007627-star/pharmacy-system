"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Printer, Wifi, Usb, Bluetooth, Cable, Monitor, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { PrinterService } from "@/features/settings/services/printer-service"
import { Loader2 } from "lucide-react"
import type { ReceiptPrinter, PrinterInterface, PrinterType } from "@/features/settings/types"

const interfaceLabels: Record<PrinterInterface, string> = {
  usb: "يو إس بي",
  bluetooth: "بلوتوث",
  network: "شبكة",
  wifi: "واي فاي",
  serial: "منفذ تسلسلي",
}

const interfaceIcons: Record<PrinterInterface, typeof Usb> = {
  usb: Usb,
  bluetooth: Bluetooth,
  network: Wifi,
  wifi: Wifi,
  serial: Cable,
}

const printerTypeLabels: Record<PrinterType, string> = {
  thermal: "حرارية",
  inkjet: "نافثة للحبر",
  dot_matrix: "نقطية",
}

const interfaceOptions: PrinterInterface[] = ["usb", "bluetooth", "network", "wifi", "serial"]
const printerTypeOptions: PrinterType[] = ["thermal", "inkjet", "dot_matrix"]
const paperWidthOptions = [58, 80]

function PrintersContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("printers")
  const [printers, setPrinters] = useState<ReceiptPrinter[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    printer_type: "thermal" as PrinterType,
    interface_type: "usb" as PrinterInterface,
    ip_address: "",
    port: 9100,
    paper_width: 80,
    characters_per_line: 42,
    is_default: false,
  })
  const [saving, setSaving] = useState(false)

  const canWritePrinters = can("settings:write") && canWrite

  const loadPrinters = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      const data = await PrinterService.getPrinters()
      setPrinters(data)
    } catch {
      toast.error("فشل تحميل الطابعات")
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => { loadPrinters() }, [loadPrinters])

  function resetForm() {
    setForm({
      name: "",
      printer_type: "thermal",
      interface_type: "usb",
      ip_address: "",
      port: 9100,
      paper_width: 80,
      characters_per_line: 42,
      is_default: false,
    })
    setEditingId(null)
    setShowForm(false)
  }

  async function handleSubmit() {
    if (!canWritePrinters) { toast.error("ليست لديك صلاحية تعديل الطابعات"); return }
    if (!form.name.trim()) { toast.error("اسم الطابعة مطلوب"); return }
    if ((form.interface_type === "network" || form.interface_type === "wifi") && !form.ip_address.trim()) {
      toast.error("عنوان IP مطلوب للاتصال عبر الشبكة"); return
    }

    setSaving(true)
    try {
      if (editingId) {
        await PrinterService.savePrinter({ ...form, id: editingId })
        toast.success("تم تحديث الطابعة")
      } else {
        await PrinterService.savePrinter(form)
        toast.success("تم إضافة الطابعة")
      }
      resetForm()
      await loadPrinters()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الطابعة")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, isDefault: boolean) {
    if (!canWritePrinters) { toast.error("ليست لديك صلاحية حذف الطابعات"); return }
    if (isDefault) { toast.error("لا يمكن حذف الطابعة الافتراضية"); return }
    if (!window.confirm("هل أنت متأكد من حذف هذه الطابعة؟")) return
    try {
      await PrinterService.deletePrinter(id)
      toast.success("تم حذف الطابعة")
      await loadPrinters()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حذف الطابعة")
    }
  }

  async function setAsDefault(id: string) {
    if (!canWritePrinters) return
    try {
      await PrinterService.setDefault(id)
      toast.success("تم تعيين الطابعة كافتراضية")
      await loadPrinters()
    } catch {
      toast.error("فشل تحديث الطابعة الافتراضية")
    }
  }

  function startEdit(printer: ReceiptPrinter) {
    setForm({
      name: printer.name,
      printer_type: printer.printer_type,
      interface_type: printer.interface_type,
      ip_address: printer.ip_address ?? "",
      port: printer.port,
      paper_width: printer.paper_width,
      characters_per_line: printer.characters_per_line,
      is_default: printer.is_default,
    })
    setEditingId(printer.id)
    setShowForm(true)
  }

  if (!canRead) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm font-bold text-slate-500">ليس لديك صلاحية الوصول</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-right">
          <h1 className="text-lg font-black text-slate-900">طابعات الإيصالات</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">إدارة طابعات الإيصالات وإعدادات الاتصال</p>
        </div>
        {canWritePrinters ? (
          <Button variant="default" size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="size-4" />
            إضافة طابعة
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-base font-black text-slate-900">
              {editingId ? "تعديل الطابعة" : "إضافة طابعة جديدة"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="grid gap-1.5 text-right sm:col-span-2">
              <span className="text-xs font-black text-slate-700">اسم الطابعة</span>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="طابعة الإيصالات الرئيسية" className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">نوع الاتصال</span>
              <Select value={form.interface_type} onValueChange={(v: PrinterInterface | null) => v && setForm((p) => ({ ...p, interface_type: v }))}>
                <SelectTrigger className="h-9 w-full rounded-lg text-right">
                  <SelectValue>{interfaceLabels[form.interface_type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {interfaceOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {interfaceLabels[opt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">نوع الطابعة</span>
              <Select value={form.printer_type} onValueChange={(v: PrinterType | null) => v && setForm((p) => ({ ...p, printer_type: v }))}>
                <SelectTrigger className="h-9 w-full rounded-lg text-right">
                  <SelectValue>{printerTypeLabels[form.printer_type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {printerTypeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {printerTypeLabels[opt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.interface_type === "network" || form.interface_type === "wifi" ? (
              <div className="grid gap-1.5 text-right">
                <span className="text-xs font-black text-slate-700">عنوان IP</span>
                <Input value={form.ip_address} onChange={(e) => setForm((p) => ({ ...p, ip_address: e.target.value }))} placeholder="192.168.1.100" className="h-9 rounded-lg" />
              </div>
            ) : null}
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">المنفذ</span>
              <Input type="number" value={form.port} onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">عرض الورق (مم)</span>
              <Select value={String(form.paper_width)} onValueChange={(v) => setForm((p) => ({ ...p, paper_width: Number(v) }))}>
                <SelectTrigger className="h-9 w-full rounded-lg text-right">
                  <SelectValue>{`${form.paper_width} مم`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {paperWidthOptions.map((opt) => (
                    <SelectItem key={opt} value={String(opt)}>
                      {opt} مم
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-right">
              <span className="text-xs font-black text-slate-700">عدد الأحرف في السطر</span>
              <Input type="number" value={form.characters_per_line} onChange={(e) => setForm((p) => ({ ...p, characters_per_line: Number(e.target.value) }))} className="h-9 rounded-lg" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-right sm:col-span-2">
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm((p) => ({ ...p, is_default: v }))} />
              <span className="text-sm font-bold text-slate-800">طابعة افتراضية</span>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button variant="default" size="sm" onClick={handleSubmit} disabled={saving}>
                {saving ? "جاري الحفظ…" : editingId ? "تحديث" : "إضافة"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetForm}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {printers.length === 0 ? (
          <Card className="col-span-full rounded-xl border-slate-200 bg-white py-8 text-center shadow-sm sm:col-span-2 xl:col-span-3">
            <Printer className="mx-auto mb-2 size-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">لا توجد طابعات بعد</p>
            {canWritePrinters ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { resetForm(); setShowForm(true) }}>
                <Plus className="size-4" />
                إضافة طابعة
              </Button>
            ) : null}
          </Card>
        ) : printers.map((printer) => {
          const Icon = interfaceIcons[printer.interface_type]
          return (
            <Card key={printer.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                      <Printer className="size-5" />
                    </span>
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">{printer.name}</span>
                        {printer.is_default ? (
                          <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[10px] font-black text-brand">افتراضي</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">{printerTypeLabels[printer.printer_type]} · {printer.paper_width} مم</p>
                    </div>
                  </div>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5">
                    <Icon className="size-3" />
                    {interfaceLabels[printer.interface_type]}
                  </span>
                  {printer.interface_type === "network" || printer.interface_type === "wifi" ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5">{printer.ip_address}:{printer.port}</span>
                  ) : (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5">المنفذ {printer.port}</span>
                  )}
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">{printer.characters_per_line} حرف/سطر</span>
                </div>
                {canWritePrinters ? (
                  <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
                    <Button variant="ghost" size="icon-xs" onClick={() => startEdit(printer)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    {!printer.is_default ? (
                      <>
                        <Button variant="ghost" size="icon-xs" onClick={() => setAsDefault(printer.id)}>
                          <Monitor className="size-3.5 text-brand" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(printer.id, printer.is_default)}>
                          <Trash2 className="size-3.5 text-red-500" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function PrintersPage() {
  return (
    <SettingsLayout>
      <PrintersContent />
    </SettingsLayout>
  )
}
