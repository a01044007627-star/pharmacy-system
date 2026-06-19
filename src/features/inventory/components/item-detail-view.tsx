"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Edit, Loader2, Package, Pill } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { money, numberValue, statusLabel, unitCountLabel, unitEquationLabel } from "@/features/inventory/lib/items-helpers"
import { cacheItemDetail, readCachedItemDetail } from "@/features/inventory/lib/items-offline"
import { apiRequest, isRequestAbort } from "@/lib/api-client"

type DetailResponse = {
  item?: PharmacyItemListRow
  barcodes?: Array<{ id?: string; barcode: string; is_primary?: boolean | null }>
  units?: Array<{ id?: string; unit_name: string; factor?: number | string | null; barcode?: string | null; sell_price?: number | string | null }>
  variants?: Array<{ id?: string; name?: string | null; value?: string | null; sku?: string | null; sell_price?: number | string | null }>
  error?: string
}

const pharmacyTypeLabels: Record<string, string> = {
  medicine: "دواء",
  medical_supply: "مستلزم طبي",
  supplement: "مكمل غذائي",
  cosmetic: "تجميل وعناية بالبشرة",
  personal_care: "عناية شخصية",
  baby_care: "أم وطفل",
  device: "جهاز طبي",
  other: "صنف صيدلي آخر",
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

export function ItemDetailView({ itemId, pharmacyId }: { itemId: string; pharmacyId?: string }) {
  const [data, setData] = useState<DetailResponse | null>(null)
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [showMovements, setShowMovements] = useState(false)
  const scopeQuery = useMemo(() => pharmacyId ? `?pharmacy_id=${encodeURIComponent(pharmacyId)}` : "", [pharmacyId])
  const listHref = `/dashboard/items${scopeQuery}`
  const editHref = `/dashboard/items/${itemId}/edit${scopeQuery}`

  const loadItem = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setErrorMessage("")
    try {
      const payload = await apiRequest<DetailResponse>(`/api/items/${itemId}${scopeQuery}`, {
        cache: "no-store",
        signal,
        timeoutMs: 18000,
        retries: 1,
      })
      await cacheItemDetail(`${pharmacyId ?? "active"}:${itemId}`, payload)
      setData(payload)
    } catch (error) {
      if (isRequestAbort(error)) return
      const cached = await readCachedItemDetail<DetailResponse>(`${pharmacyId ?? "active"}:${itemId}`)
      if (cached?.item) {
        setData(cached)
        toast.warning("تم عرض آخر نسخة محفوظة للصنف لحين استعادة الاتصال")
      } else {
        const message = error instanceof Error ? error.message : "فشل تحميل الصنف"
        setData(null)
        setErrorMessage(message)
        toast.error(message)
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [itemId, pharmacyId, scopeQuery])

  useEffect(() => {
    const controller = new AbortController()
    void loadItem(controller.signal)
    return () => controller.abort()
  }, [loadItem])

  useEffect(() => {
    if (!showMovements || !itemId) return
    const controller = new AbortController()
    setMovementsLoading(true)
    const separator = scopeQuery ? "&" : "?"
    void apiRequest<{ movements?: MovementRow[] }>(
      `/api/inventory/items/stock-movements${scopeQuery}${separator}item_id=${encodeURIComponent(itemId)}`,
      { cache: "no-store", signal: controller.signal, timeoutMs: 18000, retries: 1 },
    )
      .then((payload) => setMovements(payload.movements ?? []))
      .catch((error) => {
        if (!isRequestAbort(error)) toast.error(error instanceof Error ? error.message : "فشل تحميل حركة الصنف")
      })
      .finally(() => { if (!controller.signal.aborted) setMovementsLoading(false) })
    return () => controller.abort()
  }, [showMovements, itemId, scopeQuery])

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
          title={item?.name_ar ?? "بطاقة الدواء أو الصنف الصيدلي"}
          subtitle="البيانات الدوائية والتجارية والتشغيلية والمخزنية في بطاقة واحدة."
          icon={Package}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10 rounded-xl" render={<Link href={listHref} />}><ArrowRight className="size-4" /> الأدوية والأصناف</Button>
              <Button className="h-10 rounded-xl" render={<Link href={editHref} />}><Edit className="size-4" /> تعديل</Button>
            </div>
          }
        />

        {loading ? <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center font-black text-slate-500"><Loader2 className="mx-auto mb-3 size-6 animate-spin" /> جاري التحميل...</div> : null}
        {!loading && !item ? (
          <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-center">
            <p className="font-black text-rose-700">{errorMessage || "الصنف غير موجود أو لا يتبع الصيدلية المختارة"}</p>
            <Button variant="outline" className="mt-3 rounded-xl" onClick={() => void loadItem()}>إعادة المحاولة</Button>
          </div>
        ) : null}

        {item ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">البيانات الأساسية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                <Info label="الاسم" value={item.name_ar} />
                <Info label="الاسم بالإنجليزية" value={item.name_en ?? "—"} />
                <Info label="كود الصنف الداخلي" value={item.sku ?? "—"} ltr />
                <Info label="المجموعة" value={item.group?.name ?? item.category ?? "—"} />
                <Info label="المجموعة الفرعية" value={item.sub_category ?? "—"} />
                <Info label="العلامة التجارية" value={item.brand?.name ?? "—"} />
                <Info label="نوع الصنف الصيدلي" value={pharmacyTypeLabels[item.pharmacy_type ?? "other"] ?? "صنف صيدلي"} />
                <Info label="الشركة المنتجة" value={item.manufacturer_name ?? "—"} />
                <Info label="بلد المنشأ" value={item.manufacturer_country ?? "—"} />
                <Info label="وحدة البيع" value={item.unit ?? "—"} />
                <Info label="معادلة الوحدة" value={unitEquationLabel(item)} />
                <Info label="عدد الفرعية داخل الرئيسية" value={unitCountLabel(item)} />
                <Info label="متابعة مخزون" value={item.manage_inventory ? "نعم" : "لا"} />
                <Info label="غير مخصص للبيع" value={item.not_for_sale ? "نعم" : "لا"} />
                <Info label="دواء مراقب / جدول" value={item.is_controlled ? "نعم" : "لا"} />
                <Info label="يصرف بروشتة" value={item.requires_prescription ? "نعم" : "لا"} />
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
              <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-lg font-black"><Pill className="size-5 text-brand" /> البيانات الدوائية</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                <Info label="الاسم العلمي / الجنيس" value={item.generic_name ?? "—"} />
                <Info label="المادة الفعالة" value={item.active_ingredient ?? "—"} />
                <Info label="المجموعة العلاجية" value={item.therapeutic_class ?? "—"} />
                <Info label="الشكل الدوائي" value={item.dosage_form ?? "—"} />
                <Info label="التركيز" value={item.strength ?? "—"} ltr />
                <Info label="حجم العبوة" value={item.package_size ?? "—"} />
                <Info label="طريقة الاستخدام" value={item.route_of_administration ?? "—"} />
                <Info label="رقم التسجيل الدوائي" value={item.registration_number ?? "—"} ltr />
                <Info label="شروط الحفظ" value={item.storage_condition ?? "—"} />
                <Info label="مكان التخزين" value={[item.rack, item.shelf_row, item.position].filter(Boolean).join(" / ") || "—"} ltr />
                <Info label="تتبع رقم التشغيلة" value={item.track_batch ? "نعم" : "لا"} />
                <Info label="له تاريخ صلاحية" value={item.has_expiry ? "نعم" : "لا"} />
                <Info label="تاريخ الصلاحية" value={item.expiry_date ?? "—"} />
                <Info label="الاستخدامات / الوصف" value={item.product_description ?? "—"} />
                <Info label="تنبيهات الصيدلي" value={item.notes ?? "—"} />
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">الباركودات ووحدات الصرف</CardTitle></CardHeader>
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
                  <div className="mb-2 text-xs font-black text-slate-500">وحدات الصرف والعبوات</div>
                  <div className="flex flex-wrap gap-2">
                    {(data?.units ?? []).length ? data?.units?.map((unit) => (
                      <Badge key={unit.id ?? unit.unit_name} variant="outline" className="bg-sky-50 font-black text-sky-700">
                        {unit.unit_name}{Number(unit.factor ?? 1) > 1 ? ` × ${Number(unit.factor).toLocaleString("ar-EG")}` : ""}
                      </Badge>
                    )) : <span className="text-sm font-bold text-slate-400">لا توجد وحدات إضافية</span>}
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
