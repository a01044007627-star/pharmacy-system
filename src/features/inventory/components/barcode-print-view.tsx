"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRight, Printer, Loader2, Barcode, Eye, Settings } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useReactToPrint } from "react-to-print"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/contexts/auth-context"
import type { PharmacyItemListRow } from "@/features/inventory/lib/items-types"
import { money, primaryBarcode } from "@/features/inventory/lib/items-helpers"
import { encodeCode128 } from "@/features/inventory/lib/barcode-encoder"
import { inventoryItemService } from "@/features/inventory/services/inventory-item-service"

/** Renders a Code-128B barcode as a pure SVG — no external deps */
function BarcodeSVG({ value }: { value: string; format?: string }) {
  if (!value) return null
  const bars = encodeCode128(value)
  const barWidth = 1.5
  const height = 35
  const totalWidth = bars.length * barWidth
  const rects: React.ReactNode[] = []
  let x = 0
  let i = 0
  while (i < bars.length) {
    const bit = bars[i]
    let len = 1
    while (i + len < bars.length && bars[i + len] === bit) len++
    if (bit === "1") {
      rects.push(
        <rect key={x} x={x} y={0} width={len * barWidth} height={height} fill="black" />
      )
    }
    x += len * barWidth
    i += len
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalWidth} ${height}`}
      className="mx-auto max-h-[40px] max-w-full"
      preserveAspectRatio="none"
    >
      {rects}
    </svg>
  )
}

type Paper = {
  id: string
  name: string
  page_width?: number
  width_mm?: number
  page_height?: number
  height_mm?: number
  left_margin?: number
  margin_left_mm?: number
  right_margin?: number
  margin_right_mm?: number
  top_margin?: number
  margin_top_mm?: number
  bottom_margin?: number
  margin_bottom_mm?: number
  label_width?: number
  label_height?: number
  columns?: number
  columns_count?: number
  rows?: number
  rows_count?: number
  gap_horizontal?: number
  gap_vertical?: number
  is_default: boolean
}

const DEFAULT_BARCODE_PAPER: Paper = {
  id: "default-a4",
  name: "A4 افتراضي",
  page_width: 210,
  page_height: 297,
  left_margin: 10,
  right_margin: 10,
  top_margin: 10,
  bottom_margin: 10,
  label_width: 50,
  label_height: 30,
  columns: 3,
  rows: 8,
  gap_horizontal: 2,
  gap_vertical: 2,
  is_default: true,
}

export function BarcodePrintView() {
  const auth = useAuth()
  const searchParams = useSearchParams()
  const itemId = searchParams.get("item")
  const pharmacyId = searchParams.get("pharmacy_id") || auth.activePharmacyId
  const scopeQuery = pharmacyId ? `?pharmacy_id=${encodeURIComponent(pharmacyId)}` : ""
  
  const [item, setItem] = useState<PharmacyItemListRow | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [selectedPaperId, setSelectedPaperId] = useState<string>("")
  const [quantity, setQuantity] = useState<number>(30)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showSku, setShowSku] = useState(true)
  
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `ملصقات باركود - ${item?.name_ar ?? ""}`,
  })

  const loadData = useCallback(async (signal?: AbortSignal) => {
    if (!itemId) {
      setItem(null)
      setLoading(false)
      setErrorMessage("لم يتم تحديد الصنف المطلوب طباعته")
      return
    }
    if (!pharmacyId) {
      setItem(null)
      setLoading(auth.loading)
      if (!auth.loading) setErrorMessage("اختر الصيدلية النشطة أولًا")
      return
    }

    setLoading(true)
    setErrorMessage("")
    try {
      const itemData = await inventoryItemService.getDetail<{ item?: PharmacyItemListRow }>(itemId, pharmacyId, signal)
      if (!itemData.item) throw new Error("الصنف غير موجود أو لا يتبع الصيدلية المختارة")
      setItem(itemData.item)

      try {
        const paperData = await inventoryItemService.listBarcodePapers<Paper>(pharmacyId, signal)
        const list = paperData.rows?.length ? paperData.rows : [DEFAULT_BARCODE_PAPER]
        setPapers(list)
        const selected = list.find((paper) => paper.is_default) ?? list[0]
        setSelectedPaperId(selected.id)
      } catch (paperError) {
        setPapers([DEFAULT_BARCODE_PAPER])
        setSelectedPaperId(DEFAULT_BARCODE_PAPER.id)
        if (!(paperError instanceof Error && paperError.name === "AbortError")) {
          toast.warning("تم تحميل الصنف باستخدام مقاس ورق افتراضي لتعذر تحميل إعدادات الباركود")
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      const message = error instanceof Error ? error.message : "فشل تحميل بيانات الصنف"
      setItem(null)
      setErrorMessage(message)
      toast.error(message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [auth.loading, itemId, pharmacyId])

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [loadData])

  const paper = papers.find((p) => p.id === selectedPaperId)

  // Normalize paper parameters (handling different database column versions)
  const pageWidth = paper?.page_width ?? paper?.width_mm ?? 297
  const pageHeight = paper?.page_height ?? paper?.height_mm ?? 210
  const labelWidth = paper?.label_width ?? 50
  const labelHeight = paper?.label_height ?? 30
  const columns = paper?.columns ?? paper?.columns_count ?? 3
  const rows = paper?.rows ?? paper?.rows_count ?? 4
  const gapHorizontal = paper?.gap_horizontal ?? 2
  const gapVertical = paper?.gap_vertical ?? 2
  const marginTop = paper?.top_margin ?? paper?.margin_top_mm ?? 10
  const marginBottom = paper?.bottom_margin ?? paper?.margin_bottom_mm ?? 10
  const marginLeft = paper?.left_margin ?? paper?.margin_left_mm ?? 10
  const marginRight = paper?.right_margin ?? paper?.margin_right_mm ?? 10

  const barcodeValue = item ? (primaryBarcode(item) || item.sku || "") : ""

  // Prepare pages of labels for rendering
  const totalLabelsPerPage = columns * rows
  const totalPages = Math.ceil(quantity / totalLabelsPerPage)
  
  const pagesArray = Array.from({ length: totalPages }).map((_, pageIdx) => {
    const labelsInThisPage = Math.min(quantity - pageIdx * totalLabelsPerPage, totalLabelsPerPage)
    return Array.from({ length: labelsInThisPage })
  })

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center font-black text-slate-500">
        <Loader2 className="size-8 animate-spin text-brand mb-3" />
        جاري تحميل بيانات الصنف وإعدادات الباركود...
      </div>
    )
  }

  if (!item) {
    return (
      <div className="page-container py-10 text-center font-black text-rose-700">
        {errorMessage || "الصنف غير موجود أو لم يتم تحديده بشكل صحيح."}
      </div>
    )
  }

  return (
    <section dir="rtl" className="page-container space-y-5 py-4 text-right sm:py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Barcode className="size-6 text-brand" />
            طباعة ملصقات الباركود: {item.name_ar}
          </h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">اختر إعدادات الورق المناسبة وحدد الحقول المراد إظهارها على الملصق.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-10 rounded-xl" asChild>
            <Link href={`/dashboard/items${scopeQuery}`}>
              <ArrowRight className="size-4" /> الأصناف
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4">
              <CardTitle className="text-base font-black text-slate-900 flex items-center gap-2">
                <Settings className="size-5 text-slate-500" /> خيارات الملصق
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="font-black text-slate-700">اختر مقاس الورق</Label>
                  <Select value={selectedPaperId} onValueChange={(val) => setSelectedPaperId(val ?? "")}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder="اختر مقاس الورق" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {papers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.columns ?? p.columns_count}×{p.rows ?? p.rows_count} ملصقات)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-black text-slate-700">عدد الملصقات الإجمالي للطباعة</Label>
                  <Input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <Label className="font-black text-slate-700 mb-2 block">الحقول الظاهرة في الملصق</Label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
                    <Checkbox checked={showName} onCheckedChange={(v) => setShowName(Boolean(v))} />
                    <span>اسم الصنف</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
                    <Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(Boolean(v))} />
                    <span>سعر البيع للجمهور</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
                    <Checkbox checked={showSku} onCheckedChange={(v) => setShowSku(Boolean(v))} />
                    <span>الباركود / SKU النصي</span>
                  </label>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 flex justify-end">
                <Button
                  variant="default"
                  className="h-11 rounded-xl font-black gap-2 shadow-lg shadow-brand/10"
                  onClick={() => void handlePrint()}
                >
                  <Printer className="size-5" />
                  بدء طباعة الملصقات
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Live Preview block */}
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm overflow-hidden">
            <CardHeader className="border-b border-slate-100 px-5 py-4">
              <CardTitle className="text-base font-black text-slate-900 flex items-center gap-2">
                <Eye className="size-5 text-slate-500" /> معاينة حية للملصق
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 flex justify-center bg-slate-50/50">
              <div 
                className="bg-white border border-slate-200 rounded shadow-md flex flex-col justify-between p-2 text-center overflow-hidden"
                style={{
                  width: `${labelWidth}mm`,
                  height: `${labelHeight}mm`,
                }}
              >
                <div className="text-[10px] font-black text-slate-900 leading-tight truncate">
                  {auth.activePharmacyId ? "صيدليتي" : ""}
                </div>
                {showName ? (
                  <div className="text-[10px] font-black text-slate-800 line-clamp-2 leading-tight">
                    {item.name_ar}
                  </div>
                ) : null}
                <div className="my-0.5">
                  <BarcodeSVG value={barcodeValue} />
                </div>
                <div className="flex justify-between items-center px-1 text-[8px] font-black text-slate-600">
                  {showSku ? <span className="font-mono">{barcodeValue}</span> : null}
                  {showPrice ? (
                    <span className="text-[9px] font-black text-brand bg-slate-50 px-1 rounded">
                      {money(item.sell_price)} ج.م
                    </span>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Printable Area - Hidden from layout, visible only in print */}
        <div className="overflow-auto max-h-[500px] border border-slate-200 rounded-3xl p-5 bg-slate-100/50">
          <span className="text-xs font-black text-slate-400 mb-3 block">شكل صفحات الطباعة (قد تختلف المقاسات في المتصفح وتضبط عند الطباعة):</span>
          
          <div ref={printRef} className="barcode-print-container" style={{ direction: "rtl" }}>
            <style>{`
              @media screen {
                .print-page {
                  background: white;
                  border: 1px solid #ddd;
                  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
                  margin-bottom: 20px;
                }
              }
              @media print {
                body {
                  margin: 0;
                  padding: 0;
                  background: white;
                }
                .print-page {
                  page-break-after: always;
                  border: none !important;
                  box-shadow: none !important;
                }
              }
              .print-page {
                box-sizing: border-box;
                display: block;
              }
              .label-grid {
                display: grid;
                justify-content: start;
                align-content: start;
              }
              .label-cell {
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: center;
                overflow: hidden;
                padding: 4px;
                text-align: center;
                border: 1px dashed rgba(0,0,0,0.1);
              }
              @media print {
                .label-cell {
                  border: none !important;
                }
              }
            `}</style>
            
            {pagesArray.map((pageLabels, pageIdx) => (
              <div
                key={pageIdx}
                className="print-page mx-auto"
                style={{
                  width: `${pageWidth}mm`,
                  height: `${pageHeight}mm`,
                  paddingTop: `${marginTop}mm`,
                  paddingBottom: `${marginBottom}mm`,
                  paddingLeft: `${marginLeft}mm`,
                  paddingRight: `${marginRight}mm`,
                }}
              >
                <div
                  className="label-grid h-full w-full"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, ${labelWidth}mm)`,
                    gridTemplateRows: `repeat(${rows}, ${labelHeight}mm)`,
                    gap: `${gapVertical}mm ${gapHorizontal}mm`,
                  }}
                >
                  {pageLabels.map((_, labelIdx) => (
                    <div
                      key={labelIdx}
                      className="label-cell"
                      style={{
                        width: `${labelWidth}mm`,
                        height: `${labelHeight}mm`,
                      }}
                    >
                      <div className="text-[9px] font-black text-slate-900 leading-tight truncate">
                        صيدليتي
                      </div>
                      {showName ? (
                        <div className="text-[9px] font-black text-slate-800 line-clamp-2 leading-tight">
                          {item.name_ar}
                        </div>
                      ) : null}
                      <div className="w-full flex justify-center py-0.5">
                        <BarcodeSVG value={barcodeValue} />
                      </div>
                      <div className="flex w-full justify-between items-center px-1 text-[8px] font-black text-slate-700">
                        {showSku ? <span className="font-mono leading-none">{barcodeValue}</span> : null}
                        {showPrice ? (
                          <span className="text-[9px] font-black leading-none">
                            {money(item.sell_price)} ج.م
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
