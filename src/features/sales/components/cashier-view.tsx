"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"
import {
  AlertCircle,
  Info,
  ListChecks,
  Percent,
  DollarSign,
  Barcode,
  Calculator as CalculatorIcon,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  ExternalLink,
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
import { useNetwork, useSyncStatus } from "@/hooks/use-data-layer"
import { queueApiRequest } from "@/lib/sync/api-mutations"
import { localDB } from "@/lib/sync/local-db"
import { syncManager } from "@/lib/sync/sync-manager"
import { loadOfflineCashierCatalog, loadOfflineOpenShift, executeOfflineSale } from "@/features/sales/lib/offline-cashier"
import { useSound } from "@/hooks/use-sound"
import { cn } from "@/lib/utils"
import { numberValue, escapeHtml, labelFromMap } from "@/lib/helpers"
import { money } from "@/lib/formatters"
import { EmptyState } from "@/components/shared/empty-state"
import { Calculator as CalculatorWidget } from "@/features/calculator"
import { apiClient, isNetworkError } from "@/lib/api-client"
import type { CashierShiftSnapshot } from "@/features/sales/types/cashier-session"
import {
  CashierCloseDialog,
  CashierSessionDialog,
  CashierShortcutsDialog,
  InvoiceDiscountDialog,
} from "@/features/sales/components/cashier-operations-dialogs"
import { CashierAlertCenter, type CashierOperationalAlert } from "@/features/sales/components/cashier-alert-center"
import type { CashierStockIssue } from "@/features/sales/lib/cashier-stock"
import { unitPolicyService } from "@/domain/inventory/units/unit-policy"

type CashierProductBarcode = {
  barcode?: string | null
  is_primary?: boolean | null
}

type CashierProductUnit = {
  id: string
  unit_name: string
  position: number
  conversion_to_lowest: number
  barcode: string | null
  sell_price: number
  old_sell_price: number | null
  sale_enabled: boolean
  is_base: boolean
}

type CashierProduct = {
  id: string
  name_ar: string
  name_en?: string | null
  sku?: string | null
  barcode?: string | null
  barcodes?: CashierProductBarcode[]
  units?: CashierProductUnit[]
  unit?: string | null
  sell_price: number
  old_sell_price?: number | null
  buy_price?: number
  available_qty: number
  physical_qty?: number
  sellable_qty?: number
  valid_batch_qty?: number
  expired_batch_qty?: number
  unallocated_qty?: number
  stock_issue?: CashierStockIssue
  stock_message?: string | null
  manage_inventory?: boolean
  min_stock?: number | null
  group_id?: string | null
  group_name?: string | null
  brand_id?: string | null
  brand_name?: string | null
  category?: string | null
  manufacturer_name?: string | null
  item_type?: string | null
  is_controlled?: boolean
  requires_prescription?: boolean
  has_expiry?: boolean
  track_batch?: boolean
  nearest_batch_id?: string | null
  nearest_batch_number?: string | null
  nearest_expiry?: string | null
  active_batches_count?: number
  expired_batches_count?: number
}

type CartLine = CashierProduct & {
  quantity: number
  discount: number
  unit_price: number
  unitId: string | null
  unitName: string
  unitPosition: 1 | 2 | 3
  conversionToBase: number
  unitBarcode: string | null
}

type CustomerOption = { id: string; name: string; phone?: string | null }
type PatientOption = { id: string; partner_id?: string | null; name: string; phone?: string | null }

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
  user_id?: string | null
  opened_at: string
  closed_at?: string | null
  opening_balance: number
  closing_balance?: number | null
  expected_balance: number | null
  difference?: number | null
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
  snapshot?: CashierShiftSnapshot | null
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

type PriceGroup = {
  id: string
  name: string
  markup_percent?: number | null
  status?: string | null
  is_default?: boolean | null
}

type ReceiptPrinterProfile = {
  name?: string
  paper_width?: number | null
  is_default?: boolean | null
  status?: string | null
}

const LEGACY_OFFLINE_SALES_KEY = "pharmacy_cashier_offline_sales_v1"
const DRAFT_KEY = "pharmacy_cashier_draft_v1"
const CATALOG_PANEL_KEY = "pharmacy_cashier_catalog_panel_v2"
const CATALOG_PANEL_WIDTH_KEY = "pharmacy_cashier_catalog_panel_width_v1"

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "نقدي", card: "بطاقة", credit: "آجل", mixed: "متعدد", wallet: "محفظة", "bank-transfer": "تحويل بنكي",
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

function readLegacyOfflineSales() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_OFFLINE_SALES_KEY) ?? "[]") as unknown[]
  } catch {
    return []
  }
}

function clearLegacyOfflineSales() {
  localStorage.removeItem(LEGACY_OFFLINE_SALES_KEY)
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

function quantityPolicyFor(product: Pick<CashierProduct, "unit">) {
  return unitPolicyService.policyFor({ unit_name: product.unit })
}

function normalizeCashierQuantity(product: Pick<CashierProduct, "unit">, value: unknown, fallback = 1) {
  const policy = quantityPolicyFor(product)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return policy.normalize(fallback, { min: policy.allowsFraction ? 0.001 : 1 })
  return policy.normalize(parsed, { min: policy.allowsFraction ? 0.001 : 1 })
}

function quantityStep(product: Pick<CashierProduct, "unit">) {
  return quantityPolicyFor(product).allowsFraction ? 0.001 : 1
}

function stockQuantityLabel(value: number) {
  return Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 3 })
}

function clampPanelWidth(value: number) {
  return Math.min(620, Math.max(320, Math.round(value)))
}

function fallbackShiftSnapshot(shift: CashierShift, closingBalance?: number | null): CashierShiftSnapshot {
  const openingBalance = numberValue(shift.opening_balance)
  const cashSales = numberValue(shift.cash_sales)
  const cardSales = numberValue(shift.card_sales)
  const creditSales = numberValue(shift.credit_sales)
  const paidTotal = numberValue(shift.total_collected, cashSales + cardSales)
  const expensesTotal = numberValue(shift.total_expenses)
  const expectedDrawer = numberValue(shift.expected_balance, openingBalance + cashSales - expensesTotal)
  const actualDrawer = closingBalance ?? (shift.closing_balance == null ? null : numberValue(shift.closing_balance))
  const openedAt = new Date(shift.opened_at).getTime()
  const closedAt = shift.closed_at ? new Date(shift.closed_at).getTime() : Date.now()
  const durationMinutes = Number.isFinite(openedAt) && Number.isFinite(closedAt) && closedAt > openedAt
    ? Math.floor((closedAt - openedAt) / 60_000)
    : 0

  return {
    shift,
    metrics: {
      invoiceCount: 0,
      grossSales: cashSales + cardSales + creditSales,
      discountTotal: 0,
      netSales: cashSales + cardSales + creditSales,
      paidTotal,
      dueTotal: creditSales,
      cashCollected: cashSales,
      cardCollected: cardSales,
      walletCollected: 0,
      transferCollected: 0,
      mixedCollected: 0,
      expenseCount: 0,
      expensesTotal,
      openingBalance,
      expectedDrawer,
      actualDrawer,
      drawerDifference: actualDrawer == null ? null : actualDrawer - expectedDrawer,
      durationMinutes,
      lastSaleAt: null,
    },
    recentSales: [],
  }
}

type CashierStockAlert = { productId: string; title: string; description: string }

type CartLineUpdates = Omit<Partial<CartLine>, "quantity"> & { quantity?: number | string }

function priceForGroup(product: CashierProduct, group: PriceGroup | null) {
  if (!group) return Math.max(0, numberValue(product.sell_price))
  const buyPrice = Math.max(0, numberValue(product.buy_price))
  const markup = Math.max(0, numberValue(group.markup_percent))
  if (buyPrice <= 0) return Math.max(0, numberValue(product.sell_price))
  return Math.round((buyPrice * (1 + markup / 100) + Number.EPSILON) * 100) / 100
}



export function CashierView() {
  const auth = useAuth()
  const network = useNetwork()
  const syncStatus = useSyncStatus()
  const settings = useAppSettings()
  const cashierSoundsEnabled = settings.bool("cashier", "enableSounds", true)
  const cashierSoundVolume = Math.min(1, Math.max(0, settings.number("cashier", "soundVolume", 55) / 100))
  const { play, unlock: unlockAudio } = useSound({ enabled: cashierSoundsEnabled, defaultVolume: cashierSoundVolume })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const currency = settings.get("project", "currencySymbol", "ج.م")

  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<CashierProduct[]>([])
  const [catalogProducts, setCatalogProducts] = useState<CashierProduct[]>([])
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [lines, setLines] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState("نقد جمهوري")
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [priceList, setPriceList] = useState("default")
  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([])
  const [paidAmount, setPaidAmount] = useState(0)
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [couponCode, setCouponCode] = useState("")
  const [couponDiscount, setCouponDiscount] = useState(0)
  const [couponValidating, setCouponValidating] = useState(false)
  const [couponPanelOpen, setCouponPanelOpen] = useState(false)
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; label: string } | null>(null)
  const [patientName, setPatientName] = useState("")
  const [patientId, setPatientId] = useState<string | null>(null)
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([])
  const [doctorName, setDoctorName] = useState("")
  const [prescriptionNumber, setPrescriptionNumber] = useState("")
  const [loading, setLoading] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)
  const [stockAlerts, setStockAlerts] = useState<CashierStockAlert[]>([])
  const saleRequestRef = useRef<{ fingerprint: string; id: string } | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState("")
  const [catalogFilter, setCatalogFilter] = useState("all")
  const [catalogPanelWidth, setCatalogPanelWidth] = useState(370)
  const [cashierBranchId, setCashierBranchId] = useState<string | null>(null)
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calculatorResult, setCalculatorResult] = useState(0)
  const [shift, setShift] = useState<CashierShift | null>(null)
  const [shiftSnapshot, setShiftSnapshot] = useState<CashierShiftSnapshot | null>(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [closeShiftDialogOpen, setCloseShiftDialogOpen] = useState(false)
  const [closeSummaryOpen, setCloseSummaryOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false)
  const [unitSelectorOpen, setUnitSelectorOpen] = useState(false)
  const [unitSelectorProduct, setUnitSelectorProduct] = useState<CashierProduct | null>(null)
  const [unitSelectorSource, setUnitSelectorSource] = useState<"barcode" | "search" | "catalog">("catalog")
  const [closingShift, setClosingShift] = useState(false)
  const [shiftClosedPendingReset, setShiftClosedPendingReset] = useState(false)
  const [openingCash, setOpeningCash] = useState("0")
  const [openingNotes, setOpeningNotes] = useState("")
  const [openingSession, setOpeningSession] = useState(false)
  const [lastInvoice, setLastInvoice] = useState<PrintableInvoice | null>(null)
  const [printDesign, setPrintDesign] = useState<InvoicePrintDesign | null>(null)
  const [printerProfile, setPrinterProfile] = useState<ReceiptPrinterProfile | null>(null)
  const [isPending, startTransition] = useTransition()

  const discountFeatureEnabled = settings.bool("sales", "enableDiscount", true)
  const priceOverrideFeatureEnabled = settings.bool("sales", "enablePriceOverride", true)
  const canDiscount = discountFeatureEnabled && (
    auth.isDeveloper
    || auth.isOwner
    || ["owner", "admin", "manager", "pharmacist"].includes(auth.role)
    || auth.can("sales:discount")
  )
  const canPriceOverride = priceOverrideFeatureEnabled && (auth.isDeveloper || auth.can("sales:price-override"))
  const canSell = auth.isDeveloper || auth.can("sales:write")
  const pharmacyId = auth.activePharmacyId
  const authUserId = auth.user?.id ?? null
  const branchId = cashierBranchId ?? auth.activeBranchId
  const activeCashierBranch = auth.branches.find((branch) => branch.id === branchId) ?? auth.activeBranch
  useEffect(() => {
    if (!pharmacyId) { setCustomerOptions([]); setPatientOptions([]); return }
    let cancelled = false
    void Promise.all([
      fetch(`/api/partners?pharmacy_id=${encodeURIComponent(pharmacyId)}&type=customer&status=active&page_size=250`, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/patients?pharmacy_id=${encodeURIComponent(pharmacyId)}&status=active&page_size=100`, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()),
    ]).then(([partnersData, patientsData]) => {
      if (cancelled) return
      setCustomerOptions((partnersData.partners ?? []) as CustomerOption[])
      setPatientOptions((patientsData.patients ?? []) as PatientOption[])
    }).catch(async () => {
      if (cancelled) return
      try {
        const [partners, patients] = await Promise.all([localDB.getTableRows("pharmacy_partners"), localDB.getTableRows("pharmacy_patients")])
        setCustomerOptions(partners.filter((row) => row.pharmacy_id === pharmacyId && row.status === "active" && ["customer","both"].includes(String(row.type))).map((row) => ({ id: String(row.id), name: String(row.name), phone: row.phone ? String(row.phone) : null })))
        setPatientOptions(patients.filter((row) => row.pharmacy_id === pharmacyId && row.status === "active").map((row) => ({ id: String(row.id), partner_id: row.partner_id ? String(row.partner_id) : null, name: String(row.name), phone: row.phone ? String(row.phone) : null })))
      } catch { setCustomerOptions([]); setPatientOptions([]) }
    })
    return () => { cancelled = true }
  }, [pharmacyId])
  const selectableBranches = useMemo(() => {
    if (auth.isDeveloper || auth.isOwner || ["owner", "admin"].includes(auth.role)) return auth.branches
    const membership = auth.memberships.find((row) => row.pharmacy_id === pharmacyId)
    return membership?.branch_id
      ? auth.branches.filter((branch) => branch.id === membership.branch_id)
      : auth.branches
  }, [auth.branches, auth.isDeveloper, auth.isOwner, auth.memberships, auth.role, pharmacyId])
  const calculatorEnabled = settings.bool("cashier", "enableCalculator", true)
  const searchEnabled = settings.bool("cashier", "enableSearch", true)
  const barcodeSearchEnabled = settings.bool("cashier", "enableBarcodeSearch", true)
  const categoryFilterEnabled = settings.bool("cashier", "enableCategoryFilter", true)
  const customerSelectionEnabled = settings.bool("cashier", "enableCustomerSelection", true)
  const holdSaleEnabled = settings.bool("cashier", "holdSaleEnabled", true)
  const quickSaleEnabled = settings.bool("cashier", "quickSaleEnabled", true)
  const audioOnScan = settings.bool("cashier", "audioOnScan", true)
  const showItemStock = settings.bool("cashier", "showItemStock", true)
  const showItemPrice = settings.bool("cashier", "showItemPrice", true)
  const showExpiryInSales = settings.bool("items", "showExpiryInSales", true)
  const showBatchInSales = settings.bool("items", "showBatchInSales", false)
  const allowNegativeStock = settings.bool("items", "allowNegativeStock", false)
  const saleItemBehavior = settings.get("sales", "saleItemBehavior", "increase")
  const searchMinChars = Math.max(1, settings.number("cashier", "searchMinChars", 2))
  const maxDiscountPercent = Math.min(100, Math.max(0, settings.number("sales", "maxDiscountPercent", 100)))
  const acceptedPaymentMethods = useMemo(() => {
    const methods = new Set(
      settings.get("payments", "acceptedPaymentMethods", "cash,card")
        .split(",")
        .map((value) => value.trim())
        .map((value) => value === "bank" ? "bank-transfer" : value)
        .filter(Boolean),
    )
    methods.add("cash")
    if (!settings.bool("payments", "enableCardPayment", true)) methods.delete("card")
    if (settings.bool("payments", "enableWalletPayment", true)) methods.add("wallet")
    else methods.delete("wallet")
    if (settings.bool("payments", "enableBankTransfer", true)) methods.add("bank-transfer")
    else methods.delete("bank-transfer")
    if (settings.bool("payments", "enablePartialPayment", true)) methods.add("mixed")
    else methods.delete("mixed")
    methods.add("credit")
    return Array.from(methods)
  }, [settings])
  const selectedPriceGroup = useMemo(() => priceGroups.find((group) => group.id === priceList) ?? null, [priceGroups, priceList])
  const effectiveProductPrice = useCallback((product: CashierProduct) => priceForGroup(product, selectedPriceGroup), [selectedPriceGroup])

  const subtotal = useMemo(() => lines.reduce((total, line) => total + line.quantity * line.unit_price, 0), [lines])
  const linesDiscount = useMemo(() => lines.reduce((total, line) => total + line.discount, 0), [lines])
  const total = useMemo(() => Math.max(0, subtotal - linesDiscount - invoiceDiscount - couponDiscount), [couponDiscount, invoiceDiscount, linesDiscount, subtotal])
  const invoiceFingerprint = useMemo(() => JSON.stringify({
    branchId,
    customerId,
    customerName,
    patientId,
    paymentMethod,
    paidAmount,
    invoiceDiscount,
    couponCode: couponApplied?.code ?? null,
    lines: lines.map((line) => [line.id, line.quantity, line.unit_price, line.discount]),
  }), [branchId, couponApplied?.code, customerId, customerName, invoiceDiscount, lines, paidAmount, patientId, paymentMethod])
  const due = Math.max(0, total - paidAmount)
  const hasControlledItems = useMemo(() => lines.some((line) => line.is_controlled || line.requires_prescription), [lines])
  const normalizedQuery = query.trim()
  const queryLooksLikeBarcode = barcodeSearchEnabled && /^[0-9A-Za-z_-]{4,}$/.test(normalizedQuery)
  const hasSearchIntent = normalizedQuery.length >= searchMinChars || queryLooksLikeBarcode
  const searchResultsVisible = searchEnabled && searchFocused && hasSearchIntent
  const expectedDrawer = numberValue(shift?.expected_balance, numberValue(shift?.opening_balance))
  useEffect(() => {
    setSaleError(null)
  }, [invoiceFingerprint])
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
    if (!params || !pharmacyId || !branchId) return
    setShiftLoading(true)
    try {
      const response = await fetch(`/api/sales/cashier/shift?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as ShiftResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل جلسة الكاشير")
      const nextShift = data.openShift ?? null
      setShift(nextShift)
      setShiftSnapshot(nextShift ? (data.snapshot ?? fallbackShiftSnapshot(nextShift)) : null)
      if (nextShift) {
        await localDB.putTableRow("pharmacy_shifts", {
          ...nextShift,
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          user_id: nextShift.user_id ?? authUserId,
          status: "open",
          updated_at: new Date().toISOString(),
        }, true)
      }
    } catch (error) {
      const cachedShift = await loadOfflineOpenShift({ pharmacyId, branchId, userId: authUserId })
      if (cachedShift) {
        setShift(cachedShift)
        setShiftSnapshot(fallbackShiftSnapshot(cachedShift))
        if (network.online) toast.warning("تعذر الاتصال بالخادم؛ تم فتح آخر وردية محفوظة على الجهاز")
      } else {
        setShift(null)
        setShiftSnapshot(null)
        if (network.online) toast.error(error instanceof Error ? error.message : "فشل تحميل جلسة الكاشير")
      }
    } finally {
      setShiftLoading(false)
    }
  }, [authUserId, branchId, network.online, pharmacyId, shiftParams])

  const fetchProducts = useCallback(async (term = query) => {
    if (!pharmacyId || !branchId || !searchEnabled) return
    const normalizedTerm = term.trim()
    const looksLikeBarcode = barcodeSearchEnabled && /^[0-9A-Za-z_-]{4,}$/.test(normalizedTerm)
    if (!normalizedTerm || (normalizedTerm.length < searchMinChars && !looksLikeBarcode)) {
      setProducts([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ query: normalizedTerm, pharmacy_id: pharmacyId, branch_id: branchId, limit: "80" })
      const response = await fetch(`/api/sales/cashier?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as CashierResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الأصناف")
      setProducts(data.products ?? [])
      setRecentSales(data.recentSales ?? [])
    } catch (error) {
      const cachedProducts = await loadOfflineCashierCatalog({ pharmacyId, branchId, query: normalizedTerm, limit: 80 })
      setProducts(cachedProducts)
      if (cachedProducts.length === 0 && network.online) toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات الكاشير")
    } finally {
      setLoading(false)
    }
  }, [barcodeSearchEnabled, branchId, network.online, pharmacyId, query, searchEnabled, searchMinChars])

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
      const cachedProducts = await loadOfflineCashierCatalog({ pharmacyId, branchId, limit: 5000 })
      setCatalogProducts(cachedProducts)
      if (cachedProducts.length === 0 && network.online) toast.error(error instanceof Error ? error.message : "فشل تحميل قائمة الأصناف")
    } finally {
      setCatalogLoading(false)
    }
  }, [branchId, network.online, pharmacyId])

  useEffect(() => {
    if (catalogProducts.length === 0) return
    const freshById = new Map(catalogProducts.map((product) => [product.id, product]))
    setLines((current) => current.length === 0 ? current : current.map((line) => {
      const fresh = freshById.get(line.id)
      if (!fresh) return line
      return {
        ...line,
        ...fresh,
        quantity: line.quantity,
        discount: line.discount,
        unit_price: line.unit_price,
        unitId: line.unitId,
        unitName: line.unitName,
        unitPosition: line.unitPosition,
        conversionToBase: line.conversionToBase,
        unitBarcode: line.unitBarcode,
      }
    }))
  }, [catalogProducts])

  useEffect(() => {
    const invalidLine = lines.find((line) => !allowNegativeStock && line.manage_inventory && line.quantity > line.available_qty)
    if (!invalidLine) return
    setStockAlerts((current) => {
      const alert = {
        productId: invalidLine.id,
        title: `الكمية تغيرت: ${invalidLine.name_ar}`,
        description: `الموجود في الفاتورة ${stockQuantityLabel(invalidLine.quantity)} بينما المتاح للبيع الآن ${stockQuantityLabel(invalidLine.available_qty)}.`,
      }
      return [alert, ...current.filter((item) => item.productId !== alert.productId)].slice(0, 20)
    })
  }, [allowNegativeStock, lines])

  const loadPrintSettings = useCallback(async () => {
    if (!pharmacyId) return
    try {
      const [designResponse, printerResponse, priceGroupsResponse] = await Promise.all([
        fetch("/api/settings/entities?entity=invoice-designs", { cache: "no-store" }),
        fetch("/api/settings/entities?entity=receipt-printers", { cache: "no-store" }),
        fetch("/api/settings/entities?entity=price-groups", { cache: "no-store" }),
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
      if (priceGroupsResponse.ok) {
        const data = await priceGroupsResponse.json().catch(() => ({})) as { rows?: PriceGroup[] }
        const rows = (data.rows ?? []).filter((row) => row.status !== "inactive")
        setPriceGroups(rows)
        const defaultGroup = rows.find((row) => row.is_default)
        setPriceList((current) => current === "default" && defaultGroup ? defaultGroup.id : current)
      }
    } catch {
      setPrintDesign(null)
      setPrinterProfile(null)
      setPriceGroups([])
      setPriceList("default")
    }
  }, [pharmacyId])

  useEffect(() => {
    const stored = localStorage.getItem(DRAFT_KEY)
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { lines?: CartLine[]; customerName?: string; paymentMethod?: string; invoiceDiscount?: number; paidAmount?: number; clientRequestId?: string; fingerprint?: string }
        setLines(draft.lines ?? [])
        setCustomerName(draft.customerName ?? "نقد جمهوري")
        setPaymentMethod(draft.paymentMethod ?? "cash")
        setInvoiceDiscount(numberValue(draft.invoiceDiscount))
        setPaidAmount(numberValue(draft.paidAmount))
        if (typeof draft.clientRequestId === "string" && typeof draft.fingerprint === "string") {
          saleRequestRef.current = { id: draft.clientRequestId, fingerprint: draft.fingerprint }
        }
      } catch {}
    }
    const storedPanel = localStorage.getItem(CATALOG_PANEL_KEY)
    const storedWidth = Number(localStorage.getItem(CATALOG_PANEL_WIDTH_KEY))
    setShowCatalog(storedPanel === "visible")
    if (Number.isFinite(storedWidth) && storedWidth > 0) setCatalogPanelWidth(clampPanelWidth(storedWidth))
  }, [])

  useEffect(() => {
    const legacyRows = readLegacyOfflineSales() as Array<Record<string, unknown>>
    if (legacyRows.length === 0) return
    void (async () => {
      for (const payload of legacyRows) {
        await queueApiRequest({ path: "/api/sales/cashier", method: "POST", body: payload, label: "فاتورة بيع أوفلاين" })
      }
      clearLegacyOfflineSales()
      await syncManager.refreshPending()
    })()
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
    if (!pharmacyId || !branchId || !shift || !searchEnabled) return
    if (!hasSearchIntent) {
      setProducts([])
      setLoading(false)
      return
    }
    const handle = window.setTimeout(() => { void fetchProducts(query) }, queryLooksLikeBarcode ? 40 : 220)
    return () => window.clearTimeout(handle)
  }, [branchId, fetchProducts, hasSearchIntent, pharmacyId, query, queryLooksLikeBarcode, searchEnabled, shift])

  useEffect(() => {
    if (!pharmacyId || !branchId || !shift) return
    void fetchCatalogProducts()
  }, [branchId, fetchCatalogProducts, pharmacyId, shift])

  useEffect(() => {
    if (!acceptedPaymentMethods.includes(paymentMethod)) {
      const preferred = settings.get("payments", "defaultPaymentMethod", "cash")
      const normalized = preferred === "bank" ? "bank-transfer" : preferred
      setPaymentMethod(acceptedPaymentMethods.includes(normalized) ? normalized : acceptedPaymentMethods[0] ?? "cash")
      return
    }
    if (paymentMethod === "credit") setPaidAmount(0)
    else setPaidAmount(total)
  }, [acceptedPaymentMethods, paymentMethod, settings, total])

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

  async function refreshSessionSnapshot() {
    if (!pharmacyId || !branchId || !shift) return
    setShiftLoading(true)
    try {
      const data = await apiClient.get<ShiftResponse>("/api/sales/cashier/shift", {
        query: { pharmacy_id: pharmacyId, branch_id: branchId, shift_id: shift.id },
        fallbackMessage: "فشل تحميل تفاصيل الجلسة",
      })
      if (data.openShift) setShift(data.openShift)
      setShiftSnapshot(data.snapshot ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل تفاصيل الجلسة")
    } finally {
      setShiftLoading(false)
    }
  }

  function openSessionDetails() {
    setSessionDialogOpen(true)
    void refreshSessionSnapshot()
  }

  function openSystemWindow() {
    if (lines.length > 0) saveDraft("تم حفظ الفاتورة الحالية كمسودة قبل فتح لوحة النظام")
    window.open("/dashboard", "_blank", "noopener,noreferrer")
  }

  function openSaleDetails(saleId: string) {
    window.open(`/dashboard/sales/${encodeURIComponent(saleId)}`, "_blank", "noopener,noreferrer")
  }

  function finalizeClosedShiftView() {
    setCloseSummaryOpen(false)
    setShiftClosedPendingReset(false)
    setShift(null)
    setShiftSnapshot(null)
    clearInvoice()
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat) return
      if (event.key === "F2") {
        event.preventDefault()
        searchInputRef.current?.focus()
      } else if (event.key === "F3" && calculatorEnabled) {
        event.preventDefault()
        setCalculatorOpen(true)
      } else if (event.key === "F4") {
        event.preventDefault()
        setCatalogVisible(!showCatalog)
      } else if (event.key === "F6") {
        event.preventDefault()
        openSessionDetails()
      } else if (event.key === "F7" && canDiscount && lines.length > 0) {
        event.preventDefault()
        setDiscountDialogOpen(true)
      } else if (event.key === "F8") {
        event.preventDefault()
        setShowRecent((current) => !current)
      } else if (event.key === "F9" && lines.length > 0) {
        event.preventDefault()
        saveDraft()
      } else if (event.key === "F10") {
        event.preventDefault()
        openSystemWindow()
      } else if (event.key === "F12" && lines.length > 0 && !saving && !shiftClosedPendingReset) {
        event.preventDefault()
        void submitSale("cash")
      } else if (event.altKey && event.key === "2" && lines.length > 0) {
        event.preventDefault()
        void submitSale("card")
      } else if (event.altKey && event.key === "3" && lines.length > 0) {
        event.preventDefault()
        void submitSale("credit")
      } else if (event.altKey && event.key === "4" && lines.length > 0) {
        event.preventDefault()
        void submitSale("mixed")
      } else if (event.key === "Escape") {
        setSearchFocused(false)
        setShowRecent(false)
        setShortcutsOpen(false)
        setDiscountDialogOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [calculatorEnabled, canDiscount, lines.length, saving, searchFocused, setCatalogVisible, shiftClosedPendingReset, showCatalog])

  async function openShift() {
    if (!pharmacyId || !branchId) {
      toast.error("اختر صيدلية وفرع قبل فتح الكاشير")
      return
    }
    setOpeningSession(true)
    try {
      const data = await apiClient.post<ShiftResponse & { alreadyOpen?: boolean }>("/api/sales/cashier/shift", {
        pharmacy_id: pharmacyId,
        branch_id: branchId,
        opening_balance: numberValue(openingCash),
        notes: openingNotes,
        client_request_id: crypto.randomUUID(),
      }, { fallbackMessage: "فشل فتح جلسة الكاشير", timeoutMs: 25_000 })
      const nextShift = data.shift ?? null
      setShift(nextShift)
      setShiftSnapshot(nextShift ? (data.snapshot ?? fallbackShiftSnapshot(nextShift)) : null)
      setShiftClosedPendingReset(false)
      if (nextShift) {
        await localDB.putTableRow("pharmacy_shifts", {
          ...nextShift,
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          user_id: nextShift.user_id ?? authUserId,
          status: "open",
          updated_at: new Date().toISOString(),
        }, true)
      }
      await auth.setActiveScope({ pharmacyId, branchId })
      setOpeningNotes("")
      void play("shift-start", cashierSoundVolume)
      window.setTimeout(() => { void play("drawer-open", Math.min(cashierSoundVolume, 0.45)) }, 120)
      toast.success(data.alreadyOpen ? "تم استرجاع جلسة الكاشير المفتوحة" : "تم فتح جلسة الكاشير")
      window.setTimeout(() => searchInputRef.current?.focus(), 80)
    } catch (error) {
      const cachedShift = await loadOfflineOpenShift({ pharmacyId, branchId, userId: authUserId })
      if (cachedShift) {
        setShift(cachedShift)
        setShiftSnapshot(fallbackShiftSnapshot(cachedShift))
        toast.warning("تم استرجاع الوردية المفتوحة المحفوظة على الجهاز")
      } else if (!network.online || isNetworkError(error)) {
        toast.error("فتح وردية جديدة لأول مرة يحتاج اتصالًا بالخادم. جهّز الجهاز للأوفلاين والوردية مفتوحة قبل انقطاع الإنترنت")
      } else {
        toast.error(error instanceof Error ? error.message : "فشل فتح جلسة الكاشير")
      }
    } finally {
      setOpeningSession(false)
    }
  }

  async function closeShift(actualBalance: number, notes: string) {
    if (!shift || !pharmacyId || !branchId) return
    const closingBalance = Math.max(0, numberValue(actualBalance))
    setClosingShift(true)
    try {
      const data = await apiClient.patch<ShiftResponse>("/api/sales/cashier/shift", {
        pharmacy_id: pharmacyId,
        branch_id: branchId,
        shift_id: shift.id,
        closing_balance: closingBalance,
        notes,
      }, { fallbackMessage: "فشل إغلاق جلسة الكاشير", timeoutMs: 25_000 })
      const closedShift = data.shift ?? {
        ...shift,
        status: "closed" as const,
        closing_balance: closingBalance,
        closed_at: new Date().toISOString(),
      }
      await localDB.putTableRow("pharmacy_shifts", {
        ...closedShift,
        pharmacy_id: pharmacyId,
        branch_id: branchId,
        user_id: closedShift.user_id ?? authUserId,
        status: "closed",
        updated_at: new Date().toISOString(),
      }, true)
      setShift(closedShift)
      const closedSnapshot = data.snapshot ?? shiftSnapshot ?? fallbackShiftSnapshot(closedShift, closingBalance)
      setShiftSnapshot({
        ...closedSnapshot,
        shift: { ...closedSnapshot.shift, ...closedShift },
        metrics: {
          ...closedSnapshot.metrics,
          actualDrawer: closingBalance,
          drawerDifference: closingBalance - closedSnapshot.metrics.expectedDrawer,
        },
      })
      setCloseShiftDialogOpen(false)
      setShiftClosedPendingReset(true)
      setCloseSummaryOpen(true)
      void play("shift-end", cashierSoundVolume)
      toast.success("تم إغلاق جلسة الكاشير وعرض تفاصيل التقفيل")
    } catch (error) {
      if (!network.online || isNetworkError(error)) {
        await queueApiRequest({
          path: "/api/sales/cashier/shift",
          method: "PATCH",
          body: { pharmacy_id: pharmacyId, branch_id: branchId, shift_id: shift.id, closing_balance: closingBalance, notes },
          label: "إغلاق وردية الكاشير أوفلاين",
        })
        const closedAt = new Date().toISOString()
        const offlineShift: CashierShift = {
          ...shift,
          status: "closed",
          closing_balance: closingBalance,
          closed_at: closedAt,
          notes: notes || shift.notes,
        }
        await localDB.putTableRow("pharmacy_shifts", {
          ...offlineShift,
          pharmacy_id: pharmacyId,
          branch_id: branchId,
          user_id: shift.user_id ?? authUserId,
          updated_at: closedAt,
        }, false)
        await syncManager.refreshPending()
        setShift(offlineShift)
        setShiftSnapshot((current) => {
          const base = current ?? fallbackShiftSnapshot(offlineShift, closingBalance)
          return {
            ...base,
            shift: { ...base.shift, ...offlineShift },
            metrics: {
              ...base.metrics,
              actualDrawer: closingBalance,
              drawerDifference: closingBalance - base.metrics.expectedDrawer,
            },
          }
        })
        setCloseShiftDialogOpen(false)
        setShiftClosedPendingReset(true)
        setCloseSummaryOpen(true)
        void play("shift-end", cashierSoundVolume)
        toast.warning("تم تقفيل الوردية على الجهاز وستُرسل للخادم عند رجوع الإنترنت")
      } else {
        toast.error(error instanceof Error ? error.message : "فشل إغلاق جلسة الكاشير")
      }
    } finally {
      setClosingShift(false)
    }
  }

  function upsertStockAlert(alert: CashierStockAlert) {
    setStockAlerts((current) => {
      const withoutCurrent = current.filter((item) => item.productId !== alert.productId)
      return [alert, ...withoutCurrent].slice(0, 20)
    })
  }

  function dismissStockAlert(productId: string) {
    setStockAlerts((current) => current.filter((item) => item.productId !== productId))
  }

  function registerStockAlert(product: CashierProduct, description?: string | null) {
    const message = description || product.stock_message || `المتاح للبيع من ${product.name_ar} هو ${stockQuantityLabel(product.available_qty)} ${product.unit ?? ""}.`
    upsertStockAlert({ productId: product.id, title: `مشكلة مخزون: ${product.name_ar}`, description: message })
    toast.warning(message, { id: `stock-${product.id}`, duration: 4200 })
    void play(product.available_qty <= 0 ? "low-stock" : "warning", cashierSoundVolume)
  }

  function addProduct(product: CashierProduct, source: "barcode" | "search" | "catalog" = "catalog") {
    void unlockAudio()
    if (!allowNegativeStock && product.manage_inventory && product.available_qty <= 0) {
      registerStockAlert(product)
      return
    }

    const sellableUnits = (product.units ?? []).filter((u) => u.sale_enabled)
    if (sellableUnits.length > 1 && !lines.find((line) => line.id === product.id)) {
      setUnitSelectorProduct(product)
      setUnitSelectorSource(source)
      setUnitSelectorOpen(true)
      return
    }

    const existing = lines.find((line) => line.id === product.id)
    const step = quantityStep(product)
    if (existing && saleItemBehavior === "warn") {
      toast.warning("الصنف موجود بالفعل في الفاتورة", { duration: 2200 })
      return
    }
    const nextQuantity = existing
      ? (saleItemBehavior === "replace" ? step : normalizeCashierQuantity(product, existing.quantity + step, existing.quantity))
      : step
    if (!allowNegativeStock && product.manage_inventory && nextQuantity > product.available_qty) {
      registerStockAlert(product, `الكمية المطلوبة ${stockQuantityLabel(nextQuantity)} أكبر من المتاح للبيع ${stockQuantityLabel(product.available_qty)}.`)
      return
    }

    if (showExpiryInSales && product.nearest_expiry) {
      const batchText = showBatchInSales && product.nearest_batch_number ? ` — تشغيلة ${product.nearest_batch_number}` : ""
      toast.info(`سيتم الخصم FEFO من الأقرب انتهاءً: ${expiryLabel(product.nearest_expiry)}${batchText}`, { id: `fefo-${product.id}`, duration: 2800 })
    }
    const defaultUnit = sellableUnits.length === 1 ? sellableUnits[0] : null
    setLines((current) => existing
      ? current.map((line) => line.id === product.id
        ? { ...line, ...product, quantity: nextQuantity, unit_price: effectiveProductPrice(product) }
        : line)
      : [...current, {
          ...product,
          quantity: nextQuantity,
          discount: 0,
          unit_price: defaultUnit?.sell_price ?? effectiveProductPrice(product),
          unitId: defaultUnit?.id ?? null,
          unitName: defaultUnit?.unit_name ?? (product.unit ?? ""),
          unitPosition: (defaultUnit?.position ?? 1) as 1 | 2 | 3,
          conversionToBase: defaultUnit?.conversion_to_lowest ?? 1,
          unitBarcode: defaultUnit?.barcode ?? null,
        }])
    dismissStockAlert(product.id)
    setQuery("")
    setSearchFocused(false)
    if (audioOnScan) void play(source === "barcode" ? "barcode-scan" : "item-added", cashierSoundVolume)
    window.setTimeout(() => searchInputRef.current?.focus(), 20)
  }

  function addProductWithUnit(product: CashierProduct, unit: CashierProductUnit, source: "barcode" | "search" | "catalog") {
    void unlockAudio()
    if (!allowNegativeStock && product.manage_inventory && product.available_qty <= 0) {
      registerStockAlert(product)
      return
    }
    const step = quantityStep(product)
    setLines((current) => [...current, {
      ...product,
      quantity: step,
      discount: 0,
      unit_price: unit.sell_price,
      unitId: unit.id,
      unitName: unit.unit_name,
      unitPosition: unit.position as 1 | 2 | 3,
      conversionToBase: unit.conversion_to_lowest,
      unitBarcode: unit.barcode ?? null,
    }])
    dismissStockAlert(product.id)
    setQuery("")
    setSearchFocused(false)
    setUnitSelectorOpen(false)
    setUnitSelectorProduct(null)
    if (audioOnScan) void play(source === "barcode" ? "barcode-scan" : "item-added", cashierSoundVolume)
    window.setTimeout(() => searchInputRef.current?.focus(), 20)
  }

  function updateLine(id: string, updates: CartLineUpdates) {
    const line = lines.find((current) => current.id === id)
    if (!line) return
    const next = { ...line, ...updates }
    const nextQuantity = updates.quantity === undefined
      ? line.quantity
      : normalizeCashierQuantity(line, updates.quantity, line.quantity)
    if (!allowNegativeStock && line.manage_inventory && nextQuantity > line.available_qty) {
      registerStockAlert(line, `الكمية المطلوبة ${stockQuantityLabel(nextQuantity)} أكبر من المتاح للبيع ${stockQuantityLabel(line.available_qty)}.`)
      return
    }
    const nextPrice = canPriceOverride ? Math.max(0, numberValue(next.unit_price, line.unit_price)) : line.unit_price
    const gross = nextQuantity * nextPrice
    const lineDiscountLimit = gross * (maxDiscountPercent / 100)
    const nextDiscount = canDiscount ? Math.min(lineDiscountLimit, Math.max(0, numberValue(next.discount, line.discount))) : 0
    setLines((current) => current.map((item) => item.id === id
      ? { ...next, quantity: nextQuantity, unit_price: nextPrice, discount: nextDiscount }
      : item))
  }

  function changePriceList(nextValue: string) {
    if (!canPriceOverride) return
    const nextGroup = priceGroups.find((group) => group.id === nextValue) ?? null
    setPriceList(nextGroup?.id ?? "default")
    setLines((current) => current.map((line) => ({ ...line, unit_price: priceForGroup(line, nextGroup) })))
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id))
    dismissStockAlert(id)
    void play("void-transaction", Math.min(cashierSoundVolume, 0.35))
  }

  async function validateCoupon() {
    if (!couponCode.trim() || !pharmacyId) return
    setCouponValidating(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: pharmacyId, code: couponCode.trim().toUpperCase(), subtotal: String(subtotal - linesDiscount) })
      const response = await fetch(`/api/sales/coupons/validate?${params.toString()}`)
      const data = await response.json().catch(() => ({})) as { valid?: boolean; discount?: number; discount_type?: string; discount_value?: number; error?: string }
      if (data.valid && data.discount != null) {
        setCouponDiscount(data.discount)
        setCouponApplied({ code: couponCode.trim().toUpperCase(), discount: data.discount, label: `كوبون ${couponCode.trim().toUpperCase()}` })
        toast.success(`تم تطبيق الكوبون: خصم ${money(data.discount, currency)}`)
      } else {
        setCouponDiscount(0)
        setCouponApplied(null)
        toast.error(data.error || "الكوبون غير صالح")
      }
    } catch {
      toast.error("فشل التحقق من الكوبون")
    } finally {
      setCouponValidating(false)
    }
  }

  function removeCoupon() {
    setCouponCode("")
    setCouponDiscount(0)
    setCouponApplied(null)
  }

  function clearInvoice() {
    setLines([])
    setInvoiceDiscount(0)
    setCouponDiscount(0)
    setCouponApplied(null)
    setCouponCode("")
    setCouponPanelOpen(false)
    setCustomerName("نقد جمهوري")
    setCustomerId(null)
    setPatientName("")
    setPatientId(null)
    setDoctorName("")
    setPrescriptionNumber("")
    const preferred = settings.get("payments", "defaultPaymentMethod", "cash")
    const normalized = preferred === "bank" ? "bank-transfer" : preferred
    setPaymentMethod(acceptedPaymentMethods.includes(normalized) ? normalized : acceptedPaymentMethods[0] ?? "cash")
    setPaidAmount(0)
    setSaleError(null)
    setStockAlerts([])
    saleRequestRef.current = null
    localStorage.removeItem(DRAFT_KEY)
  }

  function saveDraft(label = "تم حفظ المسودة على الجهاز") {
    const request = saleRequestRef.current?.fingerprint === invoiceFingerprint
      ? saleRequestRef.current
      : { fingerprint: invoiceFingerprint, id: crypto.randomUUID() }
    saleRequestRef.current = request
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      lines,
      customerName,
      paymentMethod,
      invoiceDiscount,
      paidAmount,
      clientRequestId: request.id,
      fingerprint: request.fingerprint,
      savedAt: new Date().toISOString(),
    }))
    toast.success(label)
    void play("success", Math.min(cashierSoundVolume, 0.4))
  }

  const syncOfflineSales = useCallback(async () => {
    if (!network.online || syncStatus.isSyncing) return
    await syncManager.forceSync()
    startTransition(() => {
      void fetchProducts("")
      void fetchCatalogProducts()
      void loadShift()
    })
  }, [fetchCatalogProducts, fetchProducts, loadShift, network.online, syncStatus.isSyncing])

  async function submitSale(methodOverride?: string) {
    if (saving) return
    if (!pharmacyId || !branchId) {
      toast.error("اختر صيدلية وفرع قبل البيع")
      return
    }
    if (!shift) {
      toast.error("لازم تفتح جلسة الكاشير الأول")
      return
    }
    if (shiftClosedPendingReset || shift.status !== "open") {
      toast.error("جلسة الكاشير مقفولة. راجع تفاصيل التقفيل ثم افتح جلسة جديدة")
      return
    }
    if (lines.length === 0) {
      toast.error("أضف صنفًا واحدًا على الأقل")
      return
    }
    const invalidStockLine = lines.find((line) => !allowNegativeStock && line.manage_inventory && line.quantity > line.available_qty)
    if (invalidStockLine) {
      registerStockAlert(invalidStockLine, `الكمية المطلوبة ${stockQuantityLabel(invalidStockLine.quantity)} أكبر من المتاح للبيع ${stockQuantityLabel(invalidStockLine.available_qty)}.`)
      return
    }
    const effectiveMethod = methodOverride ?? paymentMethod
    if (!acceptedPaymentMethods.includes(effectiveMethod)) {
      toast.error("طريقة الدفع غير مفعلة من الإعدادات")
      return
    }
    const effectivePaid = effectiveMethod === "credit" ? 0 : (effectiveMethod === "mixed" ? paidAmount : total)
    const invoiceDiscountLimit = subtotal * (maxDiscountPercent / 100)
    if (hasControlledItems && !patientName.trim()) {
      toast.error("يرجى إدخال اسم المريض للأدوية التي تصرف بروشتة")
      return
    }
    const safeInvoiceDiscount = canDiscount ? Math.min(invoiceDiscountLimit, Math.max(0, invoiceDiscount)) : 0
    const submissionFingerprint = `${invoiceFingerprint}|method:${effectiveMethod}|paid:${effectivePaid.toFixed(2)}`
    const request = saleRequestRef.current?.fingerprint === submissionFingerprint
      ? saleRequestRef.current
      : { fingerprint: submissionFingerprint, id: crypto.randomUUID() }
    saleRequestRef.current = request
    const payload = {
      client_request_id: request.id,
      pharmacy_id: pharmacyId,
      branch_id: branchId,
      shift_id: shift.id,
      customer_name: customerName,
      customer_id: customerId,
      patient_id: patientId,
      payment_method: effectiveMethod,
      paid_amount: effectivePaid,
      discount_total: safeInvoiceDiscount,
      coupon_code: couponApplied ? couponApplied.code : null,
      lines: lines.map((line) => ({
        item_id: line.id,
        barcode: line.unitBarcode ?? primaryProductBarcode(line),
        unit: line.unitName || line.unit,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount,
        unit_id: line.unitId,
        unit_name_snapshot: line.unitName || line.unit || null,
        unit_level: line.unitId ? (line.unitPosition === 3 ? "primary" : line.unitPosition === 2 ? "secondary" : "tertiary") : null,
        conversion_to_base: line.conversionToBase,
        base_quantity_deducted: Math.round(line.quantity * line.conversionToBase * 1000) / 1000,
      })),
      patient_name: patientName || null,
      doctor_name: doctorName || null,
      prescription_number: prescriptionNumber || null,
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      lines,
      customerName,
      paymentMethod: effectiveMethod,
      invoiceDiscount,
      paidAmount: effectivePaid,
      clientRequestId: request.id,
      fingerprint: request.fingerprint,
      savedAt: new Date().toISOString(),
    }))
    setSaving(true)
    setSaleError(null)
    try {
      if (!network.online) throw new Error("offline")
      const data = await apiClient.post<{
        error?: string
        code?: string
        warning?: string
        compatibilityMode?: boolean
        sale?: { invoice_number?: string }
      }>("/api/sales/cashier", payload, {
        fallbackMessage: "فشل حفظ فاتورة البيع",
        timeoutMs: 30_000,
      })
      setLastInvoice({
        invoiceNumber: data.sale?.invoice_number,
        customerName,
        paymentMethod: effectiveMethod,
        savedAt: new Date().toISOString(),
        lines: lines.map((line) => ({ ...line })),
        subtotal,
        discountTotal: linesDiscount + safeInvoiceDiscount,
        total,
        paidAmount: effectivePaid,
      })
      toast.success(`تم حفظ الفاتورة ${data.sale?.invoice_number ?? ""}`)
      if (data.warning) toast.warning(data.warning, { duration: 7000 })
      void play("payment-received", cashierSoundVolume)
      window.setTimeout(() => { void play("cash-register", Math.min(cashierSoundVolume, 0.5)) }, 140)
      clearInvoice()
      startTransition(() => {
        setProducts([])
        void fetchCatalogProducts()
        void loadShift()
      })
    } catch (error) {
      const shouldQueue = !network.online || (error instanceof Error && error.message === "offline") || isNetworkError(error)
      if (!shouldQueue) {
        const message = error instanceof Error ? error.message : "فشل حفظ فاتورة البيع"
        setSaleError(message)
        toast.error(message, { duration: 7000 })
        void play("error", cashierSoundVolume)
      } else {
        let localSuccess = true
        for (const line of lines) {
          const sellLevel = line.unitPosition === 3 ? "primary" as const : line.unitPosition === 2 ? "secondary" as const : "tertiary" as const
          const offlineResult = await executeOfflineSale({
            itemId: line.id,
            itemName: line.name_ar,
            sellLevel,
            sellQuantity: line.quantity,
            pharmacyId: pharmacyId!,
            branchId: branchId!,
          })
          if (!offlineResult.success) {
            localSuccess = false
            setSaleError(offlineResult.error ?? "فشل تنفيذ البيع محليًا")
            toast.error(offlineResult.error ?? "فشل تنفيذ البيع محليًا", { duration: 7000 })
            void play("error", cashierSoundVolume)
            break
          }
        }
        if (localSuccess) {
          await queueApiRequest({ path: "/api/sales/cashier", method: "POST", body: { ...payload, saved_at: new Date().toISOString() }, label: "فاتورة بيع أوفلاين" })
          await syncManager.refreshPending()
          clearInvoice()
          toast.warning("تم حفظ الفاتورة في طابور المزامنة الآمن", { duration: 3200 })
          void play("notification", Math.min(cashierSoundVolume, 0.4))
        }
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
        ? products.find((product) => [product.sku, product.barcode, primaryProductBarcode(product), ...(product.barcodes ?? []).map((barcode) => barcode.barcode), ...(product.units ?? []).map((u) => u.barcode)].some((code) => code?.toLowerCase() === value))
        : null
      addProduct(exactMatch ?? products[0], exactMatch ? "barcode" : "search")
    }
  }

  const cashierAlerts: CashierOperationalAlert[] = []
  if (saleError) {
    cashierAlerts.push({
      id: "sale-error",
      severity: "error",
      title: "تعذر حفظ فاتورة البيع",
      description: saleError,
      actionLabel: "إعادة الحفظ",
      onAction: () => { void submitSale(paymentMethod) },
      actionLoading: saving,
    })
  }
  for (const stockAlert of stockAlerts) {
    cashierAlerts.push({
      id: `stock-${stockAlert.productId}`,
      severity: "warning",
      title: stockAlert.title,
      description: stockAlert.description,
      actionLabel: "تحديث المخزون",
      onAction: () => {
        dismissStockAlert(stockAlert.productId)
        startTransition(() => {
          setProducts([])
          void fetchCatalogProducts()
          if (query.trim()) void fetchProducts(query)
        })
      },
      actionLoading: catalogLoading || loading,
      dismissible: true,
      onDismiss: () => dismissStockAlert(stockAlert.productId),
    })
  }
  if (syncStatus.pendingMutations > 0) {
    cashierAlerts.push({
      id: "offline-sync",
      severity: network.online ? "warning" : "info",
      title: "عمليات محفوظة محليًا",
      description: `يوجد ${syncStatus.pendingMutations.toLocaleString("ar-EG")} عملية في انتظار المزامنة مع الخادم.`,
      count: syncStatus.pendingMutations,
      actionLabel: network.online ? "مزامنة الآن" : "بانتظار الإنترنت",
      onAction: network.online ? () => { void syncOfflineSales() } : undefined,
      actionLoading: syncStatus.isSyncing,
    })
  }
  if (!network.online && syncStatus.pendingMutations === 0) {
    cashierAlerts.push({
      id: "offline-mode",
      severity: "info",
      title: "الكاشير يعمل بدون إنترنت",
      description: "الفواتير الجديدة ستُحفظ في الطابور الآمن وتُرسل تلقائيًا عند عودة الاتصال.",
    })
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
            <div className="bg-brand px-6 py-6 text-white sm:px-8 shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">
              <div className="flex items-center gap-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                  <Monitor className="size-7" />
                </span>
                <div>
                  <p className="text-xs font-black text-white/70">جلسة بيع جديدة</p>
                  <h1 className="mt-1 text-2xl font-black">ابدأ الكاشير</h1>
                  <p className="mt-1 text-sm font-bold text-slate-100">حدد موقع التشغيل وسجّل النقدية الموجودة في الدرج.</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-6 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-950">بيانات افتتاح الوردية</h2>
                  <p className="mt-1 text-sm font-bold leading-7 text-slate-500">اختيار الفرع هنا يحدد المخزون والفواتير وحركات التشغيل الخاصة بالجلسة.</p>
                </div>
                <Badge className="w-fit rounded-full bg-brand-muted px-3 py-1 text-brand ring-1 ring-brand-subtle/50">{auth.activePharmacy?.name ?? "الصيدلية الحالية"}</Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-black text-slate-700"><DollarSign className="size-4 text-brand" /> النقدية في الدرج*</span>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void openShift()
                      }
                    }}
                    className="h-12 rounded-2xl border-slate-300 text-center text-xl font-black focus-visible:ring-brand/20"
                    placeholder="0.00"
                    autoFocus
                  />
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
                  <Input
                    value={openingNotes}
                    onChange={(e) => setOpeningNotes(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void openShift()
                      }
                    }}
                    className="h-11 rounded-2xl font-bold focus-visible:ring-brand/20"
                    placeholder="اختياري — مثال: استلام وردية مسائية"
                  />
                </label>
              </div>

              <Alert className="rounded-2xl border-sky-100 bg-sky-50 text-slate-700">
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
      <section dir="rtl" className="fixed inset-0 z-40 flex min-w-0 flex-col bg-slate-50 text-right">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 shadow-sm sm:px-3">
          {shiftLoading ? (
            <div className="flex h-9 items-center gap-2 px-3 text-sm font-black text-slate-500"><RefreshCw className="size-4 animate-spin" /> جارٍ تحميل الجلسة...</div>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 pharmacy-scrollbar">
                <Button variant="outline" className="h-9 shrink-0 rounded-xl border-rose-200 px-3 text-xs font-black text-rose-600 hover:bg-rose-50" onClick={() => setCloseShiftDialogOpen(true)} disabled={!shift || saving || closingShift || shiftClosedPendingReset} title="تقفيل جلسة الكاشير">
                  <X className="size-3.5" /> تقفيل
                </Button>
                <Button className="h-9 shrink-0 rounded-xl px-3 text-xs font-black" onClick={openSessionDetails} disabled={!shift} title="عرض الجلسة الحالية — F6">
                  <ListChecks className="size-3.5" /> الجلسة F6
                </Button>
                <Button variant="outline" className="h-9 shrink-0 rounded-xl px-3 text-xs font-black" onClick={openSystemWindow} title="فتح لوحة النظام في تبويب جديد — F10">
                  <ExternalLink className="size-3.5" /> النظام F10
                </Button>
                <Button variant={showCatalog ? "default" : "outline"} className="h-9 shrink-0 rounded-xl px-3 text-xs font-black" onClick={() => setCatalogVisible(!showCatalog)} title="قائمة الأصناف — F4">
                  <Package className="size-3.5" /> الأصناف F4
                </Button>
                {calculatorEnabled ? (
                  <Button variant="outline" className="h-9 shrink-0 rounded-xl px-3 text-xs font-black" onClick={() => setCalculatorOpen(true)} title="الآلة الحاسبة — F3">
                    <CalculatorIcon className="size-3.5" /> الحاسبة F3
                  </Button>
                ) : null}
                {canDiscount ? (
                  <Button variant="outline" className="h-9 shrink-0 rounded-xl px-3 text-xs font-black" onClick={() => setDiscountDialogOpen(true)} disabled={lines.length === 0 || shiftClosedPendingReset} title="خصم الفاتورة — F7">
                    <Percent className="size-3.5" /> خصم F7
                  </Button>
                ) : null}
                <CashierAlertCenter alerts={cashierAlerts} />
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" onClick={() => setShortcutsOpen(true)} title="كل اختصارات الكاشير">
                  <FileText className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" onClick={() => { setProducts([]); void fetchCatalogProducts(); void refreshSessionSnapshot() }} disabled={loading || catalogLoading || shiftLoading} title="تحديث بيانات الكاشير">
                  <RefreshCw className={cn("size-4", (loading || catalogLoading || shiftLoading) && "animate-spin")} />
                </Button>
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" onClick={() => saveDraft()} disabled={!holdSaleEnabled || lines.length === 0} title="حفظ مسودة — F9">
                  <Save className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" onClick={printInvoice} disabled={lines.length === 0 && !lastInvoice} title={lastInvoice && lines.length === 0 ? "طباعة آخر فاتورة" : "طباعة الفاتورة"}>
                  <Printer className="size-4" />
                </Button>
              </div>

              <div className="hidden shrink-0 items-center gap-1.5 text-[11px] font-black text-slate-600 md:flex">
                <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-brand px-2 text-white"><Clock className="size-3" /> {shiftTime(shift?.opened_at)}</span>
                <span className="inline-flex h-7 max-w-36 items-center truncate rounded-lg border border-slate-200 px-2">{activeCashierBranch?.name ?? "الرئيسي"}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-3">
              <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(300px,520px)_minmax(0,1fr)]">
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40">
                  <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><UserPlus className="size-4" strokeWidth={2.2} /></span>
                  {customerSelectionEnabled && customerOptions.length > 0 ? (
                    <Select value={customerId ?? "cash"} onValueChange={(value) => {
                      if (!value || value === "cash") { setCustomerId(null); setCustomerName("نقد جمهوري"); return }
                      const customer = customerOptions.find((item) => item.id === value)
                      setCustomerId(value)
                      setCustomerName(customer?.name ?? "عميل")
                    }}>
                      <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent py-0 text-sm font-bold shadow-none hover:bg-transparent focus-visible:ring-0">
                        <SelectValue>{customerName}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" sideOffset={8}>
                        <SelectItem value="cash">نقد جمهوري</SelectItem>
                        {customerOptions.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` — ${customer.phone}` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input disabled={!customerSelectionEnabled} className="h-full flex-1 rounded-none border-0 bg-transparent px-3 text-right text-sm font-bold shadow-none placeholder:font-bold focus-visible:ring-0 disabled:bg-slate-50" value={customerName} onChange={(e) => { setCustomerId(null); setCustomerName(e.target.value) }} placeholder="نقد جمهوري" />
                  )}
                </div>
                <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40">
                  <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><Wallet className="size-4" strokeWidth={2.2} /></span>
                  <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "cash")}>
                    <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent py-0 text-sm font-bold shadow-none hover:bg-transparent focus-visible:ring-0">
                      <SelectValue>{labelFromMap(PAYMENT_METHOD_LABELS, paymentMethod)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" sideOffset={8}>
                      {acceptedPaymentMethods.includes("cash") ? <SelectItem value="cash">نقدي</SelectItem> : null}
                      {acceptedPaymentMethods.includes("card") ? <SelectItem value="card">بطاقة</SelectItem> : null}
                      {acceptedPaymentMethods.includes("wallet") ? <SelectItem value="wallet">محفظة</SelectItem> : null}
                      {acceptedPaymentMethods.includes("bank-transfer") ? <SelectItem value="bank-transfer">تحويل بنكي</SelectItem> : null}
                      {acceptedPaymentMethods.includes("mixed") ? <SelectItem value="mixed">دفع متعدد</SelectItem> : null}
                      {acceptedPaymentMethods.includes("credit") ? <SelectItem value="credit">بيع آجل</SelectItem> : null}
                    </SelectContent>
                  </Select>
                </div>
                {canPriceOverride && priceGroups.length > 0 ? (
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-slate-200 bg-white transition-all focus-within:border-brand/40 sm:col-span-2">
                    <span className="flex w-11 items-center justify-center border-l-2 border-slate-200 text-slate-400"><CreditCard className="size-4" strokeWidth={2.2} /></span>
                    <Select value={priceList} onValueChange={(value) => changePriceList(value ?? "default")}>
                      <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent py-0 text-sm font-bold shadow-none hover:bg-transparent focus-visible:ring-0">
                        <SelectValue>{selectedPriceGroup?.name ?? "سعر البيع الافتراضي"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" sideOffset={8}>
                        <SelectItem value="default">سعر البيع الافتراضي</SelectItem>
                        {priceGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name} — ربح {numberValue(group.markup_percent).toLocaleString("ar-EG")}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              <div className="relative min-w-0">
                <div className="flex h-14 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all focus-within:border-brand focus-within:shadow-md focus-within:shadow-brand/10">
                  <button disabled={!searchEnabled} type="button" className="flex w-14 items-center justify-center border-l-2 border-slate-200 text-brand transition hover:bg-brand/5 disabled:cursor-not-allowed disabled:text-slate-300" onClick={() => setCatalogVisible(!showCatalog)} title="إظهار أو إخفاء قائمة الأصناف">
                    <Package className="size-6" strokeWidth={2.2} />
                  </button>
                  <Input
                    ref={searchInputRef}
                    disabled={!searchEnabled}
                    className="h-full flex-1 rounded-none border-0 bg-transparent px-3 text-right text-base font-black text-slate-900 shadow-none placeholder:font-bold placeholder:text-slate-400 focus-visible:ring-0 sm:px-4 sm:text-lg"
                    value={query}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => window.setTimeout(() => setSearchFocused(false), 200)}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={searchEnabled ? `🔍  امسح الباركود أو اكتب ${searchMinChars} حرف على الأقل...` : "البحث معطل من الإعدادات"}
                    autoFocus
                  />
                  <button disabled={!searchEnabled} type="button" onClick={() => void fetchProducts(query)} className="flex w-14 items-center justify-center border-r-2 border-slate-200 text-slate-500 transition hover:bg-brand/5 hover:text-brand disabled:cursor-not-allowed disabled:text-slate-300" title="بحث">
                    <Search className="size-5" />
                  </button>
                </div>
                {searchResultsVisible ? (
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
                              onMouseDown={(event) => { event.preventDefault(); addProduct(product, "search") }}
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
                                {product.stock_message ? (
                                  <span className="mt-1 block max-w-xl text-[11px] font-black leading-5 text-rose-700">{product.stock_message}</span>
                                ) : showExpiryInSales && product.nearest_expiry ? (
                                  <span className="mt-1 flex items-center gap-1 text-[11px] font-black text-amber-700">
                                    <CalendarDays className="size-3" />
                                    بيع الأقرب: {expiryLabel(product.nearest_expiry)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-1">
                                <Badge className={cn("rounded-xl px-3 py-1 text-xs font-black", low ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                                  {showItemStock ? (product.manage_inventory ? `صالح ${stockQuantityLabel(product.available_qty)} ${product.unit ?? ""}` : "خدمة") : ""}
                                </Badge>
                                {showItemStock && product.manage_inventory && numberValue(product.physical_qty, product.available_qty) !== product.available_qty ? (
                                  <span className="text-[10px] font-black text-slate-400">فعلي {stockQuantityLabel(numberValue(product.physical_qty))}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-left text-lg font-black text-brand tabular-nums">
                                {showItemPrice
                                  ? (() => {
                                      const sellableUnits = (product.units ?? []).filter((u) => u.sale_enabled)
                                      if (sellableUnits.length > 1) {
                                        return sellableUnits.map((u) => `${money(u.sell_price, currency)}/${u.unit_name}`).join(" • ")
                                      }
                                      return money(effectiveProductPrice(product), currency)
                                    })()
                                  : ""}
                              </span>
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
                    {categoryFilterEnabled ? <div className="flex gap-1.5 overflow-x-auto pb-1 pharmacy-scrollbar">
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
                    </div> : null}
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
                              onClick={() => addProduct(product, "catalog")}
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
                                {product.stock_message ? (
                                  <span className="mt-1 block text-[10px] font-black leading-4 text-rose-700">{product.stock_message}</span>
                                ) : showExpiryInSales && product.nearest_expiry ? (
                                  <span className="mt-1 flex items-center gap-1 text-[11px] font-black text-amber-700">
                                    <CalendarDays className="size-3" /> {expiryLabel(product.nearest_expiry)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className="text-sm font-black text-brand tabular-nums">
                                {showItemPrice
                                  ? (() => {
                                      const sellableUnits = (product.units ?? []).filter((u) => u.sale_enabled)
                                      if (sellableUnits.length > 1) return sellableUnits.map((u) => `${money(u.sell_price, currency)}/${u.unit_name}`).join(" • ")
                                      return money(effectiveProductPrice(product), currency)
                                    })()
                                  : ""}
                              </span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-black", low ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                                  {showItemStock ? (product.manage_inventory ? `صالح ${stockQuantityLabel(product.available_qty)}` : "خدمة") : ""}
                                </span>
                                {showItemStock && product.manage_inventory && numberValue(product.physical_qty, product.available_qty) !== product.available_qty ? (
                                  <span className="text-[10px] font-black text-slate-400">فعلي {stockQuantityLabel(numberValue(product.physical_qty))}</span>
                                ) : null}
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
                <div className="min-h-[260px] flex-1 overflow-auto rounded-2xl border border-slate-100 bg-white pharmacy-scrollbar">
                  <Table className="min-w-[760px]">
                    <TableHeader className="bg-slate-50/70">
                      <TableRow>
                        <TableHead className="w-12 text-center"><X className="mx-auto size-4" /></TableHead>
                        <TableHead className="text-right">صنف <Info className="inline size-3 text-brand" /></TableHead>
                        <TableHead className="w-[130px] text-center">سعر الوحدة</TableHead>
                        <TableHead className="w-[150px] text-center">الكمية</TableHead>
                        <TableHead className="w-[120px] text-center">الخصم</TableHead>
                        <TableHead className="w-[130px] text-center">المجموع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-center"><Button size="icon" variant="ghost" className="size-8 text-rose-500" onClick={() => removeLine(line.id)}><Trash2 className="size-4" /></Button></TableCell>
                          <TableCell className="min-w-[220px]">
                            <div className="font-black text-slate-950">{line.name_ar}</div>
                            <div className="text-xs font-bold text-slate-400" dir="ltr">{primaryProductBarcode(line) || "—"}</div>
                            {line.manage_inventory ? (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-black">
                                <span className={cn("rounded-full px-2 py-0.5", line.available_qty > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                                  صالح للبيع {stockQuantityLabel(line.available_qty)} {line.unitName || line.unit ?? ""}
                                </span>
                                {numberValue(line.physical_qty, line.available_qty) !== line.available_qty ? (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">فعلي {stockQuantityLabel(numberValue(line.physical_qty))}</span>
                                ) : null}
                              </div>
                            ) : null}
                            {showExpiryInSales && line.nearest_expiry ? (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
                                <CalendarDays className="size-3" />
                                الأقرب: {expiryLabel(line.nearest_expiry)}
                                {showBatchInSales && line.nearest_batch_number ? ` — ${line.nearest_batch_number}` : ""}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell><Input disabled={!canPriceOverride} className="h-9 rounded-xl text-center font-black disabled:bg-slate-50 disabled:text-slate-500" dir="ltr" value={line.unit_price} onChange={(e) => updateLine(line.id, { unit_price: numberValue(e.target.value, line.unit_price) })} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button size="icon" variant="outline" className="size-8 rounded-lg" onClick={() => updateLine(line.id, { quantity: line.quantity - quantityStep(line) })}><Minus className="size-3" /></Button>
                              <div className="flex items-center gap-1">
                                <Input
                                  className="h-8 w-16 rounded-lg text-center font-black"
                                  dir="ltr"
                                  inputMode="decimal"
                                  min={quantityStep(line)}
                                  max={line.manage_inventory && !allowNegativeStock ? line.available_qty : undefined}
                                  step={quantityStep(line)}
                                  value={line.quantity}
                                  onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                                />
                                <span className="text-xs font-black text-slate-500 whitespace-nowrap">{line.unitName || line.unit || ""}</span>
                              </div>
                              <Button size="icon" variant="outline" className="size-8 rounded-lg" onClick={() => updateLine(line.id, { quantity: line.quantity + quantityStep(line) })}><Plus className="size-3" /></Button>
                            </div>
                          </TableCell>
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
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-400">الكمية</div><div className="mt-1 text-lg font-black text-slate-950">{stockQuantityLabel(lines.reduce((t, l) => t + l.quantity, 0))}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-400">المجموع</div><div className="mt-1 text-lg font-black text-slate-950">{money(subtotal, currency)}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><Label className="text-xs font-black text-slate-400">خصم الفاتورة (-)</Label><Input disabled={!canDiscount} dir="ltr" className="mt-1 h-9 rounded-xl text-center font-black" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(Math.min(subtotal * (maxDiscountPercent / 100), Math.max(0, numberValue(e.target.value))))} /></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><Label className="text-xs font-black text-slate-400">المدفوع</Label><Input dir="ltr" className="mt-1 h-9 rounded-xl text-center font-black" value={paidAmount} onChange={(e) => setPaidAmount(numberValue(e.target.value))} /></div>
                </div>

                {hasControlledItems && (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2 text-xs font-black text-amber-700">
                      <AlertCircle className="size-4" />
                      دواء مراقب أو يصرف بروشتة — أدخل بيانات الروشتة
                    </div>
                    <div className="space-y-2">
                      {patientOptions.length > 0 ? (
                        <Select value={patientId ?? "manual"} onValueChange={(value) => {
                          if (!value || value === "manual") { setPatientId(null); setPatientName(""); return }
                          const patient = patientOptions.find((item) => item.id === value)
                          setPatientId(value)
                          setPatientName(patient?.name ?? "")
                          if (patient?.partner_id) {
                            setCustomerId(patient.partner_id)
                            setCustomerName(patient.name)
                          }
                        }}>
                          <SelectTrigger className="h-9 rounded-xl border-amber-200 bg-white text-xs"><SelectValue>{patientName || "اختر المريض المسجل"}</SelectValue></SelectTrigger>
                          <SelectContent align="start"><SelectItem value="manual">إدخال اسم يدوي</SelectItem>{patientOptions.map((patient) => <SelectItem key={patient.id} value={patient.id}>{patient.name}{patient.phone ? ` — ${patient.phone}` : ""}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : null}
                      {!patientId ? <Input
                        value={patientName}
                        onChange={(e) => { setPatientId(null); setPatientName(e.target.value) }}
                        placeholder="اسم المريض"
                        className="h-9 rounded-xl border-amber-200 text-xs"
                      /> : null}
                      <div className="flex gap-2">
                        <Input
                          value={doctorName}
                          onChange={(e) => setDoctorName(e.target.value)}
                          placeholder="اسم الدكتور"
                          className="h-9 flex-1 rounded-xl border-amber-200 text-xs"
                        />
                        <Input
                          value={prescriptionNumber}
                          onChange={(e) => setPrescriptionNumber(e.target.value)}
                          placeholder="رقم الروشتة"
                          className="h-9 w-28 rounded-xl border-amber-200 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end">
                  <Button type="button" size="sm" variant="ghost" className="h-8 rounded-xl text-xs font-black" onClick={() => setCouponPanelOpen((current) => !current)}>
                    <Percent className="size-3.5" /> {couponApplied ? "الكوبون مطبق" : couponPanelOpen ? "إخفاء الكوبون" : "إضافة كوبون"}
                  </Button>
                </div>
                {couponPanelOpen || couponApplied ? <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                  <label className="text-xs font-black text-slate-500">كوبون خصم</label>
                  {couponApplied ? (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <span className="flex-1 text-sm font-bold text-emerald-700">{couponApplied.label}</span>
                      <span className="text-sm font-black text-emerald-600">-{money(couponDiscount, currency)}</span>
                      <button onClick={removeCoupon} className="text-xs font-black text-red-500 hover:text-red-700">إلغاء</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value)}
                        placeholder="أدخل كود الكوبون"
                        className="flex-1"
                        onKeyDown={(e) => { if (e.key === "Enter") validateCoupon() }}
                      />
                      <Button size="sm" onClick={validateCoupon} disabled={couponValidating || !couponCode.trim()} className="shrink-0">
                        {couponValidating ? "..." : "تطبيق"}
                      </Button>
                    </div>
                  )}
                </div> : null}
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
                <button key={sale.id} type="button" onClick={() => openSaleDetails(sale.id)} className="flex w-full items-center justify-between rounded-2xl bg-slate-50 p-3 text-right text-xs font-bold transition hover:bg-brand/5">
                  <span className="min-w-0 truncate">{sale.invoice_number} — {sale.customer_name}</span>
                  <span className="flex shrink-0 items-center gap-1 font-black text-brand">{money(numberValue(sale.total), currency)} <ExternalLink className="size-3" /></span>
                </button>
              ))}
              {recentSales.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center text-sm font-bold text-slate-400">لا توجد عمليات حديثة</p> : null}
            </div>
          </div>
        ) : null}

        {shiftClosedPendingReset ? (
          <div className="mx-3 mb-1 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">
            <span>تم تقفيل الجلسة. راجع التفاصيل قبل بدء جلسة جديدة.</span>
            <Button size="sm" className="h-8 rounded-xl" onClick={() => setCloseSummaryOpen(true)}><ListChecks className="size-4" /> تفاصيل التقفيل</Button>
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
            <Button variant="destructive" className="shrink-0 h-9 rounded-xl px-4 text-sm font-black" onClick={clearInvoice} disabled={shiftClosedPendingReset || saving || lines.length === 0}><X className="size-4" /> إلغاء</Button>
            <Button className="shrink-0 h-9 rounded-xl bg-emerald-600 px-4 text-sm font-black hover:bg-emerald-700" onClick={() => void submitSale("cash")} disabled={!quickSaleEnabled || !acceptedPaymentMethods.includes("cash") || !canSell || shiftClosedPendingReset || saving || isPending || lines.length === 0}><DollarSign className="size-4" /> نقدي</Button>
            <Button className="shrink-0 h-9 rounded-xl bg-slate-950 px-4 text-sm font-black hover:bg-slate-800" onClick={() => void submitSale("mixed")} disabled={!quickSaleEnabled || !acceptedPaymentMethods.includes("mixed") || !canSell || shiftClosedPendingReset || saving || isPending || lines.length === 0}><Wallet className="size-4" /> متعدد</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black text-brand" onClick={() => void submitSale("card")} disabled={!quickSaleEnabled || !acceptedPaymentMethods.includes("card") || !canSell || shiftClosedPendingReset || saving || isPending || lines.length === 0}><CreditCard className="size-4" /> بطاقة</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black" onClick={() => void submitSale("credit")} disabled={!quickSaleEnabled || !acceptedPaymentMethods.includes("credit") || !canSell || shiftClosedPendingReset || saving || isPending || lines.length === 0}><Receipt className="size-4" /> أجل</Button>
            <Button variant="outline" className="shrink-0 h-9 rounded-xl px-3 text-sm font-black" onClick={() => saveDraft("تم حفظ عرض السعر كمسودة") } disabled={shiftClosedPendingReset || !settings.bool("sales", "enablePriceOffers", true) || lines.length === 0}><FileText className="size-4" /> عرض سعر</Button>
          </div>

          <Separator orientation="vertical" className="hidden h-8 lg:block" />
          <div className="hidden shrink-0 items-center gap-1.5 text-xs font-black text-slate-500 lg:flex">
            <CalculatorIcon className="size-4" /> الدرج: <span className="text-brand">{money(expectedDrawer, currency)}</span>
          </div>
        </footer>

        <CashierSessionDialog
          open={sessionDialogOpen}
          onOpenChange={setSessionDialogOpen}
          snapshot={shiftSnapshot}
          currency={currency}
          loading={shiftLoading}
          onRefresh={() => void refreshSessionSnapshot()}
          onOpenSale={openSaleDetails}
        />
        <CashierCloseDialog
          open={closeShiftDialogOpen}
          onOpenChange={setCloseShiftDialogOpen}
          expected={shiftSnapshot?.metrics.expectedDrawer ?? expectedDrawer}
          currency={currency}
          loading={closingShift}
          onConfirm={(actual, notes) => void closeShift(actual, notes)}
        />
        <CashierSessionDialog
          open={closeSummaryOpen}
          onOpenChange={(open) => {
            setCloseSummaryOpen(open)
            if (!open && shiftClosedPendingReset) finalizeClosedShiftView()
          }}
          snapshot={shiftSnapshot}
          currency={currency}
          loading={false}
          onOpenSale={openSaleDetails}
          title="تفاصيل تقفيل جلسة الكاشير"
        />
        <CashierShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <InvoiceDiscountDialog
          open={discountDialogOpen}
          onOpenChange={setDiscountDialogOpen}
          subtotal={subtotal}
          currentDiscount={invoiceDiscount}
          maxPercent={maxDiscountPercent}
          currency={currency}
          onApply={setInvoiceDiscount}
        />

        <Dialog open={calculatorOpen} onOpenChange={setCalculatorOpen}>
          <DialogContent dir="rtl" className="z-[140] max-w-[340px] rounded-3xl border-slate-200 bg-slate-50 p-5 shadow-2xl">
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

        <Dialog open={unitSelectorOpen} onOpenChange={(open) => { if (!open) { setUnitSelectorOpen(false); setUnitSelectorProduct(null) } }}>
          <DialogContent dir="rtl" className="z-[140] max-w-[400px] rounded-3xl border-slate-200 bg-white p-5 shadow-2xl">
            <DialogHeader className="text-right">
              <DialogTitle className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Package className="size-5 text-brand" /> اختر وحدة البيع
              </DialogTitle>
              <DialogDescription className="font-bold">
                {unitSelectorProduct?.name_ar ?? ""} — اختر الوحدة التي تريد البيع بها
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-2">
              {(unitSelectorProduct?.units ?? []).filter((u) => u.sale_enabled).map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => { if (unitSelectorProduct) addProductWithUnit(unitSelectorProduct, unit, unitSelectorSource) }}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-transparent bg-slate-50 p-4 text-right transition hover:border-brand/30 hover:bg-brand/[0.03] hover:shadow-sm"
                >
                  <span className="font-black text-slate-950">{unit.unit_name}</span>
                  <span className="text-lg font-black text-brand">{money(unit.sell_price, currency)}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </PageAccess>
  )
}
