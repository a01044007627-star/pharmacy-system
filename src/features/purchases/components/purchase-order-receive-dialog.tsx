"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Package } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/lib/http/api-client"

export type PurchaseOrderLine = {
  item_id: string
  item_name?: string | null
  unit?: string | null
  quantity: number
  received_quantity?: number | null
  quantity_mode?: string | null
  quantity_scale?: number | null
  buy_price?: number | null
  sell_price?: number | null
  track_batch?: boolean | null
  has_expiry?: boolean | null
  discount?: number | null
}

export type ReceivablePurchaseOrder = {
  id: string
  order_number: string
  status: string
  lines?: PurchaseOrderLine[] | null
}

type ReceiptLineDraft = Omit<PurchaseOrderLine, "sell_price"> & {
  receive_quantity: string
  sell_price: string
  batch_number: string
  expiry_date: string
}

function remaining(line: { quantity: number; received_quantity?: number | null }) {
  return Math.max(0, Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0))
}

function createDraftLines(order: ReceivablePurchaseOrder): ReceiptLineDraft[] {
  return (order.lines ?? []).filter((line) => remaining(line) > 0).map((line) => ({
    ...line,
    receive_quantity: String(remaining(line)),
    sell_price: String(Number(line.sell_price ?? 0)),
    batch_number: "",
    expiry_date: "",
  }))
}

export function PurchaseOrderReceiveDialog({
  order,
  onReceived,
}: {
  order: ReceivablePurchaseOrder
  onReceived: () => void | Promise<void>
}) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [lines, setLines] = useState<ReceiptLineDraft[]>(() => createDraftLines(order))
  const [paymentMethod, setPaymentMethod] = useState("credit")
  const [paidAmount, setPaidAmount] = useState("0")
  const [headerDiscount, setHeaderDiscount] = useState("0")
  const [taxTotal, setTaxTotal] = useState("0")
  const [shippingFee, setShippingFee] = useState("0")
  const [notes, setNotes] = useState("")
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (!open) return
    setLines(createDraftLines(order))
  }, [open, order])

  const selectedLines = useMemo(() => lines.filter((line) => Number(line.receive_quantity) > 0), [lines])

  function updateLine(itemId: string, field: "receive_quantity" | "sell_price" | "batch_number" | "expiry_date", value: string) {
    setLines((current) => current.map((line) => line.item_id === itemId ? { ...line, [field]: value } : line))
  }

  function reset() {
    setRequestId(crypto.randomUUID())
    setLines(createDraftLines(order))
    setPaymentMethod("credit")
    setPaidAmount("0")
    setHeaderDiscount("0")
    setTaxTotal("0")
    setShippingFee("0")
    setNotes("")
    setPurchaseDate(new Date().toISOString().slice(0, 10))
  }

  async function receive() {
    if (!auth.activePharmacyId) return
    if (selectedLines.length === 0) {
      toast.error("حدد كمية واحدة على الأقل للاستلام")
      return
    }
    const invalid = selectedLines.find((line) => Number(line.receive_quantity) > remaining(line))
    if (invalid) {
      toast.error(`الكمية المستلمة أكبر من المتبقي للصنف ${invalid.item_name ?? ""}`)
      return
    }
    const missingExpiry = selectedLines.find((line) => line.has_expiry && !line.expiry_date)
    if (missingExpiry) {
      toast.error(`تاريخ الصلاحية مطلوب للصنف ${missingExpiry.item_name ?? ""}`)
      return
    }

    setSaving(true)
    try {
      await apiClient.post(`/api/purchases/orders/${order.id}/receive`, {
        pharmacy_id: auth.activePharmacyId,
        branch_id: auth.activeBranchId,
        client_request_id: requestId,
        payment_method: paymentMethod,
        paid_amount: Number(paidAmount) || 0,
        header_discount: Number(headerDiscount) || 0,
        tax_total: Number(taxTotal) || 0,
        shipping_fee: Number(shippingFee) || 0,
        notes: notes.trim() || null,
        purchase_date: new Date(`${purchaseDate}T12:00:00`).toISOString(),
        lines: selectedLines.map((line) => ({
          item_id: line.item_id,
          item_name: line.item_name,
          unit: line.unit,
          quantity_mode: line.quantity_mode,
          quantity_scale: line.quantity_scale,
          quantity: Number(line.receive_quantity),
          buy_price: Number(line.buy_price ?? 0),
          sell_price: Number(line.sell_price) || 0,
          discount: 0,
          batch_number: line.batch_number.trim() || null,
          expiry_date: line.expiry_date || null,
        })),
      }, { fallbackMessage: "فشل استلام أمر الشراء", timeoutMs: 60000 })
      toast.success("تم تسجيل الاستلام وتحديث المخزون والحسابات")
      setOpen(false)
      reset()
      await onReceived()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل استلام أمر الشراء")
    } finally {
      setSaving(false)
    }
  }

  const canReceive = ["sent", "partial"].includes(order.status) && selectedLines.length > 0

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value && !saving) reset() }}>
      <DialogTrigger render={
        <Button size="sm" variant="outline" className="h-8 rounded-xl border-emerald-200 text-emerald-700" disabled={!canReceive}>
          <Package className="size-3.5" /> استلام
        </Button>
      } />
      <DialogContent dir="rtl" className="max-h-[92vh] w-[min(1050px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-3xl text-right">
        <DialogHeader><DialogTitle className="font-black">استلام أمر الشراء {order.order_number}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          {lines.map((line) => {
            const maxQuantity = remaining(line)
            const step = line.quantity_mode === "continuous" ? 10 ** -Math.max(1, Number(line.quantity_scale ?? 3)) : 1
            return (
              <div key={line.item_id} className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[1.5fr_.6fr_.7fr_.7fr_.8fr_.8fr]">
                <div><p className="font-black">{line.item_name ?? "صنف"}</p><p className="text-xs font-bold text-slate-500">المطلوب {Number(line.quantity).toLocaleString("ar-EG")} — تم {Number(line.received_quantity ?? 0).toLocaleString("ar-EG")} — المتبقي {maxQuantity.toLocaleString("ar-EG")}</p></div>
                <div className="space-y-1"><Label className="text-xs font-black">الوحدة</Label><Input value={line.unit ?? "وحدة"} readOnly className="h-10 rounded-xl bg-slate-50" /></div>
                <div className="space-y-1"><Label className="text-xs font-black">كمية الاستلام</Label><Input type="number" min="0" max={maxQuantity} step={step} value={line.receive_quantity} onChange={(event) => updateLine(line.item_id, "receive_quantity", event.target.value)} className="h-10 rounded-xl" /></div>
                <div className="space-y-1"><Label className="text-xs font-black">سعر البيع</Label><Input type="number" min="0" step="0.01" value={line.sell_price} onChange={(event) => updateLine(line.item_id, "sell_price", event.target.value)} className="h-10 rounded-xl" /></div>
                <div className="space-y-1"><Label className="text-xs font-black">رقم التشغيلة{line.track_batch ? " *" : ""}</Label><Input value={line.batch_number} onChange={(event) => updateLine(line.item_id, "batch_number", event.target.value)} className="h-10 rounded-xl" /></div>
                <div className="space-y-1"><Label className="text-xs font-black">الصلاحية{line.has_expiry ? " *" : ""}</Label><Input type="date" required={line.has_expiry === true} value={line.expiry_date} onChange={(event) => updateLine(line.item_id, "expiry_date", event.target.value)} className="h-10 rounded-xl" /></div>
              </div>
            )
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5"><Label className="font-black">طريقة الدفع</Label><NativeSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><NativeSelectOption value="credit">آجل</NativeSelectOption><NativeSelectOption value="cash">نقدي</NativeSelectOption><NativeSelectOption value="bank">تحويل بنكي</NativeSelectOption></NativeSelect></div>
          <div className="space-y-1.5"><Label className="font-black">المدفوع</Label><Input type="number" min="0" step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">تاريخ الاستلام</Label><Input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">خصم إضافي</Label><Input type="number" min="0" step="0.01" value={headerDiscount} onChange={(event) => setHeaderDiscount(event.target.value)} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">الضريبة</Label><Input type="number" min="0" step="0.01" value={taxTotal} onChange={(event) => setTaxTotal(event.target.value)} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5"><Label className="font-black">الشحن</Label><Input type="number" min="0" step="0.01" value={shippingFee} onChange={(event) => setShippingFee(event.target.value)} className="h-11 rounded-xl" /></div>
          <div className="space-y-1.5 md:col-span-3"><Label className="font-black">ملاحظات الاستلام</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 rounded-xl" /></div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="rounded-xl" disabled={saving || !canReceive} onClick={() => void receive()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />} تأكيد الاستلام
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
