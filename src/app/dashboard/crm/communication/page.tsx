"use client"

import { useState } from "react"
import { MessageSquare } from "lucide-react"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Card, CardContent } from "@/components/ui/card"

type MessageRow = {
  id: string
  partner: string
  type: string
  subject: string
  date: string
  status: string
}

const placeholderMessages: MessageRow[] = [
  { id: "1", partner: "أحمد علي", type: "بريد إلكتروني", subject: "تأكيد طلب شراء", date: "2026-06-15", status: "مرسل" },
  { id: "2", partner: "شركة الأدوية الحديثة", type: "واتساب", subject: "استفسار عن سعر", date: "2026-06-14", status: "مقروء" },
  { id: "3", partner: "محمد كريم", type: "مكالمة", subject: "متابعة فاتورة", date: "2026-06-13", status: "تم" },
  { id: "4", partner: "صيدلية السلام", type: "بريد إلكتروني", subject: "عرض أسعار", date: "2026-06-12", status: "مسودة" },
]

export default function CommunicationPage() {
  return (
    <PageAccess permission="crm:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title="سجل التواصل"
          subtitle="قيد التطوير — سيتم ربطه بواجهة التواصل الفعلية."
          icon={MessageSquare}
        />

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="space-y-3">
              {placeholderMessages.map((msg) => (
                <div key={msg.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <div>
                    <p className="font-black text-slate-950">{msg.partner}</p>
                    <p className="mt-0.5 text-sm font-bold text-slate-500">{msg.subject}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">{msg.type} — {msg.date}</p>
                  </div>
                  <span className="rounded-lg bg-brand/10 px-3 py-1 text-xs font-black text-brand">{msg.status}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </PageAccess>
  )
}
