"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Edit, Loader2, Package } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { money, numberValue, statusLabel, unitCountLabel, unitEquationLabel } from "@/features/inventory/lib/items-helpers"

type DetailResponse = {
  item?: PharmacyItemListRow
  barcodes?: Array<{ id?: string; barcode: string; is_primary?: boolean | null }>
  units?: Array<{ id?: string; unit_name: string; factor?: number | string | null; barcode?: string | null; sell_price?: number | string | null }>
  variants?: Array<{ id?: string; name?: string | null; value?: string | null; sku?: string | null; sell_price?: number | string | null }>
  error?: string
}

export function ItemDetailView({ itemId }: { itemId: string }) {
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch(`/api/items/${itemId}`, { cache: "no-store" })
        const payload = await response.json().catch(() => ({})) as DetailResponse
        if (!response.ok) throw new Error(payload.error ?? "فشل تحميل الصنف")
        if (!cancelled) setData(payload)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل تحميل الصنف")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [itemId])

  const item = data?.item

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title={item?.name_ar ?? "كرت الصنف"}
          subtitle="عرض سريع لكل بيانات الصنف المحفوظة من الشاشة أو ملف Excel."
          icon={Package}
          actions={(
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/items" />}><ArrowRight className="size-4" /> الأصناف</Button>
              <Button className="h-10 rounded-xl" render={<Link href={`/dashboard/items/${itemId}/edit`} />}><Edit className="size-4" /> تعديل</Button>
            </div>
          )}
        />

        {loading ? <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center font-black text-slate-500"><Loader2 className="mx-auto mb-3 size-6 animate-spin" /> جاري التحميل...</div> : null}
        {!loading && !item ? <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 font-black text-rose-700">الصنف غير موجود</div> : null}

        {item ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">البيانات الأساسية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                <Info label="الاسم" value={item.name_ar} />
                <Info label="SKU" value={item.sku ?? "—"} ltr />
                <Info label="المجموعة" value={item.group?.name ?? item.category ?? "—"} />
                <Info label="المجموعة الفرعية" value={item.sub_category ?? "—"} />
                <Info label="الماركة" value={item.brand?.name ?? "—"} />
                <Info label="وحدة البيع" value={item.unit ?? "—"} />
                <Info label="معادلة الوحدة" value={unitEquationLabel(item)} />
                <Info label="عدد الفرعية داخل الرئيسية" value={unitCountLabel(item)} />
                <Info label="نوع المنتج" value={item.product_type === "variable" ? "متغير" : "مفرد"} />
                <Info label="الحالة" value={statusLabel(item.status)} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">الأسعار والمخزون</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-1">
                <Info label="سعر البيع" value={`${money(item.sell_price)} ج.م`} />
                <Info label="سعر الشراء" value={`${money(item.buy_price)} ج.م`} />
                <Info label="هامش الربح" value={numberValue(item.profit_margin) ? `${numberValue(item.profit_margin)}%` : "—"} />
                <Info label="الضريبة" value={item.tax_name ? `${item.tax_name}${numberValue(item.tax_percent) ? ` (${numberValue(item.tax_percent)}%)` : ""}` : "—"} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">بيانات Excel التشغيلية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                <Info label="المكان" value={[item.rack, item.shelf_row, item.position].filter(Boolean).join(" / ") || "—"} ltr />
                <Info label="الوزن" value={numberValue(item.weight) ? String(numberValue(item.weight)) : "—"} />
                <Info label="تتبع Serial/IMEI" value={item.serial_tracking_enabled ? "نعم" : "لا"} />
                <Info label="نوع ضريبة البيع" value={item.selling_price_tax_type ?? "—"} />
                <Info label="حقل مخصص 1" value={item.custom_field_1 ?? "—"} />
                <Info label="حقل مخصص 2" value={item.custom_field_2 ?? "—"} />
                <Info label="حقل مخصص 3" value={item.custom_field_3 ?? "—"} />
                <Info label="حقل مخصص 4" value={item.custom_field_4 ?? "—"} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">الباركودات والمتغيرات</CardTitle></CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap gap-2">{(data?.barcodes ?? []).length ? data?.barcodes?.map((barcode) => <Badge key={barcode.id ?? barcode.barcode} variant="outline" className="bg-slate-50 font-mono text-slate-700" dir="ltr">{barcode.barcode}</Badge>) : <span className="text-sm font-bold text-slate-400">لا يوجد باركودات</span>}</div>
                <div className="flex flex-wrap gap-2">{(data?.variants ?? []).length ? data?.variants?.map((variant) => <Badge key={variant.id ?? `${variant.name}-${variant.value}`} variant="outline" className="bg-indigo-50 text-indigo-700">{variant.name}: {variant.value}{variant.sku ? ` / ${variant.sku}` : ""}</Badge>) : <span className="text-sm font-bold text-slate-400">لا يوجد متغيرات</span>}</div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </section>
    </PageAccess>
  )
}

function Info({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 font-black text-slate-900" dir={ltr ? "ltr" : "rtl"}>{value}</div>
    </div>
  )
}
