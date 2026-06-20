"use client"

import { useEffect, useState } from "react"
import { Loader2, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { apiClient } from "@/lib/http/api-client"

export type PayrollAdjustmentLine = {
  id: string
  employee_name: string
  regular_pay: number
  additions: number
  deductions: number
  gross_salary: number
  net_salary: number
  notes: string | null
}

type Props = {
  pharmacyId: string
  runId: string
  line: PayrollAdjustmentLine
  currency: string
  onSaved: () => void | Promise<void>
}

export function PayrollLineAdjustmentDialog({ pharmacyId, runId, line, currency, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [additions, setAdditions] = useState(String(line.additions ?? 0))
  const [deductions, setDeductions] = useState(String(line.deductions ?? 0))
  const [notes, setNotes] = useState(line.notes ?? "")

  useEffect(() => {
    if (!open) return
    setAdditions(String(line.additions ?? 0))
    setDeductions(String(line.deductions ?? 0))
    setNotes(line.notes ?? "")
  }, [line, open])

  async function save() {
    setSaving(true)
    try {
      await apiClient.patch("/api/hr/payroll", {
        action: "update-line",
        pharmacy_id: pharmacyId,
        run_id: runId,
        line_id: line.id,
        additions: Number(additions) || 0,
        deductions: Number(deductions) || 0,
        notes,
      }, { fallbackMessage: "فشل تعديل بند الراتب" })
      toast.success("تم تحديث البدلات والخصومات")
      setOpen(false)
      await onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تعديل بند الراتب")
    } finally {
      setSaving(false)
    }
  }

  const gross = Math.max(0, Number(line.regular_pay ?? 0) + Math.max(0, Number(additions) || 0))
  const net = Math.max(0, gross - Math.max(0, Number(deductions) || 0))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" variant="outline" className="h-8 rounded-xl">
          <SlidersHorizontal className="size-3.5" /> تعديل
        </Button>
      } />
      <DialogContent dir="rtl" className="w-[min(560px,calc(100vw-2rem))] max-w-none rounded-3xl text-right">
        <DialogHeader><DialogTitle className="font-black">بدلات وخصومات {line.employee_name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-black text-slate-700">البدلات والإضافات</label>
            <Input type="number" min="0" step="0.01" value={additions} onChange={(event) => setAdditions(event.target.value)} className="h-11 rounded-xl" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-black text-slate-700">الخصومات</label>
            <Input type="number" min="0" step="0.01" value={deductions} onChange={(event) => setDeductions(event.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-black text-slate-700">ملاحظات البند</label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-11 rounded-xl" placeholder="سبب البدل أو الخصم..." />
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-sm font-black text-slate-700">الإجمالي: {gross.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} {currency}</div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-sm font-black text-emerald-700">الصافي: {net.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} {currency}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="rounded-xl" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <SlidersHorizontal className="size-4" />} حفظ التعديل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
