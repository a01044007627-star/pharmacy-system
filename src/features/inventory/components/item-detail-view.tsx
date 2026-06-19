"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Edit, ExternalLink, Loader2, Package, ShieldCheck, GitFork } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { money, numberValue, statusLabel, unitCountLabel, unitEquationLabel } from "@/features/inventory/lib/items-helpers"

type DetailResponse = {
  item?: PharmacyItemListRow
  barcodes?: Array<{ id?: string; barcode: string; is_primary?: boolean | null }>
  units?: Array<{ id?: string; unit_name: string; factor?: number | string | null; barcode?: string | null; sell_price?: number | string | null }>
  variants?: Array<{ id?: string; name?: string | null; value?: string | null; sku?: string | null; sell_price?: number | string | null }>
  error?: string
}

type MovementRow = {
  id: string
  direction: string
  quantity: number
  unit_price: number
  total_value: number
  movement_type: string
  source_table: string | null
  created_at: string
  pharmacy_item_batches?: { batch_number?: string | null; expiry_date?: string | null } | null
}

export function ItemDetailView({ itemId }: { itemId: string }) {
  const [data, setData] = useState<DetailResponse | null>(null)
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [showMovements, setShowMovements] = useState(false)

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

  useEffect(() => {
    if (!showMovements || !itemId) return
    setMovementsLoading(true)
    async function load() {
      try {
        const res = await fetch(`/api/inventory/items/stock-movements?item_id=${itemId}`, { cache: "no-store" })
        const data = await res.json()
        if (res.ok) setMovements(data.movements ?? [])
      } catch { /* ignore */ }
      finally { setMovementsLoading(false) }
    }
    void load()
  }, [showMovements, itemId])

  const item = data?.item

  const movementTypeLabels: Record<string, string> = {
    purchase: "مشتريات", sale: "مبيعات", sales_return: "مرتجع بيع", purchase_return: "مرتجع مشتريات",
    purchase_void: "إلغاء مشتريات", sale_void: "إلغاء بيع", stock_transfer_in: "تحويل ورد",
    stock_transfer_out: "تحويل صادر", stock_count_adjustment: "تسوية جرد", adjustment: "تسوية",
    opening_stock: "رصيد افتتاحي", damaged: "هالك وتالف",
  }

  return (
    <PageAccess permission="inventory:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader
          title={item?.name_ar ?? "كرت الصنف"}
          subtitle="عرض سريع لكل بيانات الصنف المحفوظة من الشاشة أو ملف Excel."
          icon={Package}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/items" />}><ArrowRight className="size-4" /> الأصناف</Button>
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href={`/dashboard/items/variants`} />}><GitFork className="size-4" /> المتغيرات</Button>
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href={`/dashboard/items/warranties`} />}><ShieldCheck className="size-4" /> الضمانات</Button>
              <Button className="h-10 rounded-xl" render={<Link href={`/dashboard/items/${itemId}/edit`} />}><Edit className="size-4" /> تعديل</Button>
            </div>
          }
        />

        {loading ? <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center font-black text-slate-500"><Loader2 className="mx-auto mb-3 size-6 animate-spin" /> جاري التحميل...</div> : null}
        {!loading && !item ? <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 font-black text-rose-700">الصنف غير موجود</div> : null}

        {item ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">البيانات الأساسية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                <Info label="الاسم" value={item.name_ar} />
                <Info label="الاسم بالإنجليزية" value={item.name_en ?? "—"} />
                <Info label="SKU" value={item.sku ?? "—"} ltr />
                <Info label="المجموعة" value={item.group?.name ?? item.category ?? "—"} />
                <Info label="المجموعة الفرعية" value={item.sub_category ?? "—"} />
                <Info label="الماركة" value={item.brand?.name ?? "—"} />
                <Info label="الشركة المصنعة" value={item.manufacturer_name ?? "—"} />
                <Info label="وحدة البيع" value={item.unit ?? "—"} />
                <Info label="معادلة الوحدة" value={unitEquationLabel(item)} />
                <Info label="عدد الفرعية داخل الرئيسية" value={unitCountLabel(item)} />
                <Info label="نوع الصنف" value={item.item_type === "stocked" ? "مخزني" : item.item_type === "service" ? "خدمة" : item.item_type === "digital" ? "رقمي" : "عهدة"} />
                <Info label="نوع المنتج" value={item.product_type === "variable" ? "متغير" : "مفرد"} />
                <Info label="متابعة مخزون" value={item.manage_inventory ? "نعم" : "لا"} />
                <Info label="غير مخصص للبيع" value={item.not_for_sale ? "نعم" : "لا"} />
                <Info label="محدود / مراقب" value={item.is_controlled ? "نعم" : "لا"} />
                <Info label="يتطلب روشتة" value={item.requires_prescription ? "نعم" : "لا"} />
                <Info label="الحالة" value={statusLabel(item.status)} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">الأسعار والمخزون</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-1">
                <Info label="سعر البيع" value={`${money(item.sell_price)} ج.م`} />
                <Info label="سعر البيع القديم" value={numberValue(item.old_sell_price) ? `${money(item.old_sell_price)} ج.م` : "—"} />
                <Info label="سعر الشراء" value={`${money(item.buy_price)} ج.م`} />
                <Info label="سعر الشراء شامل الضريبة" value={numberValue(item.purchase_price_including_tax) ? `${money(item.purchase_price_including_tax)} ج.م` : "—"} />
                <Info label="سعر الشراء بدون ضريبة" value={numberValue(item.purchase_price_excluding_tax) ? `${money(item.purchase_price_excluding_tax)} ج.م` : "—"} />
                <Info label="هامش الربح" value={numberValue(item.profit_margin) ? `${numberValue(item.profit_margin)}%` : "—"} />
                <Info label="الضريبة" value={item.tax_name ? `${item.tax_name}${numberValue(item.tax_percent) ? ` (${numberValue(item.tax_percent)}%)` : ""}` : "—"} />
                <Info label="الحد الأدنى" value={String(numberValue(item.min_stock))} />
                <Info label="الحد الأقصى" value={String(numberValue(item.max_stock))} />
                <Info label="الرصيد الافتتاحي" value={String(numberValue(item.opening_stock))} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">بيانات Excel التشغيلية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                <Info label="المكان" value={[item.rack, item.shelf_row, item.position].filter(Boolean).join(" / ") || "—"} ltr />
                <Info label="الوزن" value={numberValue(item.weight) ? String(numberValue(item.weight)) : "—"} />
                <Info label="تتبع Serial/IMEI" value={item.serial_tracking_enabled ? "نعم" : "لا"} />
                <Info label="تتبع Batch" value={item.track_batch ? "نعم" : "لا"} />
                <Info label="له تاريخ صلاحية" value={item.has_expiry ? "نعم" : "لا"} />
                <Info label="تاريخ الصلاحية" value={item.expiry_date ?? "—"} />
                <Info label="نوع ضريبة البيع" value={item.selling_price_tax_type === "inclusive" ? "شامل" : item.selling_price_tax_type === "exclusive" ? "غير شامل" : "—"} />
                <Info label="الوصف" value={item.product_description ?? "—"} />
                <Info label="الملاحظات" value={item.notes ?? "—"} />
                <Info label="حقل مخصص 1" value={item.custom_field_1 ?? "—"} />
                <Info label="حقل مخصص 2" value={item.custom_field_2 ?? "—"} />
                <Info label="حقل مخصص 3" value={item.custom_field_3 ?? "—"} />
                <Info label="حقل مخصص 4" value={item.custom_field_4 ?? "—"} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">الباركودات والمتغيرات والضمانات</CardTitle></CardHeader>
              <CardContent className="space-y-4 p-4">
                <div>
                  <div className="mb-2 text-xs font-black text-slate-500">الباركودات</div>
                  <div className="flex flex-wrap gap-2">
                    {(data?.barcodes ?? []).length ? data?.barcodes?.map((barcode) => (
                      <Badge key={barcode.id ?? barcode.barcode} variant="outline" className="bg-slate-50 font-mono text-slate-700" dir="ltr">{barcode.barcode}</Badge>
                    )) : <span className="text-sm font-bold text-slate-400">لا يوجد باركودات</span>}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-black text-slate-500">المتغيرات</div>
                  <div className="flex flex-wrap gap-2">
                    {(data?.variants ?? []).length ? data?.variants?.map((variant) => (
                      <Badge key={variant.id ?? `${variant.name}-${variant.value}`} variant="outline" className="bg-indigo-50 text-indigo-700">{variant.name}: {variant.value}{variant.sku ? ` / ${variant.sku}` : ""}</Badge>
                    )) : <span className="text-sm font-bold text-slate-400">لا يوجد متغيرات</span>}
                    <Link href="/dashboard/items/variants" className="inline-flex items-center gap-1 text-xs font-black text-brand hover:underline"><ExternalLink className="size-3" /> إدارة المتغيرات</Link>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100">
                <button type="button" className="flex w-full items-center justify-between" onClick={() => setShowMovements(!showMovements)}>
                  <CardTitle className="text-lg font-black">حركة المخزون</CardTitle>
                  <Badge variant="outline" className="cursor-pointer bg-sky-50 text-xs">{showMovements ? "إخفاء" : "عرض"}</Badge>
                </button>
              </CardHeader>
              {showMovements ? (
                <CardContent className="p-0">
                  {movementsLoading ? (
                    <div className="flex items-center justify-center p-6"><Loader2 className="size-5 animate-spin text-slate-400" /></div>
                  ) : movements.length === 0 ? (
                    <div className="p-6 text-center text-sm font-bold text-slate-400">لا توجد حركات مخزنية</div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-white">
                          <TableRow>
                            <TableHead className="text-right text-xs">النوع</TableHead>
                            <TableHead className="text-right text-xs">الاتجاه</TableHead>
                            <TableHead className="text-right text-xs">الكمية</TableHead>
                            <TableHead className="text-right text-xs">سعر الوحدة</TableHead>
                            <TableHead className="text-right text-xs">القيمة</TableHead>
                            <TableHead className="text-right text-xs">Batch</TableHead>
                            <TableHead className="text-right text-xs">التاريخ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {movements.slice(0, 50).map((movement) => (
                            <TableRow key={movement.id}>
                              <TableCell className="text-sm font-bold">{movementTypeLabels[movement.movement_type] ?? movement.movement_type}</TableCell>
                              <TableCell>
                                <Badge className={movement.direction === "in" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}>
                                  {movement.direction === "in" ? "وارد" : movement.direction === "out" ? "صادر" : "تسوية"}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-sm font-bold">{Number(movement.quantity).toLocaleString("ar-EG")}</TableCell>
                              <TableCell className="font-mono text-sm">{money(movement.unit_price)}</TableCell>
                              <TableCell className="font-mono text-sm">{money(movement.total_value)}</TableCell>
                              <TableCell className="text-xs">{movement.pharmacy_item_batches?.batch_number ?? "—"}</TableCell>
                              <TableCell className="text-xs text-slate-500">{new Date(movement.created_at).toLocaleDateString("ar-EG")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              ) : null}
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
