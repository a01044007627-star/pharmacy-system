"use client"

import { useEffect, useState } from "react"
import { Loader2, Settings } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/lib/http/api-client"

export type ShippingOrderEditModel = {
  id: string
  status: string
  delivery_agent_name?: string | null
  delivery_notes?: string | null
  failure_reason?: string | null
  proof_of_delivery_url?: string | null
  collected_amount?: number | null
  allowed_statuses?: string[]
}

type StatusOption = { value: string; label: string }

export function ShippingOrderUpdateDialog({
  order,
  statuses,
  onUpdated,
}: {
  order: ShippingOrderEditModel
  statuses: StatusOption[]
  onUpdated: () => void | Promise<void>
}) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(order.status)
  const [agentName, setAgentName] = useState(order.delivery_agent_name ?? "")
  const [notes, setNotes] = useState(order.delivery_notes ?? "")
  const [failureReason, setFailureReason] = useState(order.failure_reason ?? "")
  const [proofUrl, setProofUrl] = useState(order.proof_of_delivery_url ?? "")
  const [collectedAmount, setCollectedAmount] = useState(String(order.collected_amount ?? 0))

  useEffect(() => {
    if (!open) return
    setStatus(order.status)
    setAgentName(order.delivery_agent_name ?? "")
    setNotes(order.delivery_notes ?? "")
    setFailureReason(order.failure_reason ?? "")
    setProofUrl(order.proof_of_delivery_url ?? "")
    setCollectedAmount(String(order.collected_amount ?? 0))
  }, [open, order])

  const selectableStatuses = statuses.filter((option) => (
    option.value === order.status || (order.allowed_statuses ?? []).includes(option.value)
  ))

  async function save() {
    setSaving(true)
    try {
      await apiClient.patch("/api/sales/shipping", {
        id: order.id,
        pharmacy_id: auth.activePharmacyId,
        status,
        delivery_agent_name: agentName.trim() || null,
        delivery_notes: notes.trim() || null,
        failure_reason: failureReason.trim() || null,
        proof_of_delivery_url: proofUrl.trim() || null,
        collected_amount: Number(collectedAmount) || 0,
      }, { fallbackMessage: "فشل تحديث طلب التوصيل", timeoutMs: 25000 })
      toast.success("تم تحديث طلب التوصيل")
      setOpen(false)
      await onUpdated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث طلب التوصيل")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" variant="outline" className="h-8 rounded-xl">
          <Settings className="size-3.5" /> إدارة
        </Button>
      } />
      <DialogContent dir="rtl" className="w-[min(680px,calc(100vw-2rem))] max-w-none rounded-3xl text-right">
        <DialogHeader><DialogTitle className="font-black">تحديث عملية التوصيل</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="font-black">الحالة التالية</Label>
            <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
              {selectableStatuses.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="font-black">اسم مندوب التوصيل</Label>
            <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-black">المبلغ المحصل</Label>
            <Input type="number" min="0" step="0.01" value={collectedAmount} onChange={(event) => setCollectedAmount(event.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-black">رابط إثبات التسليم</Label>
            <Input value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="اختياري" className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="font-black">ملاحظات التوصيل</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 rounded-xl" />
          </div>
          {(status === "cancelled" || status === "returned") ? (
            <div className="space-y-1.5 md:col-span-2">
              <Label className="font-black">سبب الإلغاء أو الارتجاع</Label>
              <Textarea value={failureReason} onChange={(event) => setFailureReason(event.target.value)} className="min-h-20 rounded-xl" />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="rounded-xl" disabled={saving || selectableStatuses.length === 0} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
