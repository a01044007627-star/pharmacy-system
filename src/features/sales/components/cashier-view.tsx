"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"
import {
  Info,
  DollarSign,
  Barcode,
  Calculator as CalculatorIcon,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  MapPin,
  Minus,
  Monitor,
  Package,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  Wallet,
  WifiOff,
  X,
} from "lucide-react"
import { PageAccess } from "@/components/auth/page-access"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { useAppSettings } from "@/contexts/settings-context"
import { useNetwork } from "@/hooks/use-data-layer"
import { useSound } from "@/hooks/use-sound"
import { cn } from "@/lib/utils"
import { numberValue, escapeHtml, labelFromMap } from "@/lib/helpers"
import { money } from "@/lib/formatters"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Calculator as CalculatorWidget } from "@/features/calculator"

type CashierProductBarcode = {
  barcode?: string | null
  is_primary?: boolean | null
}

type CashierProduct = {
  id: string
  name_ar: string
  name_en?: string | null
  sku?: string | null
  barcode?: string | null
  barcodes?: CashierProductBarcode[]
  unit?: string | null
  sell_price: number
  old_sell_price?: number | null
  buy_price?: number
  available_qty: number
  manage_inventory?: boolean
  min_stock?: number | null
  group_id?: string | null
  group_name?: string | null
  brand_id?: string | null
  brand_name?: string | null
  category?: string | null
  manufacturer_name?: string | null
  item_type?: string | null
  has_expiry?: boolean
  track_batch?: boolean
  nearest_batch_id?: string | null
  nearest_batch_number?: string | null
  nearest_expiry?: string | null
  active_batches_count?: number
}

type CartLine = CashierProduct & {
  quantity: number
  discount: number
  unit_price: number
}

type RecentSale = {
  id: string
  invoice_number: string
  customer_name: string
  total: number
  paid_amount: number
  payment_method: string
  sale_date: string
}

type CashierShift = {
  id: string
  opened_at: string
  opening_balance: number
  expected_balance: number | null
  cash_sales: number | null
  card_sales: number | null
  credit_sales: number | null
  total_collected: number | null
  total_expenses: number | null
  status: "open" | "closed"
  notes?: string | null
}

type CashierResponse = {
  products?: CashierProduct[]
  recentSales?: RecentSale[]
  hasMore?: boolean
  nextOffset?: number | null
  error?: string
}

type ShiftResponse = {
  openShift?: CashierShift | null
  shift?: CashierShift
  error?: string
}

type PrintableInvoice = {
  invoiceNumber?: string
  customerName: string
  paymentMethod: string
  savedAt: string
  lines: CartLine[]
  subtotal: number
  discountTotal: number
  total: number
  paidAmount: number
}

type InvoicePrintDesign = {
  template?: string
  primary_color?: string | null
  secondary_color?: string | null
  accent_color?: string | null
  show_header?: boolean | null
  header_text?: string | null
  show_footer?: boolean | null
  footer_text?: string | null
  show_tax?: boolean | null
  show_discount?: boolean | null
  paper_size?: string | null
  font_family?: string | null
  is_default?: boolean | null
  status?: string | null
}

type ReceiptPrinterProfile = {
  name?: string
  paper_width?: number | null
  is_default?: boolean | null
  status?: string | null
}

const OFFLINE_SALES_KEY = "pharmacy_cashier_offline_sales_v1"
const DRAFT_KEY = "pharmacy_cashier_draft_v1"
const CATALOG_PANEL_KEY = "pharmacy_cashier_catalog_panel_v1"
const CATALOG_PANEL_WIDTH_KEY = "pharmacy_cashier_catalog_panel_width_v1"

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "نقدي", card: "بطاقة", credit: "آجل", mixed: "متعدد", wallet: "محفظة", "bank-transfer": "تحويل بنكي",
}

const PRICE_LIST_LABELS: Record<string, string> = {
  default: "سعر البيع الافتراضي", wholesale: "سعر الجملة", offer: "سعر العروض",
}

function paperWidthFromProfiles(design: InvoicePrintDesign | null, printer: ReceiptPrinterProfile | null) {
  const printerWidth = Number(printer?.paper_width)
  if (Number.isFinite(printerWidth) && printerWidth > 0) return `${printerWidth}mm`
  const paper = String(design?.paper_size ?? "80mm").toLowerCase()
  if (paper.includes("58")) return "58mm"
  if (paper.includes("a4")) return "210mm"
  if (paper.includes("a5")) return "148mm"
  if (paper.includes("a6")) return "105mm"
  return "80mm"
}

function lineTotal(line: CartLine) {
  return Math.max(0, line.quantity * line.unit_price - line.discount)
}

function readOfflineSales() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_SALES_KEY) ?? "[]") as unknown[]
  } catch {
    return []
  }
}

function writeOfflineSales(rows: unknown[]) {
  localStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(rows))
}

function shiftTime(value?: string) {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })
}

function expiryLabel(value?: string | null) {
  if (!value) return ""
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" })
}

function primaryProductBarcode(product: CashierProduct) {
  return product.barcodes?.find((barcode) => barcode.is_primary)?.barcode
    ?? product.barcodes?.[0]?.barcode
    ?? product.barcode
    ?? product.sku
    ?? ""
}

function productSearchText(product: CashierProduct) {
  return [
    product.name_ar,
    product.name_en,
    product.sku,
    product.barcode,
    primaryProductBarcode(product),
    product.unit,
    product.group_name,
    product.brand_name,
    product.category,
    product.manufacturer_name,
    product.item_type,
    ...(product.barcodes ?? []).map((barcode) => barcode.barcode),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function productGroupLabel(product: CashierProduct) {
  return product.group_name || product.category || product.manufacturer_name || product.brand_name || "بدون مجموعة"
}

function clampPanelWidth(value: number) {
  return Math.min(620, Math.max(320, Math.round(value)))
}


export function CashierView() {
  const auth = useAuth()
  const network = useNetwork()
  const settings = useAppSettings()
  const { play } = useSound()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const currency = settings.get("project", "currencySymbol", "ج.م")

  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<CashierProduct[]>([])
  const [catalogProducts, setCatalogProducts] = useState<CashierProduct[]>([])
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [lines, setLines] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState("نقد جمهوري")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [priceList, setPriceList] = useState("default")
  const [paidAmount, setPaidAmount] = useState(0)
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [offlineCount, setOfflineCount] = useState(0)
  const [searchFocused, setSearchFocused] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [showCatalog, setShowCatalog] = useState(true)
  const [catalogSearch, setCatalogSearch] = useState("")
  const [catalogFilter, setCatalogFilter] = useState("all")
  const [catalogPanelWidth, setCatalogPanelWidth] = useState(420)
  const [cashierBranchId, setCashierBranchId] = useState<string | null>(null)
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calculatorResult, setCalculatorResult] = useState(0)
  const [shift, setShift] = useState<CashierShift | null>(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [openingCash, setOpeningCash] = useState("0")
  const [openingNotes, setOpeningNotes] = useState("")
  const [openingSession, setOpeningSession] = useState(false)
  const [lastInvoice, setLastInvoice] = useState<PrintableInvoice | null>(null)
  const [printDesign, setPrintDesign] = useState<InvoicePrintDesign | null>(null)
  const [printerProfile, setPrinterProfile] = useState<ReceiptPrinterProfile | null>(null)
  const [syncingOffline, setSyncingOffline] = useState(false)
  const [isPending, startTransition] = useTransition()

  const canDiscount = auth.isDeveloper || auth.can("sales:discount")
  const canPriceOverride = auth.isDeveloper || auth.can("sales:price-override")
  const canSell = auth.isDeveloper || auth.can("sales:write")
  const pharmacyId = auth.activePharmacyId
  const branchId = cashierBranchId ?? auth.activeBranchId
  const activeCashierBranch = auth.branches.find((branch) => branch.id === branchId) ?? auth.activeBranch
  const selectableBranches = useMemo(() => {
    if (auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)) return auth.branches
    const membership = auth.memberships.find((row) => row.pharmacy_id === pharmacyId)
    return membership?.branch_id
      ? auth.branches.filter((branch) => branch.id === membership.branch_id)
      : auth.branches
  }, [auth.branches, auth.isDeveloper, auth.isOwner, auth.memberships, auth.role, pharmacyId])
  const calculatorEnabled = settings.get("cashier", "enableCalculator", "true") !== "false"

  const subtotal = useMemo(() => lines.reduce((total, line) => total + line.quantity * line.unit_price, 0), [lines])
  const linesDiscount = useMemo(() => lines.reduce((total, line) => total + line.discount, 0), [lines])
  const total = useMemo(() => Math.max(0, subtotal - linesDiscount - invoiceDiscount), [invoiceDiscount, linesDiscount, subtotal])
  const due = Math.max(0, total - paidAmount)
  const expectedDrawer = numberValue(shift?.expected_balance, numberValue(shift?.opening_balance))
  const cashierGridStyle = useMemo(() => ({
    "--cashier-catalog-width": `${catalogPanelWidth}px`,
  }) as CSSProperties & Record<string, string>, [catalogPanelWidth])

  const catalogCategories = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; count: number }>()
    const categories = [
      { id: "all", label: "كل الأصناف", count: catalogProducts.length },
      { id: "available", label: "المتاح للبيع", count: catalogProducts.filter((product) => !product.manage_inventory || product.available_qty > 0).length },
      { id: "low", label: "ناقص / نافد", count: catalogProducts.filter((product) => product.manage_inventory && product.available_qty <= numberValue(product.min_stock)).length },
    ]
    for (const product of catalogProducts) {
      const label = productGroupLabel(product)
      const id = `group:${label}`
      const current = grouped.get(id)
      grouped.set(id, { id, label, count: (current?.count ?? 0) + 1 })
    }
    return [...categories, ...Array.from(grouped.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar"))]
  }, [catalogProducts])

  const visibleCatalogProducts = useMemo(() => {
    const text = catalogSearch.trim().toLowerCase()
    return catalogProducts
      .filter((product) => {
        if (catalogFilter === "available" && product.manage_inventory && product.available_qty <= 0) return false
        if (catalogFilter === "low" && (!product.manage_inventory || product.available_qty > numberValue(product.min_stock))) return false
        if (catalogFilter.startsWith("group:") && productGroupLabel(product) !== catalogFilter.slice(6)) return false
        if (text && !productSearchText(product).includes(text)) return false
        return true
      })
      .sort((a, b) => Number(Boolean(b.available_qty)) - Number(Boolean(a.available_qty)) || a.name_ar.localeCompare(b.name_ar, "ar"))
      .slice(0, 300)
  }, [catalogFilter, catalogProducts, catalogSearch])

  const shiftParams = useCallback(() => {
    if (!pharmacyId || !branchId) return null
    return new URLSearchParams({ pharmacy_id: pharmacyId, branch_id: branchId })
  }, [branchId, pharmacyId])

  const loadShift = useCallback(async () => {
    const params = shiftParams()
    if (!params) return
    setShiftLoading(true)
    try {
      const response = await fetch(`/api/sales/cashier/shift?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as ShiftResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل جلسة الكاشير")
      setShift(data.openShift ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل جلسة الكاشير")
      setShift(null)
    } finally {
      setShiftLoading(false)
    }
  }, [shiftParams])

  const fetchProducts = useCallback(async (term = query) => {
    if (!pharmacyId || !branchId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ query: term, pharmacy_id: pharmacyId, branch_id: branchId, limit: term.trim() ? "80" : "60" })
      const response = await fetch(`/api/sales/cashier?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as CashierResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الأصناف")
      setProducts(data.products ?? [])
      setRecentSales(data.recentSales ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات الكاشير")
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [branchId, pharmacyId, query])

  const fetchCatalogProducts = useCallback(async () => {
    if (!pharmacyId || !branchId) return
    setCatalogLoading(true)
    try {
      const allProducts: CashierProduct[] = []
      let offset = 0
      let hasMore = true
      let latestSales: RecentSale[] = []
      while (hasMore && offset < 5000) {
        const params = new URLSearchParams({
          query: "",
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          limit: "500",
          offset: String(offset),
        })
        const response = await fetch(`/api/sales/cashier?${params.toString()}`, { cache: "no-store" })
        const data = (await response.json().catch(() => ({}))) as CashierResponse
        if (!response.ok) throw new Error(data.error ?? "فشل تحميل قائمة الأصناف")
        allProducts.push(...(data.products ?? []))
        latestSales = data.recentSales ?? latestSales
        hasMore = Boolean(data.hasMore && data.nextOffset != null)
        offset = data.nextOffset ?? offset + 500
      }
      setCatalogProducts(Array.from(new Map(allProducts.map((product) => [product.id, product])).values()))
      setRecentSales(latestSales)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل قائمة الأصناف")
      setCatalogProducts([])
    } finally {
      setCatalogLoading(false)
    }
  }, [branchId, pharmacyId])

  const loadPrintSettings = useCallback(async () => {
    if (!pharmacyId) return
    try {
      const [designResponse, printerResponse] = await Promise.all([
        fetch("/api/settings/entities?entity=invoice-designs", { cache: "no-store" }),
        fetch("/api/settings/entities?entity=receipt-printers", { cache: "no-store" }),
      ])
      if (designResponse.ok) {
        const data = await designResponse.json().catch(() => ({})) as { rows?: InvoicePrintDesign[] }
        const rows = data.rows ?? []
        setPrintDesign(rows.find((row) => row.status !== "inactive" && row.is_default) ?? rows.find((row) => row.status !== "inactive") ?? null)
      }
      if (printerResponse.ok) {
        const data = await printerResponse.json().catch(() => ({})) as { rows?: ReceiptPrinterProfile[] }
        const rows = data.rows ?? []
        setPrinterProfile(rows.find((row) => row.status !== "inactive" && row.is_default) ?? rows.find((row) => row.status !== "inactive") ?? null)
      }
    } catch {
      setPrintDesign(null)
      setPrinterProfile(null)
    }
  }, [pharmacyId])

  useEffect(() => {
    const stored = localStorage.getItem(DRAFT_KEY)
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { lines?: CartLine[]; customerName?: string; paymentMethod?: string; invoiceDiscount?: number; paidAmount?: number }
        setLines(draft.lines ?? [])
        setCustomerName(draft.customerName ?? "نقد جمهوري")
        setPaymentMethod(draft.paymentMethod ?? "cash")
        setInvoiceDiscount(numberValue(draft.invoiceDiscount))
        setPaidAmount(numberValue(draft.paidAmount))
      } catch {}
    }
    const storedPanel = localStorage.getItem(CATALOG_PANEL_KEY)
    const storedWidth = Number(localStorage.getItem(CATALOG_PANEL_WIDTH_KEY))
    setShowCatalog(storedPanel !== "hidden")
    if (Number.isFinite(storedWidth) && storedWidth > 0) setCatalogPanelWidth(clampPanelWidth(storedWidth))
    setOfflineCount(readOfflineSales().length)
  }, [])

  useEffect(() => {
    if (!cashierBranchId && auth.activeBranchId) setCashierBranchId(auth.activeBranchId)
  }, [auth.activeBranchId, cashierBranchId])

  useEffect(() => {
    if (pharmacyId) void loadPrintSettings()
  }, [loadPrintSettings, pharmacyId])

  useEffect(() => {
    if (!pharmacyId || !branchId) return
    void loadShift()
  }, [branchId, loadShift, pharmacyId])

  useEffect(() => {
    if (!pharmacyId || !branchId || !shift) return
    const handle = window.setTimeout(() => { void fetchProducts(query) }, 220)
    return () => window.clearTimeout(handle)
  }, [branchId, fetchProducts, pharmacyId, query, shift])

  useEffect(() => {
    if (!pharmacyId || !branchId || !shift) return
    void fetchCatalogProducts()
  }, [branchId, fetchCatalogProducts, pharmacyId, shift])

  useEffect(() => {
    if (paymentMethod === "credit") setPaidAmount(0)
    else setPaidAmount(total)
  }, [paymentMethod, total])

  const setCatalogVisible = useCallback((next: boolean) => {
    setShowCatalog(next)
    localStorage.setItem(CATALOG_PANEL_KEY, next ? "visible" : "hidden")
  }, [])

  const startCatalogResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = catalogPanelWidth
    const handleMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX
      const nextWidth = clampPanelWidth(startWidth + delta)
      setCatalogPanelWidth(nextWidth)
      localStorage.setItem(CATALOG_PANEL_WIDTH_KEY, String(nextWidth))
    }
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp, { once: true })
  }, [catalogPanelWidth])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if (event.key === "F4") {
        event.preventDefault()
        setCatalogVisible(!showCatalog)
      }
      if (event.key === "F3" && calculatorEnabled) {
        event.preventDefault()
        setCalculatorOpen(true)
      }
      if (event.key === "Escape" && searchFocused) setSearchFocused(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [calculatorEnabled, searchFocused, setCatalogVisible, showCatalog])

  async function openShift() {
    if (!pharmacyId || !branchId) {
      toast.error("اختر صيدلية وفرع قبل فتح الكاشير")
      return
    }
    setOpeningSession(true)
    try {
      const response = await fetch("/api/sales/cashier/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          opening_balance: numberValue(openingCash),
          notes: openingNotes,
        }),
      })
      const data = (await response.json().catch(() => ({}))) as ShiftResponse & { alreadyOpen?: boolean }
      if (!response.ok) throw new Error(data.error ?? "فشل فتح جلسة الكاشير")
      setShift(data.shift ?? null)
      await auth.setActiveScope({ pharmacyId, branchId })
      setOpeningNotes("")
      play("shift-start", 0.45)
      window.setTimeout(() => play("drawer-open", 0.35), 120)
      toast.success(data.alreadyOpen ? "تم استرجاع جلسة الكاشير المفتوحة" : "تم فتح جلسة الكاشير")
      window.setTimeout(() => searchInputRef.current?.focus(), 80)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل فتح جلسة الكاشير")
    } finally {
      setOpeningSession(false)
    }
  }

  async function closeShift() {
    if (!shift || !pharmacyId || !branchId) return
    const entered = window.prompt("اكتب المبلغ الفعلي الموجود في الدرج لإغلاق جلسة الكاشير", String(expectedDrawer.toFixed(2)))
    if (entered === null) return
    try {
      const response = await fetch("/api/sales/cashier/shift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: pharmacyId, branch_id: branchId, shift_id: shift.id, closing_balance: numberValue(entered) }),
      })
      const data = (await response.json().catch(() => ({}))) as ShiftResponse
      if (!response.ok) throw new Error(data.error ?? "فشل إغلاق جلسة الكاشير")
      setShift(null)
      setLines([])
      play("shift-end", 0.45)
      toast.success("تم إغلاق جلسة الكاشير")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إغلاق جلسة الكاشير")
    }
  }

  function addProduct(product: CashierProduct) {
    if (product.manage_inventory && product.available_qty <= 0) {
      toast.warning("الصنف غير متاح في المخزون")
      play("warning", 0.35)
      return
    }
    if (product.nearest_expiry) {
      const batchText = product.nearest_batch_number ? ` — تشغيلة ${product.nearest_batch_number}` : ""
      toast.info(`بيع الأقرب انتهاءً أولًا: ${expiryLabel(product.nearest_expiry)}${batchText}`, {
        duration: 4500,
      })
    }
    setLines((current) => {
      const existing = current.find((line) => line.id === product.id)
      if (existing) {
        const nextQuantity = existing.quantity + 1
        if (product.manage_inventory && nextQuantity > product.available_qty) {
          toast.warning("الكمية المطلوبة أكبر من المتاح")
          return current
        }
        return current.map((line) => line.id === product.id ? { ...line, quantity: nextQuantity } : line)
      }
      return [...current, { ...product, quantity: 1, discount: 0, unit_price: product.sell_price }]
    })
    setQuery("")
    setSearchFocused(false)
    play("item-added", 0.35)
    window.setTimeout(() => searchInputRef.current?.focus(), 20)
  }

  function updateLine(id: string, updates: Partial<CartLine>) {
    setLines((current) => current.map((line) => {
      if (line.id !== id) return line
      const next = { ...line, ...updates }
      const nextQuantity = Math.max(0.001, numberValue(updates.quantity, line.quantity))
      if (line.manage_inventory && nextQuantity > line.available_qty) {
        toast.warning("الكمية المطلوبة أكبر من المتاح")
        return line
      }
      return { ...next, quantity: nextQuantity, unit_price: Math.max(0, numberValue(next.unit_price, line.unit_price)), discount: Math.max(0, numberValue(next.discount, line.discount)) }
    }))
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id))
  }

  function clearInvoice() {
    setLines([])
    setInvoiceDiscount(0)
    setCustomerName("نقد جمهوري")
    setPaymentMethod("cash")
    setPaidAmount(0)
    localStorage.removeItem(DRAFT_KEY)
  }

  function saveDraft(label = "تم حفظ المسودة على الجهاز") {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, customerName, paymentMethod, invoiceDiscount, paidAmount, savedAt: new Date().toISOString() }))
    toast.success(label)
  }

  const syncOfflineSales = useCallback(async () => {
    if (!network.online || syncingOffline) return
    const rows = readOfflineSales() as Array<Record<string, unknown>>
    if (rows.length === 0) {
      setOfflineCount(0)
      return
    }
    setSyncingOffline(true)
    const remaining: Array<Record<string, unknown>> = []
    let synced = 0
    for (const row of rows) {
      try {
        const response = await fetch("/api/sales/cashier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        })
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) throw new Error(data.error ?? "فشل مزامنة فاتورة أوفلاين")
        synced += 1
      } catch {
        remaining.push(row)
      }
    }
    writeOfflineSales(remaining)
    setOfflineCount(remaining.length)
    setSyncingOffline(false)
    if (synced > 0) {
      toast.success(`تمت مزامنة ${synced.toLocaleString("ar-EG")} فاتورة أوفلاين`)
      startTransition(() => {
        void fetchProducts("")
        void fetchCatalogProducts()
        void loadShift()
      })
    }
  }, [fetchCatalogProducts, fetchProducts, loadShift, network.online, syncingOffline])

  useEffect(() => {
    if (network.online && offlineCount > 0) void syncOfflineSales()
  }, [network.online, offlineCount, syncOfflineSales])

  async function submitSale(methodOverride?: string) {
    if (!pharmacyId || !branchId) {
      toast.error("اختر صيدلية وفرع قبل البيع")
      return
    }
    if (!shift) {
      toast.error("لازم تفتح جلسة الكاشير الأول")
      return
    }
    if (lines.length === 0) {
      toast.error("أضف صنفًا واحدًا على الأقل")
      return
    }
    const effectiveMethod = methodOverride ?? paymentMethod
    const effectivePaid = effectiveMethod === "credit" ? 0 : (effectiveMethod === "mixed" ? paidAmount : total)
    const payload = {
      client_request_id: crypto.randomUUID(),
      pharmacy_id: pharmacyId,
      branch_id: branchId,
      shift_id: shift.id,
      customer_name: customerName,
      payment_method: effectiveMethod,
      paid_amount: effectivePaid,
      discount_total: invoiceDiscount,
      lines: lines.map((line) => ({
        item_id: line.id,
        barcode: primaryProductBarcode(line),
        unit: line.unit,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount,
      })),
    }
    setSaving(true)
    try {
      if (!network.online) throw new Error("offline")
      const response = await fetch("/api/sales/cashier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string; sale?: { invoice_number?: string } }
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ الفاتورة")
      setLastInvoice({
        invoiceNumber: data.sale?.invoice_number,
        customerName,
        paymentMethod: effectiveMethod,
        savedAt: new Date().toISOString(),
        lines: lines.map((line) => ({ ...line })),
        subtotal,
        discountTotal: linesDiscount + invoiceDiscount,
        total,
        paidAmount: effectivePaid,
      })
      toast.success(`تم حفظ الفاتورة ${data.sale?.invoice_number ?? ""}`)
      play("payment-received", 0.45)
      clearInvoice()
      startTransition(() => {
        void fetchProducts("")
        void fetchCatalogProducts()
        void loadShift()
      })
    } catch (error) {
      if (error instanceof Error && error.message !== "offline") {
        toast.error(error.message)
        play("error", 0.35)
      } else {
        const rows = readOfflineSales()
        rows.push({ ...payload, saved_at: new Date().toISOString() })
        writeOfflineSales(rows)
        setOfflineCount(rows.length)
        clearInvoice()
        toast.warning("تم حفظ الفاتورة أوفلاين للمراجعة والمزامنة")
      }
    } finally {
      setSaving(false)
    }
  }

  function printInvoice() {
    const invoice: PrintableInvoice = lastInvoice ?? {
      customerName,
      paymentMethod,
      savedAt: new Date().toISOString(),
      lines,
      subtotal,
      discountTotal: linesDiscount + invoiceDiscount,
      total,
      paidAmount: paymentMethod === "credit" ? 0 : total,
    }
    if (invoice.lines.length === 0) {
      toast.error("لا توجد فاتورة للطباعة")
      return
    }
    const paperWidth = paperWidthFromProfiles(printDesign, printerProfile)
    const isA4 = paperWidth === "210mm"
    const receiptWidth = isA4 ? "190mm" : `calc(${paperWidth} - 8mm)`
    const primaryColor = printDesign?.primary_color || "#0f172a"
    const accentColor = printDesign?.accent_color || "#189e90"
    const secondaryColor = printDesign?.secondary_color || "#f8fafc"
    const showHeader = printDesign?.show_header !== false
    const showFooter = printDesign?.show_footer !== false
    const showDiscount = printDesign?.show_discount !== false
    const showTax = printDesign?.show_tax === true
    const headerText = printDesign?.header_text || auth.activePharmacy?.name || "Pharmacy"
    const footerText = printDesign?.footer_text || "شكراً لزيارتكم"
    const compactClass = printDesign?.template === "compact" || paperWidth === "58mm" ? "compact" : ""
    const safeRows = invoice.lines.map((line) => `
      <tr>
        <td><strong>${escapeHtml(line.name_ar)}</strong><small>${escapeHtml(primaryProductBarcode(line))}</small></td>
        <td>${escapeHtml(String(line.quantity))}</td>
        <td>${escapeHtml(money(line.unit_price, currency))}</td>
        <td>${escapeHtml(money(line.quantity * line.unit_price - line.discount, currency))}</td>
      </tr>`).join("")
    const html = `
      <html dir="rtl">
        <head>
          <title>${escapeHtml(invoice.invoiceNumber ? `فاتورة ${invoice.invoiceNumber}` : "فاتورة بيع")}</title>
          <style>
            @page{size:${paperWidth} auto;margin:${isA4 ? "10mm" : "4mm"}}*{box-sizing:border-box}body{font-family:${printDesign?.font_family || "Arial,Tahoma,sans-serif"};margin:0;color:#111;background:#fff}.receipt{width:${receiptWidth};margin:auto}.center{text-align:center}.muted{color:#666;font-size:11px}.row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}.brand{color:${primaryColor}}.header{border-bottom:2px solid ${primaryColor};padding-bottom:8px;margin-bottom:8px}.pill{display:inline-block;border:1px solid ${accentColor};border-radius:999px;padding:2px 8px;color:${accentColor};font-weight:900;font-size:11px;background:${secondaryColor}}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border-bottom:1px dashed #bbb;padding:6px 2px;text-align:right;font-size:11px;vertical-align:top}td small{display:block;color:#777;font-size:9px}.total{font-size:18px;font-weight:900;border:1px solid ${primaryColor};border-radius:8px;padding:8px;margin-top:8px;color:${primaryColor}}.footer{margin-top:10px;font-size:11px;text-align:center}.compact td,.compact th{font-size:10px;padding:4px 1px}.compact .total{font-size:15px;padding:6px}@media print{button{display:none}}
          </style>
        </head>
        <body>
          <section class="receipt ${compactClass}">
            ${showHeader ? `<div class="center header"><h2 class="brand">${escapeHtml(headerText)}</h2><div class="muted">${escapeHtml(activeCashierBranch?.name ?? "الفرع")}</div><div class="muted">${escapeHtml(new Date(invoice.savedAt).toLocaleString("ar-EG"))}</div>${invoice.invoiceNumber ? `<div class="pill">رقم الفاتورة: ${escapeHtml(invoice.invoiceNumber)}</div>` : ""}${printerProfile?.name ? `<div class="muted">طابعة: ${escapeHtml(printerProfile.name)}</div>` : ""}</div>` : ""}
            <div class="row"><span>العميل</span><b>${escapeHtml(invoice.customerName)}</b></div>
            <div class="row"><span>الدفع</span><b>${escapeHtml(labelFromMap(PAYMENT_METHOD_LABELS, invoice.paymentMethod))}</b></div>
            <table><thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>${safeRows}</tbody></table>
            <div class="row"><span>الإجمالي قبل الخصم</span><b>${escapeHtml(money(invoice.subtotal, currency))}</b></div>
            ${showDiscount ? `<div class="row"><span>الخصم</span><b>${escapeHtml(money(invoice.discountTotal, currency))}</b></div>` : ""}
            ${showTax ? `<div class="row"><span>الضريبة</span><b>${escapeHtml(money(0, currency))}</b></div>` : ""}
            <div class="row total"><span>الصافي</span><b>${escapeHtml(money(invoice.total, currency))}</b></div>
            <div class="row"><span>المدفوع</span><b>${escapeHtml(money(invoice.paidAmount, currency))}</b></div>
            <div class="row"><span>المتبقي</span><b>${escapeHtml(money(Math.max(0, invoice.total - invoice.paidAmount), currency))}</b></div>
            ${showFooter ? `<div class="footer">${escapeHtml(footerText)}</div>` : ""}
          </section>
        </body>
      </html>`
    const w = window.open("", "_blank", isA4 ? "width=900,height=900" : "width=420,height=680")
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && products.length > 0) {
      event.preventDefault()
      const value = query.trim().toLowerCase()
      const exactMatch = value
        ? products.find((product) => [product.sku, product.barcode, primaryProductBarcode(product), ...(product.barcodes ?? []).map((barcode) => barcode.barcode)].some((code) => code?.toLowerCase() === value))
        : null
      addProduct(exactMatch ?? products[0])
    }
  }

  if (!pharmacyId || !branchId) {
    return (
      <PageAccess permission="sales:read">
        <section dir="rtl" className="page-container py-8 text-right">
          <Alert className="rounded-3xl border-brand/10 bg-brand/5 p-6">
            <ShoppingCart className="size-5 text-brand" />
            <AlertTitle className="text-lg font-black text-slate-950">اختر صيدلية وفرع للكاشير</AlertTitle>
            <AlertDescription className="font-bold text-slate-500">المطور أو صاحب الصيدلية سيظهر له آخر صيدلية تلقائيًا، ولو عايز فرع محدد اختاره من بيانات الصيدلية الحالية.</AlertDescription>
          </Alert>
        </section>
      </PageAccess>
    )
  }

  if (!shift && !shiftLoading) {
    return (
      <PageAccess permission="sales:read">
        <section dir="rtl" className="page-container flex min-h-[calc(100dvh-90px)] items-center justify-center py-5 text-right sm:py-8">
          <Card className="w-full max-w-3xl overflow-hidden rounded-[2rem] border-slate-200 bg-white shadow-xl shadow-slate-200/60">
            <div className="bg-gradient-to-l from-brand via-sky-700 to-slate-900 px-6 py-6 text-white sm:px-8">
              <div className="flex items-center gap-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                  <Monitor className="size-7" />
                </span>
                <div>
                  <p className="text-xs font-black text-white/70">جلسة بيع جديدة</p>
                  <h1 className="mt-1 text-2xl font-black">ابدأ الكاشير</h1>
                  <p className="mt-1 text-sm font-bold text-white/75">حدد موقع التشغيل وسجّل النقدية الموجودة في الدرج.</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-6 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-950">بيانات افتتاح الوردية</h2>
                  <p className="mt-1 text-sm font-bold leading-7 text-slate-500">اختيار الفرع هنا يحدد المخزون والفواتير وحركات التشغيل الخاصة بالجلسة.</p>
                </div>
                <Badge className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{auth.activePharmacy?.name ?? "الصيدلية الحالية"}</Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-black text-slate-700"><DollarSign className="size-4 text-brand" /> النقدية في الدرج*</span>
                  <Input dir="ltr" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} className="h-12 rounded-2xl border-slate-300 text-center text-xl font-black" placeholder="0.00" autoFocus />
                </label>
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-black text-slate-700"><MapPin className="size-4 text-brand" /> موقع التشغيل / الفرع*</span>
                  <Select
                    value={branchId ?? ""}
                    onValueChange={(value) => {
                      setShift(null)
                      setCashierBranchId(value || null)
                    }}
                  >
                    <SelectTrigger className="h-12 w-full rounded-2xl border-slate-300 px-3 text-base font-black">
                      <SelectValue placeholder="اختر الفرع">{selectableBranches.find((branch) => branch.id === branchId)?.name ?? "اختر الفرع"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" sideOffset={8} className="rounded-2xl">
                      {selectableBranches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2 sm:col-span-2">
                  <span className="text-sm font-black text-slate-700">ملاحظة افتتاحية</span>
                  <Input value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} className="h-11 rounded-2xl font-bold" placeholder="اختياري — مثال: استلام وردية مسائية" />
                </label>
              </div>

              <Alert className="rounded-2xl border-sky-100 bg-sky-50/70 text-slate-700">
                <Info className="size-4 text-brand" />
                <AlertTitle className="font-black">الجلسة مرتبطة بالفرع</AlertTitle>
                <AlertDescription className="text-sm font-semibold leading-7">كل فاتورة ومخزون وحركة درج بعد الفتح ستُسجل على فرع «{activeCashierBranch?.name ?? "الفرع المحدد"}».</AlertDescription>
              </Alert>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="h-11 rounded-2xl" onClick={() => void loadShift()} disabled={shiftLoading}>
                  <RefreshCw className={cn("size-4", shiftLoading && "animate-spin")} /> تحديث الحالة
                </Button>
                <Button className="h-12 rounded-2xl px-8 text-base font-black" onClick={() => void openShift()} disabled={!canSell || openingSession || !branchId}>
                  {openingSession ? <RefreshCw className="size-4 animate-spin" /> : <DollarSign className="size-5" />} بدء جلسة كاشير
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </PageAccess>
    )
  }

  return (
    <PageAccess permission="sales:read">
      <section dir="rtl" className="fixed inset-0 z-[100] flex min-w-0 flex-col bg-slate-50 text-right">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:gap-3 sm:px-4">
          {shiftLoading ? (
            <div className="text-sm font-black text-slate-500">جارٍ تحميل جلسة الكاشير...</div>
          ) : (
            <>
              <Button variant="outline" className="h-9 rounded-2xl gap-1.5 text-xs" onClick={() => void closeShift()} disabled={!shift || saving}>
                <X className="size-3.5 text-rose-500" /> إنهاء
              </Button>
              <Button variant="outline" className="h-9 rounded-2xl gap-1.5 text-xs" onClick={() => { void fetchProducts(); void fetchCatalogProducts() }} disabled={loading || catalogLoading}>
                <RefreshCw className={cn("size-3.5", (loading || catalogLoading) && "animate-spin")} /> تحديث
              </Button>
              <Button variant={showCatalog ? "default" : "outline"} className="h-9 rounded-2xl gap-1.5 text-xs" onClick={() => setCatalogVisible(!showCatalog)}>
                <Package className="size-3.5" /> قائمة الأصناف
              </Button>
              {calculatorEnabled ? (
                <Button variant="outline" className="h-9 rounded-2xl gap-1.5 text-xs" onClick={() => setCalculatorOpen(true)} title="الآلة الحاسبة — F3">
                  <CalculatorIcon className="size-3.5" /> الحاسبة F3
                </Button>
              ) : null}
              <Button variant="outline" className="h-9 rounded-2xl gap-1.5 text-xs" onClick={() => saveDraft()} disabled={lines.length === 0}>
                <Save className="size-3.5" /> مسودة
              </Button>
              <Button variant="outline" className="h-9 rounded-2xl gap-1.5 text-xs" onClick={printInvoice} disabled={lines.length === 0 && !lastInvoice}>
                <Printer className="size-3.5" /> {lastInvoice && lines.length === 0 ? "طباعة آخر فاتورة" : "طباعة"}
              </Button>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs font-black text-slate-600 sm:mr-auto sm:w-auto">
                <span className="inline-flex h-7 items-center gap-1 rounded-xl bg-brand px-2.5 text-white"><Clock className="size-3" /> {shiftTime(shift?.opened_at)}</span>
                <span className="inline-flex h-7 items-center rounded-xl border border-slate-200 px-2.5">{auth.activePharmacy?.name ?? "الصيدلية"}</span>
                <span className="inline-flex h-7 items-center rounded-xl border border-slate-200 px-2.5">{activeCashierBranch?.name ?? "الرئيسي"}</span>
              </div>
            </>
          )}
        </div>

        {offlineCount > 0 ? (
          <Alert className="mx-3 mt-3 rounded-2xl border-amber-100 bg-amber-50 text-amber-800 sm:mx-4">
            <WifiOff className="size-4" />
            <AlertTitle className="font-black">فواتير أوفلاين محفوظة</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3 font-bold">
              <span>يوجد {offlineCount.toLocaleString("ar-EG")} فاتورة محفوظة محليًا.</span>
              <Button size="sm" variant="secondary" className="h-8 rounded-xl" onClick={() => void syncOfflineSales()} disabled={!network.online || syncingOffline}>
                {syncingOffline ? "جاري المزامنة..." : "مزامنة الآن"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-3">
              <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(300px,520px)_minmax(0,1fr)]">
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40">
                  <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><UserPlus className="size-4" strokeWidth={2.2} /></span>
                  <Input className="h-full flex-1 rounded-none border-0 bg-transparent px-3 text-right text-sm font-bold shadow-none placeholder:font-bold focus-visible:ring-0" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="نقد جمهوري" />
                </div>
                <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40">
                  <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><Wallet className="size-4" strokeWidth={2.2} /></span>
                  <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "cash")}>
                    <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent py-0 text-sm font-bold shadow-none hover:bg-transparent focus-visible:ring-0">
                      <SelectValue>{labelFromMap(PAYMENT_METHOD_LABELS, paymentMethod)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" sideOffset={8}>
                      <SelectItem value="cash">نقدي</SelectItem>
                      <SelectItem value="card">بطاقة</SelectItem>
                      <SelectItem value="wallet">محفظة</SelectItem>
                      <SelectItem value="mixed">دفع متعدد</SelectItem>
                      <SelectItem value="credit">بيع آجل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40 sm:col-span-2">
                  <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><CreditCard className="size-4" strokeWidth={2.2} /></span>
                  <Select value={priceList} onValueChange={(value) => setPriceList(value ?? "default")}>
                    <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent py-0 text-sm font-bold shadow-none hover:bg-transparent focus-visible:ring-0">
                      <SelectValue>{labelFromMap(PRICE_LIST_LABELS, priceList)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" sideOffset={8}>
                      <SelectItem value="default">سعر البيع الافتراضي</SelectItem>
                      <SelectItem value="wholesale">سعر الجملة</SelectItem>
                      <SelectItem value="offer">سعر العروض</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="relative min-w-0">
                <div className="flex h-14 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all focus-within:border-brand focus-within:shadow-md focus-within:shadow-brand/10">
                  <button type="button" className="flex w-14 items-center justify-center border-l-2 border-slate-200 text-brand transition hover:bg-brand/5" onClick={() => setSearchFocused(true)} title="إضافة صنف">
                    <Package className="size-6" strokeWidth={2.2} />
                  </button>
                  <Input
                    ref={searchInputRef}
                    className="h-full flex-1 rounded-none border-0 bg-transparent px-3 text-right text-base font-black text-slate-900 shadow-none placeholder:font-bold placeholder:text-slate-400 focus-visible:ring-0 sm:px-4 sm:text-lg"
                    value={query}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => window.setTimeout(() => setSearchFocused(false), 200)}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="🔍  امسح الباركود أو اكتب اسم الصنف..."
                    autoFocus
                  />
                  <button type="button" onClick={() => void fetchProducts(query)} className="flex w-14 items-center justify-center border-r-2 border-slate-200 text-slate-500 transition hover:bg-brand/5 hover:text-brand" title="بحث">
                    <Search className="size-5" />
                  </button>
                </div>
                {searchFocused ? (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[min(460px,60dvh)] overflow-auto rounded-2xl border-2 border-slate-200 bg-white p-2 text-right shadow-2xl shadow-slate-200/60 pharmacy-scrollbar">
                    {loading ? (
                      <div className="grid gap-2 p-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-xl p-3">
                            <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 w-3/4 animate-pulse rounded-lg bg-slate-100" />
                              <div className="h-3 w-1/2 animate-pulse rounded-lg bg-slate-100" />
                            </div>
                            <div className="h-8 w-20 animate-pulse rounded-xl bg-slate-100" />
                          </div>
                        ))}
                      </div>
                    ) : products.length === 0 ? (
                      <EmptyState icon={Package} title="لا توجد أصناف مطابقة" description="حاول تغيير كلمة البحث" />
                    ) : (
                      <div className="grid gap-1.5">
                        {products.map((product) => {
                          const low = product.manage_inventory && product.available_qty <= 0
                          return (
                            <button
                              key={product.id}
                              type="button"
                              onMouseDown={(event) => { event.preventDefault(); addProduct(product) }}
                              className={cn(
                                "group flex w-full items-center gap-4 rounded-2xl border-2 p-3.5 text-right transition-all duration-150",
                                low
                                  ? "border-rose-100 bg-rose-50/70 hover:border-rose-300 hover:bg-rose-50"
                                  : "border-transparent bg-slate-50 hover:border-brand/30 hover:bg-brand/[0.03] hover:shadow-sm",
                              )}
                            >
                              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200 transition group-hover:ring-brand/20">
                                <Package className="size-6" strokeWidth={1.8} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-base font-black text-slate-950">{product.name_ar}</span>
                                  {product.name_en ? <span className="hidden truncate text-xs font-bold text-slate-400 sm:inline" dir="ltr">{product.name_en}</span> : null}
                                </span>
                                <span className="mt-0.5 flex items-center gap-2 text-xs font-bold text-slate-400">
                                  <Barcode className="size-3" />
                                  <span dir="ltr">{primaryProductBarcode(product) || "بدون باركود"}</span>
                                </span>
                                {product.nearest_expiry ? (
                                  <span className="mt-1 flex items-center gap-1 text-[11px] font-black text-amber-700">
                                    <CalendarDays className="size-3" />
                                    بيع الأقرب: {expiryLabel(product.nearest_expiry)}
                                  </span>
                                ) : null}
                              </span>
                              <Badge className={cn("shrink-0 rounded-xl px-3 py-1 text-xs font-black", low ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                                {product.manage_inventory ? `${product.available_qty.toLocaleString("ar-EG")} ${product.unit ?? ""}` : "مفتوح"}
                              </Badge>
                              <span className="shrink-0 text-left text-lg font-black text-brand tabular-nums">{money(numberValue(product.sell_price), currency)}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "grid min-h-0 flex-1 gap-3",
                showCatalog ? "xl:grid-cols-[var(--cashier-catalog-width)_minmax(0,1fr)]" : "xl:grid-cols-1",
              )}
              style={cashierGridStyle}
            >
              {showCatalog ? (
                <aside className="relative flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 shadow-inner shadow-slate-100/70">
                  <button
                    type="button"
                    aria-label="تغيير عرض قائمة الأصناف"
                    onPointerDown={startCatalogResize}
                    className="absolute -left-1 top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center rounded-l-xl text-slate-300 transition hover:bg-brand/10 hover:text-brand xl:flex"
                  >
                    <span className="h-12 w-1 rounded-full bg-current" />
                  </button>

                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                        <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand"><Package className="size-4" /></span>
                        قائمة الأصناف السريعة
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-400">{visibleCatalogProducts.length.toLocaleString("ar-EG")} من {catalogProducts.length.toLocaleString("ar-EG")} صنف — F4 إظهار/إخفاء</p>
                    </div>
                    <Button size="icon" variant="ghost" className="size-8 shrink-0 rounded-xl" onClick={() => setCatalogVisible(false)} title="إخفاء القائمة">
                      <X className="size-4" />
                    </Button>
                  </div>

                  <div className="grid shrink-0 gap-2 border-b border-slate-100 bg-white/80 p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={catalogSearch}
                        onChange={(event) => setCatalogSearch(event.target.value)}
                        placeholder="فلتر القائمة: اسم / باركود / مجموعة"
                        className="h-10 rounded-2xl border-slate-200 bg-white pr-9 pl-3 text-right text-sm font-bold shadow-none focus-visible:ring-2 focus-visible:ring-brand/15"
                      />
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 pharmacy-scrollbar">
                      {catalogCategories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setCatalogFilter(category.id)}
                          className={cn(
                            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition",
                            catalogFilter === category.id
                              ? "border-brand bg-brand text-white shadow-sm shadow-brand/20"
                              : "border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:text-brand",
                          )}
                        >
                          {category.label}
                          <span className="mr-1 opacity-70">{category.count.toLocaleString("ar-EG")}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-2 pharmacy-scrollbar">
                    {catalogLoading ? (
                      <div className="grid gap-2">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-2xl bg-white p-2">
                            <div className="size-10 animate-pulse rounded-xl bg-slate-100" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
                              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                            </div>
                            <div className="h-7 w-16 animate-pulse rounded-xl bg-slate-100" />
                          </div>
                        ))}
                      </div>
                    ) : visibleCatalogProducts.length === 0 ? (
                      <EmptyState icon={Package} title="لا توجد أصناف" description="لا توجد أصناف في هذا الفلتر" />
                    ) : (
                      <div className="grid gap-1.5">
                        {visibleCatalogProducts.map((product) => {
                          const low = product.manage_inventory && product.available_qty <= 0
                          return (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => addProduct(product)}
                              className={cn(
                                "group flex w-full items-center gap-2 rounded-2xl border bg-white p-2 text-right transition hover:-translate-y-0.5 hover:shadow-sm",
                                low ? "border-rose-100 bg-rose-50/60" : "border-slate-100 hover:border-brand/25",
                              )}
                            >
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400 ring-1 ring-slate-100 group-hover:text-brand">
                                <Package className="size-5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-black text-slate-950">{product.name_ar}</span>
                                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-bold text-slate-400">
                                  <Barcode className="size-3 shrink-0" />
                                  <span className="truncate" dir="ltr">{primaryProductBarcode(product) || "بدون باركود"}</span>
                                </span>
                                <span className="mt-1 block truncate text-[11px] font-black text-slate-400">{productGroupLabel(product)}</span>
                                {product.nearest_expiry ? (
                                  <span className="mt-1 flex items-center gap-1 text-[11px] font-black text-amber-700">
                                    <CalendarDays className="size-3" /> {expiryLabel(product.nearest_expiry)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className="text-sm font-black text-brand tabular-nums">{money(numberValue(product.sell_price), currency)}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-black", low ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                                  {product.manage_inventory ? product.available_qty.toLocaleString("ar-EG") : "خدمة"}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </aside>
              ) : null}

              <div className="flex min-h-0 flex-col gap-3">
                {lines.some((line) => line.nearest_expiry) ? (
                  <Alert className="shrink-0 rounded-2xl border-amber-200 bg-amber-50 text-amber-900">
                    <CalendarDays className="size-4" />
                    <AlertTitle className="font-black">طبّق الأقرب انتهاءً أولًا (FEFO)</AlertTitle>
                    <AlertDescription className="font-bold text-amber-800">
                      النظام سيخصم تلقائيًا من أقرب تشغيلة صالحة عند حفظ الفاتورة.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="min-h-[260px] flex-1 overflow-auto rounded-2xl border border-slate-100 bg-white pharmacy-scrollbar">
                  <Table className="min-w-[900px]">
                    <TableHeader className="bg-slate-50/70">
                      <TableRow>
                        <TableHead className="w-12 text-center"><X className="mx-auto size-4" /></TableHead>
                        <TableHead className="text-right">صنف <Info className="inline size-3 text-brand" /></TableHead>
                        <TableHead className="w-[170px] text-center">سعر الوحدة</TableHead>
                        <TableHead className="w-[180px] text-center">الكمية</TableHead>
                        <TableHead className="w-[140px] text-center">خصم الصنف</TableHead>
                        <TableHead className="w-[160px] text-center">المجموع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-center"><Button size="icon" variant="ghost" className="size-8 text-rose-500" onClick={() => removeLine(line.id)}><Trash2 className="size-4" /></Button></TableCell>
                          <TableCell className="min-w-[220px]">
                            <div className="font-black text-slate-950">{line.name_ar}</div>
                            <div className="text-xs font-bold text-slate-400" dir="ltr">{primaryProductBarcode(line) || "—"}</div>
                            {line.nearest_expiry ? (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
                                <CalendarDays className="size-3" />
                                الأقرب: {expiryLabel(line.nearest_expiry)}
                                {line.nearest_batch_number ? ` — ${line.nearest_batch_number}` : ""}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell><Input disabled={!canPriceOverride} className="h-9 rounded-xl text-center font-black disabled:bg-slate-50 disabled:text-slate-500" dir="ltr" value={line.unit_price} onChange={(e) => updateLine(line.id, { unit_price: numberValue(e.target.value, line.unit_price) })} /></TableCell>
                          <TableCell><div className="flex items-center justify-center gap-1"><Button size="icon" variant="outline" className="size-8 rounded-lg" onClick={() => updateLine(line.id, { quantity: line.quantity - 1 })}><Minus className="size-3" /></Button><Input className="h-8 w-16 rounded-lg text-center font-black" dir="ltr" value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: numberValue(e.target.value, 1) })} /><Button size="icon" variant="outline" className="size-8 rounded-lg" onClick={() => updateLine(line.id, { quantity: line.quantity + 1 })}><Plus className="size-3" /></Button></div></TableCell>
                          <TableCell><Input disabled={!canDiscount} className="h-9 rounded-xl text-center font-black disabled:bg-slate-50 disabled:text-slate-500" dir="ltr" value={line.discount} onChange={(e) => updateLine(line.id, { discount: numberValue(e.target.value, line.discount) })} /></TableCell>
                          <TableCell className="text-center font-black text-brand">{money(lineTotal(line), currency)}</TableCell>
                        </TableRow>
                      ))}
                      {lines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-full min-h-[30dvh] text-center">
                            <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-slate-400">
                              <ShoppingCart className="size-12" />
                              <p className="text-base font-black">ابدأ بمسح باركود أو البحث عن صنف</p>
                              <p className="text-sm font-bold">Enter يضيف أول نتيجة، وF4 يفتح قائمة الأصناف السريعة.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid shrink-0 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-400">الكمية</div><div className="mt-1 text-lg font-black text-slate-950">{lines.reduce((t, l) => t + l.quantity, 0).toLocaleString("ar-EG")}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-400">المجموع</div><div className="mt-1 text-lg font-black text-slate-950">{money(subtotal, currency)}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><Label className="text-xs font-black text-slate-400">خصم الفاتورة (-)</Label><Input disabled={!canDiscount} dir="ltr" className="mt-1 h-9 rounded-xl text-center font-black" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(numberValue(e.target.value))} /></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><Label className="text-xs font-black text-slate-400">المدفوع</Label><Input dir="ltr" className="mt-1 h-9 rounded-xl text-center font-black" value={paidAmount} onChange={(e) => setPaidAmount(numberValue(e.target.value))} /></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

        {showRecent ? (
          <div className="absolute bottom-[9.5rem] left-3 z-50 w-[min(420px,calc(100vw-1.5rem))] rounded-3xl border border-slate-200 bg-white p-4 text-right shadow-2xl sm:left-4 sm:w-[min(420px,calc(100vw-2rem))] lg:bottom-20" dir="rtl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black text-slate-950">العمليات الأخيرة</h3>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => setShowRecent(false)}><X className="size-4" /></Button>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto pharmacy-scrollbar">
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-xs font-bold">
                  <span className="min-w-0 truncate">{sale.invoice_number} — {sale.customer_name}</span>
                  <span className="shrink-0 font-black text-brand">{money(numberValue(sale.total), currency)}</span>
                </div>
              ))}
              {recentSales.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center text-sm font-bold text-slate-400">لا توجد عمليات حديثة</p> : null}
            </div>
          </div>
        ) : null}

        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-6px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:px-4 lg:flex-row lg:items-center lg:gap-3">
          <Button type="button" onClick={() => setShowRecent((v) => !v)} className="h-10 w-full shrink-0 rounded-full bg-brand px-4 text-sm text-white hover:bg-brand-hover sm:w-auto">
            <Clock className="size-4" /> العمليات الأخيرة
          </Button>

          <div className="mx-auto flex w-full min-w-0 items-center justify-center gap-2 lg:w-auto lg:min-w-[200px]">
            <div className="rounded-lg bg-emerald-50 px-4 py-1 text-2xl font-black tabular-nums text-emerald-700 ring-1 ring-emerald-200 sm:text-3xl">{due.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-center text-base font-black leading-5 text-slate-950">رصيد<br />الفاتورة</div>
          </div>

          <div className="flex w-full min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto pb-1 pharmacy-scrollbar lg:w-auto lg:pb-0">
            <Button variant="destructive" className="shrink-0 h-9 rounded-xl px-4 text-sm font-black" onClick={clearInvoice} disabled={saving || lines.length === 0}><X className="size-4" /> إلغاء</Button>
            <Button className="shrink-0 h-9 rounded-xl bg-emerald-600 px-4 text-sm font-black hover:bg-emerald-700" onClick={() => void submitSale("cash")} disabled={!canSell || saving || isPending || lines.length === 0}><DollarSign className="size-4" /> نقدي</Button>
            <Button className="shrink-0 h-9 rounded-xl bg-slate-950 px-4 text-sm font-black hover:bg-slate-800" onClick={() => void submitSale("mixed")} disabled={!canSell || saving || isPending || lines.length === 0}><Wallet className="size-4" /> متعدد</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black text-brand" onClick={() => void submitSale("card")} disabled={!canSell || saving || isPending || lines.length === 0}><CreditCard className="size-4" /> بطاقة</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black" onClick={() => void submitSale("credit")} disabled={!canSell || saving || isPending || lines.length === 0}><Receipt className="size-4" /> أجل</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black" onClick={() => saveDraft("تم حفظ عرض السعر كمسودة") } disabled={lines.length === 0}><FileText className="size-4" /> عرض سعر</Button>
          </div>

          <Separator orientation="vertical" className="hidden h-8 lg:block" />
          <div className="hidden shrink-0 items-center gap-1.5 text-xs font-black text-slate-500 lg:flex">
            <CalculatorIcon className="size-4" /> الدرج: <span className="text-brand">{money(expectedDrawer, currency)}</span>
          </div>
        </footer>

        <Dialog open={calculatorOpen} onOpenChange={setCalculatorOpen}>
          <DialogContent dir="rtl" className="max-w-[340px] rounded-3xl border-slate-200 bg-slate-50 p-5 shadow-2xl">
            <DialogHeader className="text-right">
              <DialogTitle className="flex items-center gap-2 text-lg font-black text-slate-950">
                <CalculatorIcon className="size-5 text-brand" /> الآلة الحاسبة
              </DialogTitle>
              <DialogDescription className="font-bold">احسب بسرعة، ويمكنك نقل الناتج إلى خانة المدفوع.</DialogDescription>
            </DialogHeader>
            <CalculatorWidget className="mx-auto w-full" autoFocus onResult={setCalculatorResult} />
            <DialogFooter className="-mx-5 -mb-5 px-5">
              <Button
                className="h-10 rounded-xl font-black"
                onClick={() => {
                  setPaidAmount(Math.max(0, calculatorResult))
                  setCalculatorOpen(false)
                  toast.success("تم وضع ناتج الحاسبة في المدفوع")
                }}
              >
                استخدام {money(calculatorResult, currency)} كمدفوع
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
