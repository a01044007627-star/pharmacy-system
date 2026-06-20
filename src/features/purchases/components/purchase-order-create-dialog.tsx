"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/lib/http/api-client"

export type PurchaseOrderLineDraft = {
  key: string
  item_id: string
  item_name: string
  unit: string
  quantity_mode: string
  quantity_scale: number
  quantity: string
  buy_price: string
  sell_price: string
  discount: string
  notes: string
}

type CreateOrderResponse = {
  order?: { id: string; order_number: string }
}

type PurchaseBootstrapItem = {
  id: string
  name_ar: string
  sku?: string | null
  unit?: string | null
  buy_price?: number | null
  sell_price?: number | null
  quantity_mode?: string | null
  quantity_scale?: number | null
}

type PurchaseBootstrapSupplier = {
  id: string
  name: string
}

type PurchaseBootstrapResponse = {
  items?: PurchaseBootstrapItem[]
  suppliers?: PurchaseBootstrapSupplier[]
}


function createLine(): PurchaseOrderLineDraft {
  return {
    key: crypto.randomUUID(),
    item_id: "",
    item_name: "",
    unit: "وحدة",
    quantity_mode: "discrete",
    quantity_scale: 0,
    quantity: "1",
    buy_price: "0",
    sell_price: "0",
    discount: "0",
    notes: "",
  }
}

function numberValue(value: string) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : 0
}

export function PurchaseOrderCreateDialog({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [supplierId, setSupplierId] = useState("")
  const [supplierName, setSupplierName] = useState("")
  const [items, setItems] = useState<PurchaseBootstrapItem[]>([])
  const [suppliers, setSuppliers] = useState<PurchaseBootstrapSupplier[]>([])
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  const [expectedDate, setExpectedDate] = useState("")
  const [notes, setNotes] = useState("")
  const [sendImmediately, setSendImmediately] = useState(false)
  const [lines, setLines] = useState<PurchaseOrderLineDraft[]>([createLine()])

  useEffect(() => {
    if (!open || !auth.activePharmacyId) return
    let active = true
    setBootstrapLoading(true)
    void apiClient.get<PurchaseBootstrapResponse>("/api/purchases", {
      query: {
        bootstrap: 1,
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId ?? "all",
      },
      fallbackMessage: "فشل تحميل أصناف وموردي أمر الشراء",
      timeoutMs: 25000,
    }).then((data) => {
      if (!active) return
      setItems(data.items ?? [])
      setSuppliers(data.suppliers ?? [])
    }).catch((error) => {
      if (active) toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات أمر الشراء")
    }).finally(() => {
      if (active) setBootstrapLoading(false)
    })
    return () => { active = false }
  }, [auth.activeBranchId, auth.activePharmacyId, open])

  const total = useMemo(() => lines.reduce((sum, line) => {
    const gross = numberValue(line.quantity) * numberValue(line.buy_price)
    return sum + Math.max(0, gross - numberValue(line.discount))
  }, 0), [lines])

  function reset() {
    setSupplierId("")
    setSupplierName("")
    setExpectedDate("")
    setNotes("")
    setSendImmediately(false)
    setLines([createLine()])
  }

  function updateLine(key: string, field: "unit" | "quantity" | "buy_price" | "sell_price" | "discount" | "notes", value: string) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line))
  }

  function selectItem(key: string, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId)
    setLines((current) => current.map((line) => line.key === key ? {
      ...line,
      item_id: item?.id ?? "",
      item_name: item?.name_ar ?? "",
      unit: item?.unit || "وحدة",
      quantity_mode: item?.quantity_mode || "discrete",
      quantity_scale: Number(item?.quantity_scale ?? 0),
      buy_price: String(Number(item?.buy_price ?? 0)),
      sell_price: String(Number(item?.sell_price ?? 0)),
    } : line))
  }

  function removeLine(key: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.key !== key))
  }

  async function submit() {
    if (!auth.activePharmacyId) {
      toast.error("اختر الصيدلية أولًا")
      return
    }
    if (!supplierName.trim()) {
      toast.error("أدخل اسم المورد")
      return
    }
    const invalidLine = lines.findIndex((line) => !line.item_id || !line.item_name.trim() || numberValue(line.quantity) <= 0)
    if (invalidLine >= 0) {
      toast.error(`أكمل بيانات الصنف في السطر ${invalidLine + 1}`)
      return
    }

    setSaving(true)
    try {
      const response = await apiClient.post<CreateOrderResponse>("/api/purchases/orders", {
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId,
        supplier_id: supplierId || null,
        supplier_name: supplierName.trim(),
        expected_date: expectedDate || null,
        notes: notes.trim() || null,
        send_immediately: sendImmediately,
        lines: lines.map((line) => ({
          item_id: line.item_id,
          item_name: line.item_name.trim(),
          unit: line.unit.trim() || "وحدة",
          quantity_mode: line.quantity_mode,
          quantity_scale: line.quantity_scale,
          quantity: numberValue(line.quantity),
          buy_price: numberValue(line.buy_price),
          sell_price: numberValue(line.sell_price),
          discount: numberValue(line.discount),
          notes: line.notes.trim() || null,
        })),
      }, { fallbackMessage: "فشل إنشاء أمر الشراء", timeoutMs: 25000 })
      toast.success(`تم إنشاء أمر الشراء ${response.order?.order_number ?? ""}`.trim())
      setOpen(false)
      reset()
      await onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إنشاء أمر الشراء")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value && !saving) reset() }}>
      <DialogTrigger render={
        <Button className="h-10 rounded-xl" disabled={!auth.isDeveloper && !auth.can("purchases:write")}>
          <Plus className="size-4" /> أمر شراء جديد
        </Button>
      } />
      <DialogContent dir="rtl" className="max-h-[90vh] w-[min(980px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-3xl text-right">
        <DialogHeader><DialogTitle className="text-xl font-black">إنشاء أمر شراء</DialogTitle></DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="font-black">المورد</Label>
            <NativeSelect value={supplierId} onChange={(event) => {
              const id = event.target.value
              const supplier = suppliers.find((candidate) => candidate.id === id)
              setSupplierId(id)
              setSupplierName(supplier?.name ?? "")
            }} disabled={bootstrapLoading}>
              <NativeSelectOption value="">مورد جديد أو غير مسجل</NativeSelectOption>
              {suppliers.map((supplier) => <NativeSelectOption key={supplier.id} value={supplier.id}>{supplier.name}</NativeSelectOption>)}
            </NativeSelect>
            <Input value={supplierName} onChange={(event) => { setSupplierName(event.target.value); if (supplierId) setSupplierId("") }} placeholder="اسم المورد" className="mt-2 h-10 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-black">تاريخ التوريد المتوقع</Label>
            <Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="h-11 rounded-xl" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-black">أصناف الأمر</p>
              <p className="text-xs font-bold text-slate-500">الوحدات المعدودة مثل الحبة والحقنة لا تقبل كسورًا، والتحقق النهائي يتم على الخادم.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setLines((current) => [...current, createLine()])}>
              <Plus className="size-4" /> إضافة سطر
            </Button>
          </div>

          {lines.map((line, index) => (
            <div key={line.key} className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[1.7fr_.7fr_.6fr_.8fr_.8fr_.7fr_auto]">
              <div className="space-y-1"><Label className="text-xs font-black">الصنف {index + 1}</Label><NativeSelect value={line.item_id} onChange={(event) => selectItem(line.key, event.target.value)} disabled={bootstrapLoading}><NativeSelectOption value="">اختر الصنف</NativeSelectOption>{items.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name_ar}{item.sku ? ` — ${item.sku}` : ""}</NativeSelectOption>)}</NativeSelect></div>
              <div className="space-y-1"><Label className="text-xs font-black">الوحدة</Label><Input value={line.unit} onChange={(event) => updateLine(line.key, "unit", event.target.value)} className="h-10 rounded-xl" /></div>
              <div className="space-y-1"><Label className="text-xs font-black">الكمية</Label><Input type="number" min="0" step={line.quantity_mode === "continuous" ? 10 ** -Math.max(1, line.quantity_scale) : 1} inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} className="h-10 rounded-xl text-center" /></div>
              <div className="space-y-1"><Label className="text-xs font-black">سعر الشراء</Label><Input type="number" min="0" step="0.01" value={line.buy_price} onChange={(event) => updateLine(line.key, "buy_price", event.target.value)} className="h-10 rounded-xl text-center" /></div>
              <div className="space-y-1"><Label className="text-xs font-black">سعر البيع</Label><Input type="number" min="0" step="0.01" value={line.sell_price} onChange={(event) => updateLine(line.key, "sell_price", event.target.value)} className="h-10 rounded-xl text-center" /></div>
              <div className="space-y-1"><Label className="text-xs font-black">الخصم</Label><Input type="number" min="0" step="0.01" value={line.discount} onChange={(event) => updateLine(line.key, "discount", event.target.value)} className="h-10 rounded-xl text-center" /></div>
              <div className="flex items-end"><Button type="button" variant="ghost" size="icon" className="rounded-xl text-rose-600" disabled={lines.length === 1} onClick={() => removeLine(line.key)} aria-label="حذف السطر"><Trash2 className="size-4" /></Button></div>
              <div className="space-y-1 md:col-span-7"><Label className="text-xs font-black">ملاحظات السطر</Label><Input value={line.notes} onChange={(event) => updateLine(line.key, "notes", event.target.value)} placeholder="اختياري" className="h-9 rounded-xl" /></div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5"><Label className="font-black">ملاحظات عامة</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 rounded-xl" /></div>
          <label className="flex min-w-52 items-center gap-2 self-end rounded-2xl border border-slate-200 p-3 text-sm font-black">
            <input type="checkbox" checked={sendImmediately} onChange={(event) => setSendImmediately(event.target.checked)} /> إرسال للمورد مباشرة
          </label>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-left font-black" dir="ltr">
          الإجمالي المبدئي: {total.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ الأمر
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
