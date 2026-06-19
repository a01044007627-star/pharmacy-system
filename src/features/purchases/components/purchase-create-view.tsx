"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Package, Plus, Save, Search, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { calculatePurchaseTotals } from "@/features/purchases/lib/purchase-totals"
import { PartnerFormDialog } from "@/features/partners/components/partner-form-dialog"
import { useNetwork } from "@/hooks/use-data-layer"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"

type Item = {
  id: string
  name_ar: string
  sku?: string | null
  unit?: string | null
  buy_price: number
  sell_price: number
  manage_inventory: boolean
  track_batch: boolean
  has_expiry: boolean
}

type Supplier = { id: string; name: string; phone?: string | null; balance: number }
type Line = Item & { quantity: string; buyPrice: string; sellPrice: string; discount: string; batchNumber: string; expiryDate: string }

export function PurchaseCreateView() {
  const auth = useAuth()
  const router = useRouter()
  const settings = useAppSettings()
  const network = useNetwork()
  const defaultsApplied = useRef(false)
  const currency = settings.get("project", "currencySymbol", "ج.م")
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [search, setSearch] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [supplierName, setSupplierName] = useState("مورد نقدي")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [paid, setPaid] = useState("0")
  const [headerDiscount, setHeaderDiscount] = useState("0")
  const [tax, setTax] = useState("0")
  const [shipping, setShipping] = useState("0")
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 16))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const purchaseDiscountEnabled = settings.bool("purchases", "enablePurchaseDiscount", true)
  const shippingEnabled = settings.bool("purchases", "enableShippingCost", true)
  const batchTrackingEnabled = settings.bool("purchases", "enableBatchTracking", false) || settings.bool("items", "enableBatchTracking", false)
  const expiryTrackingEnabled = settings.bool("purchases", "enableExpiryTracking", true) && settings.bool("items", "enableExpiryTracking", true)
  const acceptedPaymentMethods = useMemo(() => {
    const allowed = new Set(["cash", "card", "wallet", "bank-transfer"])
    const methods = settings.get("payments", "acceptedPaymentMethods", "cash,card")
      .split(",")
      .map((value) => value.trim())
      .map((value) => value === "bank" ? "bank-transfer" : value)
      .filter((value) => allowed.has(value))
    return methods.length ? Array.from(new Set(methods)) : ["cash"]
  }, [settings])

  const bootstrapCacheKey = useMemo(() => `purchases:bootstrap:${auth.activePharmacyId ?? "none"}:${auth.activeBranchId ?? "all"}`, [auth.activeBranchId, auth.activePharmacyId])

  const loadBootstrap = useCallback(async () => {
    if (!auth.activePharmacyId) return
    const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, branch_id: auth.activeBranchId ?? "", bootstrap: "1" })
    try {
      const response = await fetch(`/api/purchases?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { items?: Item[]; suppliers?: Supplier[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل بيانات الشراء")
      setItems(data.items ?? [])
      setSuppliers(data.suppliers ?? [])
      await localDB.setCache(bootstrapCacheKey, data, 7 * 24 * 60 * 60 * 1000)
    } catch (error) {
      const cached = await localDB.getCache(bootstrapCacheKey) as { items?: Item[]; suppliers?: Supplier[] } | null
      if (cached) {
        setItems(cached.items ?? [])
        setSuppliers(cached.suppliers ?? [])
        toast.warning("تم تحميل آخر بيانات محفوظة للمشتريات بدون إنترنت")
      } else {
        toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات الشراء")
      }
    }
  }, [auth.activeBranchId, auth.activePharmacyId, bootstrapCacheKey])

  useEffect(() => { void loadBootstrap() }, [loadBootstrap])

  useEffect(() => {
    if (settings.loading || defaultsApplied.current) return
    defaultsApplied.current = true
    setHeaderDiscount(purchaseDiscountEnabled ? String(settings.number("purchases", "defaultDiscountPercent", 0)) : "0")
    setShipping(shippingEnabled ? String(settings.number("purchases", "defaultShippingCost", 0)) : "0")
    const preferred = settings.get("payments", "defaultPaymentMethod", "cash")
    const normalized = preferred === "bank" ? "bank-transfer" : preferred
    setPaymentMethod(acceptedPaymentMethods.includes(normalized) ? normalized : acceptedPaymentMethods[0])
  }, [acceptedPaymentMethods, purchaseDiscountEnabled, settings, shippingEnabled])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return []
    return items.filter((item) => `${item.name_ar} ${item.sku ?? ""}`.toLowerCase().includes(term)).slice(0, 12)
  }, [items, search])

  const totals = useMemo(() => calculatePurchaseTotals(
    lines.map((line) => ({ quantity: Number(line.quantity), buyPrice: Number(line.buyPrice), discount: Number(line.discount) })),
    { headerDiscount: Number(headerDiscount), tax: Number(tax), shipping: Number(shipping), paid: Number(paid) },
  ), [headerDiscount, lines, paid, shipping, tax])

  function addItem(item: Item) {
    setLines((current) => {
      const existing = current.find((line) => line.id === item.id)
      if (existing) return current.map((line) => line.id === item.id ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line)
      return [...current, { ...item, quantity: "1", buyPrice: String(item.buy_price ?? 0), sellPrice: String(item.sell_price ?? 0), discount: "0", batchNumber: "", expiryDate: "" }]
    })
    setSearch("")
  }

  function updateLine(index: number, key: keyof Line, value: string) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line))
  }

  async function save() {
    if (!auth.activeBranchId) {
      toast.error("اختر الفرع المستلم أولاً")
      return
    }
    if (!lines.length) {
      toast.error("أضف صنفاً واحداً على الأقل")
      return
    }
    const missingExpiry = lines.find((line) => expiryTrackingEnabled && line.has_expiry && !line.expiryDate)
    if (missingExpiry) {
      toast.error(`أدخل تاريخ الصلاحية للصنف ${missingExpiry.name_ar}`)
      return
    }
    const missingBatch = lines.find((line) => batchTrackingEnabled && line.track_batch && !line.batchNumber.trim())
    if (missingBatch) {
      toast.error(`أدخل رقم التشغيلة للصنف ${missingBatch.name_ar}`)
      return
    }

    const payload = {
      pharmacy_id: auth.activePharmacyId,
      branch_id: auth.activeBranchId,
      client_request_id: crypto.randomUUID(),
      supplier_id: supplierId || null,
      supplier_name: supplierName,
      payment_method: paymentMethod,
      paid_amount: Number(paid),
      header_discount: purchaseDiscountEnabled ? Number(headerDiscount) : 0,
      tax_total: Number(tax),
      shipping_fee: shippingEnabled ? Number(shipping) : 0,
      purchase_date: new Date(purchaseDate).toISOString(),
      notes,
      lines: lines.map((line) => ({
        item_id: line.id,
        quantity: Number(line.quantity),
        buy_price: Number(line.buyPrice),
        sell_price: Number(line.sellPrice),
        discount: purchaseDiscountEnabled ? Number(line.discount) : 0,
        unit: line.unit,
        batch_number: batchTrackingEnabled ? line.batchNumber : "",
        expiry_date: expiryTrackingEnabled && line.expiryDate ? line.expiryDate : null,
      })),
    }

    const queueOffline = async () => {
      await queueApiRequest({ path: "/api/purchases", method: "POST", body: payload, label: "فاتورة الشراء" })
      toast.warning("تم حفظ فاتورة الشراء أوفلاين وستُنفذ تلقائيًا عند عودة الاتصال")
      router.push("/dashboard/sync")
    }

    setSaving(true)
    try {
      if (!network.online) {
        await queueOffline()
        return
      }
      let response: Response
      try {
        response = await fetch("/api/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } catch {
        await queueOffline()
        return
      }
      const data = await response.json().catch(() => ({})) as { purchase?: { id?: string }; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ فاتورة الشراء")
      toast.success("تم استلام فاتورة الشراء وإضافة المخزون")
      router.push(data.purchase?.id ? `/dashboard/purchases/${data.purchase.id}` : "/dashboard/purchases")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ فاتورة الشراء")
    } finally {
      setSaving(false)
    }
  }

  const money = (value: number) => `${value.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

  return (
    <PageAccess permission="purchases:write">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="استلام فاتورة شراء" subtitle="تسجيل الفاتورة والتشغيلات وإضافة المخزون وتسوية حساب المورد في عملية واحدة." icon={Package} actions={<Button variant="outline" className="h-10 rounded-xl" render={<Link href="/dashboard/purchases" />}><ArrowRight className="size-4" /> المشتريات</Button>} />

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">بيانات الفاتورة</CardTitle></CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex min-w-0 gap-2">
              <NativeSelect value={supplierId} onChange={(event) => {
                const id = event.target.value
                setSupplierId(id)
                setSupplierName(suppliers.find((supplier) => supplier.id === id)?.name ?? "مورد نقدي")
              }} className="min-w-0 flex-1">
                <NativeSelectOption value="">مورد نقدي</NativeSelectOption>
                {suppliers.map((supplier) => <NativeSelectOption key={supplier.id} value={supplier.id}>{supplier.name}</NativeSelectOption>)}
              </NativeSelect>
              <PartnerFormDialog partnerType="supplier" onSaved={() => void loadBootstrap()} />
            </div>
            <Input type="datetime-local" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="h-11 rounded-xl" />
            <NativeSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {acceptedPaymentMethods.includes("cash") ? <NativeSelectOption value="cash">نقدي</NativeSelectOption> : null}
              {acceptedPaymentMethods.includes("card") ? <NativeSelectOption value="card">بطاقة</NativeSelectOption> : null}
              {acceptedPaymentMethods.includes("wallet") ? <NativeSelectOption value="wallet">محفظة</NativeSelectOption> : null}
              {acceptedPaymentMethods.includes("bank-transfer") ? <NativeSelectOption value="bank-transfer">تحويل بنكي</NativeSelectOption> : null}
            </NativeSelect>
            <Input value={paid} onChange={(event) => setPaid(event.target.value)} type="number" min="0" placeholder="المبلغ المدفوع" className="h-11 rounded-xl" />
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-black">أصناف الفاتورة</CardTitle></CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم الصنف أو SKU..." className="h-11 rounded-2xl pr-10 font-bold" />
              {search.trim() ? <div className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
                {filteredItems.length ? filteredItems.map((item) => <button key={item.id} type="button" onClick={() => addItem(item)} className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-right last:border-0 hover:bg-slate-50"><span><strong className="block">{item.name_ar}</strong><small className="text-slate-400">{item.sku ?? "بدون SKU"} — {item.unit ?? "وحدة"}</small></span><Plus className="size-4 text-brand" /></button>) : <div className="p-4 text-center text-sm font-bold text-slate-500">لا توجد أصناف مطابقة</div>}
              </div> : null}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table className="min-w-[1200px]">
                <TableHeader><TableRow>
                  <TableHead className="text-right">الصنف</TableHead><TableHead className="text-center">الكمية</TableHead><TableHead className="text-center">سعر الشراء</TableHead><TableHead className="text-center">سعر البيع</TableHead><TableHead className="text-center">خصم مبلغ</TableHead><TableHead className="text-center">رقم التشغيلة</TableHead><TableHead className="text-center">الصلاحية</TableHead><TableHead className="text-center">الصافي</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>{lines.length === 0 ? <TableRow><TableCell colSpan={9} className="h-32 text-center font-black text-slate-500">أضف الأصناف من البحث</TableCell></TableRow> : lines.map((line, index) => {
                  const net = Math.max(0, Number(line.quantity) * Number(line.buyPrice) - Number(line.discount))
                  return <TableRow key={line.id}>
                    <TableCell><strong>{line.name_ar}</strong><small className="block text-slate-400">{line.sku ?? "—"} — {line.unit ?? "وحدة"}</small></TableCell>
                    <TableCell><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="mx-auto h-10 w-24 text-center" /></TableCell>
                    <TableCell><Input type="number" min="0" value={line.buyPrice} onChange={(event) => updateLine(index, "buyPrice", event.target.value)} className="mx-auto h-10 w-28 text-center" /></TableCell>
                    <TableCell><Input type="number" min="0" value={line.sellPrice} onChange={(event) => updateLine(index, "sellPrice", event.target.value)} className="mx-auto h-10 w-28 text-center" /></TableCell>
                    <TableCell><Input disabled={!purchaseDiscountEnabled} type="number" min="0" value={purchaseDiscountEnabled ? line.discount : "0"} onChange={(event) => updateLine(index, "discount", event.target.value)} className="mx-auto h-10 w-28 text-center disabled:bg-slate-50" /></TableCell>
                    <TableCell><Input disabled={!batchTrackingEnabled} value={line.batchNumber} onChange={(event) => updateLine(index, "batchNumber", event.target.value)} placeholder={batchTrackingEnabled && line.track_batch ? "مطلوب" : "غير مفعل"} className="mx-auto h-10 w-36 text-center disabled:bg-slate-50" /></TableCell>
                    <TableCell><Input disabled={!expiryTrackingEnabled} type="date" required={expiryTrackingEnabled && line.has_expiry} value={line.expiryDate} onChange={(event) => updateLine(index, "expiryDate", event.target.value)} className="mx-auto h-10 w-40 text-center disabled:bg-slate-50" /></TableCell>
                    <TableCell className="text-center font-black text-brand">{money(net)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="text-rose-600" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="size-4" /></Button></TableCell>
                  </TableRow>
                })}</TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-3 p-4 md:grid-cols-3">
            <Input disabled={!purchaseDiscountEnabled} type="number" min="0" value={purchaseDiscountEnabled ? headerDiscount : "0"} onChange={(event) => setHeaderDiscount(event.target.value)} placeholder="خصم الفاتورة" className="h-11 rounded-xl disabled:bg-slate-50" />
            <Input type="number" min="0" value={tax} onChange={(event) => setTax(event.target.value)} placeholder="الضريبة" className="h-11 rounded-xl" />
            <Input disabled={!shippingEnabled} type="number" min="0" value={shippingEnabled ? shipping : "0"} onChange={(event) => setShipping(event.target.value)} placeholder="الشحن" className="h-11 rounded-xl disabled:bg-slate-50" />
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات..." className="min-h-24 md:col-span-3" />
          </CardContent></Card>
          <Card className="rounded-3xl border-0 bg-slate-950 text-white shadow-lg"><CardContent className="space-y-3 p-5">
            <div className="flex justify-between text-sm font-bold"><span>الإجمالي الفرعي</span><strong>{money(totals.subtotal)}</strong></div>
            <div className="flex justify-between text-sm font-bold text-rose-300"><span>الخصومات</span><strong>{money(totals.lineDiscount + totals.headerDiscount)}</strong></div>
            <div className="flex justify-between text-sm font-bold"><span>الضريبة والشحن</span><strong>{money(totals.tax + totals.shipping)}</strong></div>
            <div className="flex justify-between border-t border-white/15 pt-3 text-lg font-black text-emerald-300"><span>الإجمالي</span><strong>{money(totals.total)}</strong></div>
            <div className="flex justify-between text-sm font-black text-amber-300"><span>المتبقي للمورد</span><strong>{money(totals.due)}</strong></div>
            <Button className="h-11 w-full rounded-xl font-black" disabled={saving || !lines.length} onClick={() => void save()}><Save className="size-4" /> {saving ? "جاري الاستلام..." : "استلام وحفظ الفاتورة"}</Button>
          </CardContent></Card>
        </div>
      </section>
    </PageAccess>
  )
}
