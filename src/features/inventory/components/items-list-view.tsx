"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Archive,
  Barcode,
  Box,
  Building,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Edit,
  Eye,
  FileSpreadsheet,
  Filter,
  Image as ImageIcon,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Store,
  Trash2,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PrintContentButton, PrintableTable, type PrintableTableColumn } from "@/components/shared/print-content"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type { BranchOption, ItemsMode, ItemsPayload, PharmacyItemListRow, PharmacyOption } from "@/features/inventory/lib/items-types"
import {
  csvCell,
  expiryLabel,
  expiryState,
  isLowStock,
  isOutOfStock,
  itemTypeLabel,
  money,
  numberValue,
  primaryBarcode,
  quantityBreakdownLabel,
  statusLabel,
  unitCountLabel,
  unitEquationLabel,
} from "@/features/inventory/lib/items-helpers"
import { cacheItemsList, queueItemApiRequest, readCachedItemsList } from "@/features/inventory/lib/items-offline"
import { apiRequest, isRequestAbort } from "@/lib/api-client"

type ColumnKey =
  | "select"
  | "image"
  | "actions"
  | "name"
  | "branch"
  | "stock"
  | "unit"
  | "unitEquation"
  | "unitCount"
  | "subUnits"
  | "sellPrice"
  | "oldSellPrice"
  | "buyPrice"
  | "manufacturer"
  | "pharmacyType"
  | "activeIngredient"
  | "dosage"
  | "group"
  | "subCategory"
  | "brand"
  | "type"
  | "productType"
  | "tax"
  | "storage"
  | "customFields"
  | "weight"
  | "expiry"
  | "sku"
  | "status"

const ALL_COLUMNS: Array<{ key: ColumnKey; label: string; canHide?: boolean; className?: string }> = [
  { key: "select", label: "تحديد", canHide: false, className: "w-12 text-center" },
  { key: "actions", label: "خيارات", canHide: false, className: "w-28 text-center" },
  { key: "image", label: "صورة الصنف", canHide: true, className: "w-24 text-center" },
  { key: "name", label: "الصنف", canHide: true, className: "min-w-[240px]" },
  { key: "branch", label: "الفرع", canHide: true, className: "min-w-[160px]" },
  { key: "stock", label: "المخزون الحالي", canHide: true, className: "min-w-[130px] text-center" },
  { key: "unit", label: "وحدة البيع", canHide: true, className: "min-w-[110px]" },
  { key: "unitEquation", label: "معادلة الوحدة", canHide: true, className: "min-w-[190px]" },
  { key: "unitCount", label: "عدد الفرعية", canHide: true, className: "min-w-[110px] text-center" },
  { key: "subUnits", label: "الوحدات المحفوظة", canHide: true, className: "min-w-[180px]" },
  { key: "sellPrice", label: "سعر البيع الجديد", canHide: true, className: "min-w-[150px] text-center" },
  { key: "oldSellPrice", label: "سعر البيع القديم", canHide: true, className: "min-w-[150px] text-center" },
  { key: "buyPrice", label: "سعر الشراء", canHide: true, className: "min-w-[130px] text-center" },
  { key: "manufacturer", label: "الشركة المنتجة", canHide: true, className: "min-w-[180px]" },
  { key: "pharmacyType", label: "النوع الصيدلي", canHide: true, className: "min-w-[150px]" },
  { key: "activeIngredient", label: "المادة الفعالة", canHide: true, className: "min-w-[190px]" },
  { key: "dosage", label: "الشكل والتركيز", canHide: true, className: "min-w-[170px]" },
  { key: "group", label: "المجموعة الرئيسية", canHide: true, className: "min-w-[170px]" },
  { key: "subCategory", label: "المجموعة الفرعية", canHide: true, className: "min-w-[150px]" },
  { key: "brand", label: "الماركة", canHide: true, className: "min-w-[150px]" },
  { key: "tax", label: "الضريبة", canHide: true, className: "min-w-[130px]" },
  { key: "storage", label: "المكان", canHide: true, className: "min-w-[150px]" },
  { key: "expiry", label: "تاريخ الصلاحية", canHide: true, className: "min-w-[170px]" },
  { key: "sku", label: "SKU / الباركود", canHide: true, className: "min-w-[170px]" },
  { key: "status", label: "الحالة", canHide: true, className: "min-w-[110px] text-center" },
]

const DEFAULT_VISIBLE: ColumnKey[] = [
  "select",
  "actions",
  "name",
  "branch",
  "stock",
  "sellPrice",
  "oldSellPrice",
  "manufacturer",
  "pharmacyType",
  "activeIngredient",
  "dosage",
  "group",
  "subCategory",
  "unit",
  "unitEquation",
  "unitCount",
  "subUnits",
  "expiry",
  "sku",
]

const pageSizeOptions = [25, 50, 100, 250, 500, 1000]

const itemTypeOptions = [
  { value: "all", label: "كل الأنواع الصيدلية" },
  { value: "medicine", label: "دواء" },
  { value: "medical_supply", label: "مستلزم طبي" },
  { value: "supplement", label: "مكمل غذائي" },
  { value: "cosmetic", label: "تجميل وعناية بالبشرة" },
  { value: "personal_care", label: "عناية شخصية" },
  { value: "baby_care", label: "أم وطفل" },
  { value: "device", label: "جهاز طبي" },
  { value: "other", label: "صنف صيدلي آخر" },
]

const priceFilterOptions = [
  { value: "all", label: "كل الأسعار" },
  { value: "changed", label: "السعر الجديد مختلف عن القديم" },
  { value: "has-old", label: "له سعر بيع قديم" },
  { value: "new-only", label: "السعر الحالي فقط" },
]

const expiryFilterOptions = [
  { value: "all", label: "كل تواريخ الصلاحية" },
  { value: "soon", label: "قرب الانتهاء" },
  { value: "expired", label: "منتهي" },
  { value: "safe", label: "سليم" },
  { value: "none", label: "بدون تاريخ صلاحية" },
]

const stockFilterOptions = [
  { value: "all", label: "كل الكميات" },
  { value: "low", label: "أقل من الحد الأدنى" },
  { value: "out", label: "نافد" },
  { value: "available", label: "متوفر" },
]

type Filters = {
  branchId: string
  itemType: string
  groupId: string
  brandId: string
  manufacturer: string
  unit: string
  subUnit: string
  expiry: string
  price: string
  stock: string
  notForSale: boolean
}

const defaultFilters: Filters = {
  branchId: "all",
  itemType: "all",
  groupId: "all",
  brandId: "all",
  manufacturer: "all",
  unit: "all",
  subUnit: "all",
  expiry: "all",
  price: "all",
  stock: "all",
  notForSale: false,
}

function filterSelectClass(className?: string) {
  return cn("h-9 w-full justify-between rounded-xl border-slate-200 bg-white text-sm font-black text-slate-800 shadow-sm shadow-slate-100 transition focus:ring-2 focus:ring-sky-100", className)
}

function dropdownClass(className?: string) {
  return cn("z-[9999] max-h-[280px] rounded-xl border border-slate-200 bg-white p-1 text-right shadow-xl shadow-slate-200/70", className)
}

function isPrintColumn(key: ColumnKey) {
  return !["select", "actions", "image"].includes(key)
}

function optionLabel(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

function getFilterChips({
  filters,
  payload,
  branches,
  isDeveloper,
  selectedPharmacy,
}: {
  filters: Filters
  payload: ItemsPayload | null
  branches: BranchOption[]
  isDeveloper: boolean
  selectedPharmacy?: PharmacyOption
}) {
  const chips: string[] = []
  if (isDeveloper && selectedPharmacy) chips.push(`الصيدلية: ${selectedPharmacy.name}`)
  if (filters.branchId !== "all") chips.push(`الفرع: ${branches.find((branch) => branch.id === filters.branchId)?.name ?? filters.branchId}`)
  if (filters.itemType !== "all") chips.push(`النوع الصيدلي: ${optionLabel(itemTypeOptions, filters.itemType)}`)
  if (filters.groupId !== "all") chips.push(`المجموعة: ${payload?.groups.find((group) => group.id === filters.groupId)?.name ?? filters.groupId}`)
  if (filters.brandId !== "all") chips.push(`الماركة: ${payload?.brands.find((brand) => brand.id === filters.brandId)?.name ?? filters.brandId}`)
  if (filters.manufacturer !== "all") chips.push(`الشركة: ${filters.manufacturer}`)
  if (filters.unit !== "all") chips.push(`الوحدة: ${filters.unit}`)
  if (filters.subUnit !== "all") chips.push(`وحدة فرعية: ${filters.subUnit}`)
  if (filters.expiry !== "all") chips.push(`الصلاحية: ${optionLabel(expiryFilterOptions, filters.expiry)}`)
  if (filters.price !== "all") chips.push(`السعر: ${optionLabel(priceFilterOptions, filters.price)}`)
  if (filters.stock !== "all") chips.push(`الكمية: ${optionLabel(stockFilterOptions, filters.stock)}`)
  if (filters.notForSale) chips.push("غير مخصص للبيع")
  return chips
}

function priceChanged(item: PharmacyItemListRow) {
  const oldPrice = numberValue(item.old_sell_price)
  const currentPrice = numberValue(item.sell_price)
  return oldPrice > 0 && currentPrice !== oldPrice
}


export function ItemsListView({ mode = "active" }: { mode?: ItemsMode }) {
  const auth = useAuth()
  const canViewDeleted = auth.can("deleted-records:read") || auth.isDeveloper || auth.isOwner || auth.role === "owner"
  const canCreate = auth.can("inventory:create") || auth.isDeveloper || auth.isOwner
  const canUpdate = auth.can("inventory:update") || auth.can("inventory:write") || auth.isDeveloper || auth.isOwner
  const canDelete = auth.can("inventory:delete") || auth.isDeveloper || auth.isOwner
  const canRestore = auth.can("inventory:restore") || auth.isDeveloper || auth.isOwner
  const canArchive = auth.can("inventory:archive") || auth.isDeveloper || auth.isOwner
  const canExport = auth.can("items:export") || auth.isDeveloper || auth.isOwner
  const canPrint = auth.can("items:print") || auth.isDeveloper || auth.isOwner
  const canViewCost = auth.can("items:view-cost") || auth.isDeveloper || auth.isOwner
  const [pharmacies, setPharmacies] = React.useState<PharmacyOption[]>([])
  const [selectedPharmacyId, setSelectedPharmacyId] = React.useState<string>(auth.activePharmacyId ?? "")
  const [filters, setFilters] = React.useState<Filters>(defaultFilters)
  const [payload, setPayload] = React.useState<ItemsPayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 350)
  const [visibleColumns, setVisibleColumns] = React.useState<Set<ColumnKey>>(() => new Set(DEFAULT_VISIBLE))
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [sort, setSort] = React.useState<{ key: ColumnKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" })
  const [filtersVisible, setFiltersVisible] = React.useState(true)
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const requestRef = React.useRef<AbortController | null>(null)
  const requestSequenceRef = React.useRef(0)
  const payloadRef = React.useRef<ItemsPayload | null>(null)

  React.useEffect(() => {
    if (auth.activePharmacyId && !selectedPharmacyId) setSelectedPharmacyId(auth.activePharmacyId)
  }, [auth.activePharmacyId, selectedPharmacyId])

  React.useEffect(() => {
    if (!auth.isDeveloper) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiRequest<{ pharmacies?: PharmacyOption[] }>("/api/pharmacies", {
          cache: "no-store",
          timeoutMs: 15_000,
          retries: 1,
        })
        if (!cancelled) setPharmacies(data.pharmacies ?? [])
      } catch (err) {
        if (!cancelled && !isRequestAbort(err)) console.warn(err)
      }
    })()
    return () => { cancelled = true }
  }, [auth.isDeveloper])

  const pharmacyId = auth.isDeveloper ? selectedPharmacyId : (auth.activePharmacyId ?? "")
  const queryString = React.useMemo(() => {
    if (!pharmacyId) return ""
    const query = new URLSearchParams()
    query.set("mode", mode)
    query.set("pharmacy_id", pharmacyId)
    query.set("branch_id", filters.branchId)
    query.set("page", String(page))
    query.set("page_size", String(pageSize))
    query.set("sort_key", sort.key)
    query.set("sort_dir", sort.dir)
    if (debouncedSearch) query.set("search", debouncedSearch)
    query.set("pharmacy_type", filters.itemType)
    query.set("group_id", filters.groupId)
    query.set("brand_id", filters.brandId)
    query.set("manufacturer", filters.manufacturer)
    query.set("unit", filters.unit)
    query.set("sub_unit", filters.subUnit)
    query.set("expiry", filters.expiry)
    query.set("price", filters.price)
    query.set("stock", filters.stock)
    if (filters.notForSale) query.set("not_for_sale", "true")
    return query.toString()
  }, [debouncedSearch, filters, mode, page, pageSize, pharmacyId, sort])

  const loadItems = React.useCallback(async () => {
    if (!pharmacyId || !queryString) {
      requestRef.current?.abort()
      setLoading(false)
      const emptyPayload = { items: [], groups: [], brands: [], manufacturers: [], activeIngredients: [], dosageForms: [], pharmacyTypes: [], units: [], subUnits: [], branches: [], pharmacyId: null, branchId: null } as ItemsPayload
      payloadRef.current = emptyPayload
      setPayload(emptyPayload)
      return
    }

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const sequence = ++requestSequenceRef.current
    setLoading(true)
    setError(null)

    try {
      if (!payloadRef.current) {
        const cached = await readCachedItemsList<ItemsPayload>(queryString)
        if (cached && sequence === requestSequenceRef.current && !controller.signal.aborted) { payloadRef.current = cached; setPayload(cached) }
      }

      const nextPayload = await apiRequest<ItemsPayload>(`/api/items?${queryString}`, {
        cache: "no-store",
        signal: controller.signal,
        timeoutMs: 22_000,
        retries: 1,
      })
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return
      payloadRef.current = nextPayload
      setPayload(nextPayload)
      setSelectedIds(new Set())
      void cacheItemsList(queryString, nextPayload)
    } catch (err) {
      if (isRequestAbort(err) || sequence !== requestSequenceRef.current) return
      const cached = await readCachedItemsList<ItemsPayload>(queryString)
      if (cached) {
        payloadRef.current = cached
        setPayload(cached)
        setSelectedIds(new Set())
        setError(null)
        toast.warning("تم عرض آخر نسخة محفوظة لأن الاتصال غير متاح")
      } else {
        const message = err instanceof Error ? err.message : "فشل تحميل الأصناف"
        setError(message)
        toast.error(message)
      }
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false)
    }
  }, [pharmacyId, queryString])

  React.useEffect(() => {
    void loadItems()
    return () => requestRef.current?.abort()
  }, [loadItems])

  const branches = payload?.branches ?? auth.branches as BranchOption[]

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setPage(1)
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const initialLoading = loading && !payload
  const refreshing = loading && Boolean(payload)
  const filteredItems = payload?.items ?? []
  const sortedItems = filteredItems
  const itemsTotal = payload?.itemsTotal ?? sortedItems.length
  const totalPages = payload?.totalPages ?? Math.max(1, Math.ceil(itemsTotal / pageSize))
  const currentPage = payload?.page ?? Math.min(page, totalPages)
  const pagedItems = sortedItems
  const availableColumns = React.useMemo(() => ALL_COLUMNS.filter((column) => {
    if (column.key === "buyPrice") return canViewCost
    return true
  }), [canViewCost])
  const visibleColumnList = availableColumns.filter((column) => visibleColumns.has(column.key))
  const allPageSelected = pagedItems.length > 0 && pagedItems.every((item) => selectedIds.has(item.id))
  const printableColumns = visibleColumnList.filter((column) => isPrintColumn(column.key))
  const selectedPharmacy = pharmacies.find((pharmacy) => pharmacy.id === selectedPharmacyId)
  const branchFilterLabel = filters.branchId === "all" ? "كل الفروع" : branches.find((branch) => branch.id === filters.branchId)?.name ?? "فرع محدد"
  const groupFilterLabel = filters.groupId === "all" ? "كل المجموعات" : payload?.groups.find((group) => group.id === filters.groupId)?.name ?? "مجموعة محددة"
  const brandFilterLabel = filters.brandId === "all" ? "كل الماركات" : payload?.brands.find((brand) => brand.id === filters.brandId)?.name ?? "ماركة محددة"
  const manufacturerFilterLabel = filters.manufacturer === "all" ? "كل الشركات" : filters.manufacturer
  const unitFilterLabel = filters.unit === "all" ? "كل الوحدات" : filters.unit
  const subUnitFilterLabel = filters.subUnit === "all" ? "كل الوحدات الفرعية" : filters.subUnit
  const activeChips = getFilterChips({ filters, payload, branches, isDeveloper: auth.isDeveloper, selectedPharmacy })
  const rowsForPrint = selectedIds.size ? sortedItems.filter((item) => selectedIds.has(item.id)) : sortedItems
  const lowStockCount = payload?.summary?.lowStock ?? filteredItems.filter((item) => isLowStock(item, filters.branchId)).length
  const outOfStockCount = payload?.summary?.outOfStock ?? filteredItems.filter((item) => isOutOfStock(item, filters.branchId)).length
  const expirySoonCount = payload?.summary?.expirySoon ?? filteredItems.filter((item) => expiryState(item) === "soon").length
  const expiredCount = payload?.summary?.expired ?? filteredItems.filter((item) => expiryState(item) === "expired").length
  const printColumns: PrintableTableColumn<PharmacyItemListRow>[] = printableColumns.map((column) => ({
    key: column.key,
    header: column.label,
    render: (item) => exportValue(item, column.key, filters.branchId),
  }))

  const toggleSort = (key: ColumnKey) => {
    if (["select", "actions", "image", "subUnits"].includes(key)) return
    setPage(1)
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })
  }

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  const togglePageSelected = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const item of pagedItems) {
        if (checked) next.add(item.id)
        else next.delete(item.id)
      }
      return next
    })
  }

  const exportRows = (format: "csv" | "excel") => {
    const rows = (selectedIds.size ? sortedItems.filter((item) => selectedIds.has(item.id)) : sortedItems)
    const cols = visibleColumnList.filter((column) => !["select", "actions", "image"].includes(column.key))
    const header = cols.map((column) => csvCell(column.label)).join(",")
    const body = rows.map((item) => cols.map((column) => csvCell(exportValue(item, column.key, filters.branchId))).join(",")).join("\n")
    const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `pharmacy-items-${mode}-${new Date().toISOString().slice(0, 10)}.${format === "excel" ? "csv" : "csv"}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const changeItemStatus = async (item: PharmacyItemListRow, action: "delete" | "restore" | "archive" | "activate" | "deactivate") => {
    const actionAllowed = {
      delete: canDelete,
      restore: canRestore,
      archive: canArchive,
      activate: canUpdate,
      deactivate: canUpdate,
    }[action]

    if (!actionAllowed) {
      toast.error("ليست لديك صلاحية تنفيذ هذا الإجراء")
      return
    }

    try {
      const response = await fetch("/api/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, action, pharmacy_id: selectedPharmacyId || auth.activePharmacyId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "فشل تعديل الصنف")

      const messages: Record<string, string> = {
        delete: "تم نقل الصنف إلى المحذوفات",
        restore: "تم استرجاع الصنف بنجاح",
        archive: "تم أرشفة الصنف",
        activate: "تم تفعيل الصنف",
        deactivate: "تم إلغاء تفعيل الصنف",
      }
      toast.success(messages[action])
      await loadItems()
    } catch (err) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueItemApiRequest({
          path: "/api/items",
          method: "PATCH",
          body: { item_id: item.id, action, pharmacy_id: selectedPharmacyId || auth.activePharmacyId },
        })
        setPayload((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id) } : current)
        toast.warning("تم حفظ العملية محليًا وستتم مزامنتها عند عودة الإنترنت")
      } else {
        toast.error(err instanceof Error ? err.message : "فشل تعديل الصنف")
      }
    }
  }

  const bulkChangeStatus = async (action: "delete" | "restore" | "archive" | "activate" | "deactivate") => {
    const actionAllowed = {
      delete: canDelete,
      restore: canRestore,
      archive: canArchive,
      activate: canUpdate,
      deactivate: canUpdate,
    }[action]
    if (!actionAllowed) {
      toast.error("ليست لديك صلاحية تنفيذ هذا الإجراء")
      return
    }
    const selectedItems = pagedItems.filter((item) => selectedIds.has(item.id))
    if (selectedItems.length === 0) {
      toast.error("حدد صنف واحد على الأقل")
      return
    }
    setBulkBusy(true)
    try {
      const response = await fetch("/api/items/batch-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: selectedItems.map((item) => item.id), action, pharmacy_id: selectedPharmacyId || auth.activePharmacyId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "فشل تحديث الحالة")
      toast.success(`تم تنفيذ الإجراء على ${(data.updated ?? 0).toLocaleString("ar-EG")} صنف`)
    } catch (err) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await Promise.all(selectedItems.map((item) => queueItemApiRequest({
          path: "/api/items",
          method: "PATCH",
          body: { item_id: item.id, action, pharmacy_id: selectedPharmacyId || auth.activePharmacyId },
        })))
        setPayload((current) => current ? { ...current, items: current.items.filter((row) => !selectedIds.has(row.id)) } : current)
        toast.warning("تم حفظ العمليات محليًا وستتم مزامنتها عند عودة الإنترنت")
      } else {
        toast.error(err instanceof Error ? err.message : "فشل تحديث الحالة للأصناف المحددة")
      }
    }
    setBulkBusy(false)
    setSelectedIds(new Set())
    await loadItems()
  }

  if (mode === "deleted" && !canViewDeleted) {
    return (
      <section dir="rtl" className="page-container pb-10 text-right">
        <Card className="rounded-3xl border-amber-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <Trash2 className="size-6" />
            </span>
            <div>
              <h1 className="text-2xl font-black text-slate-950">المحذوفات غير متاحة لهذا الحساب</h1>
              <p className="mt-2 text-sm font-bold leading-7 text-slate-500">قائمة الأصناف المحذوفة تظهر لصاحب الصيدلية والمطور فقط.</p>
            </div>
          </div>
        </Card>
      </section>
    )
  }

  return (
    <section dir="rtl" className="page-container pb-8 pt-4 text-right">
      <div className="mb-4 rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:mb-6 sm:px-6">
        <div className="responsive-toolbar gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black text-slate-500">
              <Package className="size-4 text-brand" />
              <span>{mode === "deleted" ? "إدارة الأصناف المحذوفة" : "إدارة الأصناف"}</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{mode === "deleted" ? "محذوفات الأصناف" : "الأصناف"}</h1>
          </div>

          <div className="responsive-actions">
            {mode === "active" && canCreate ? (
              <Link className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-hover sm:w-auto" href="/dashboard/items/new">
                <Plus className="size-4" />
                إضافة صنف
              </Link>
            ) : null}
            <Button type="button" variant="outline" className="h-10 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-sm font-bold text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900" onClick={() => void loadItems()}>
              <RefreshCw className="size-3.5" />
              تحديث
            </Button>
            {mode === "deleted" ? (
              <Link className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto" href="/dashboard/items">
                <Package className="size-4" />
                الرجوع للأصناف
              </Link>
            ) : canViewDeleted ? (
              <Link className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 text-sm font-black text-rose-700 shadow-sm transition hover:bg-rose-100 sm:w-auto" href="/dashboard/items/deleted">
                <Trash2 className="size-4" />
                المحذوفات
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <Card className="mb-4 overflow-visible rounded-2xl border-slate-200 bg-white shadow-sm sm:mb-6">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-base font-black text-brand">
            <Filter className="size-5" />
            التصفية
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-xl border-sky-100 bg-sky-50 px-3 text-xs font-black text-brand hover:bg-sky-100" onClick={() => setFiltersVisible((prev) => !prev)}>
              <SlidersHorizontal className="size-3.5" />
              {filtersVisible ? "إخفاء التصفية" : "إظهار التصفية"}
            </Button>
            <Button type="button" variant="ghost" className="h-8 rounded-xl text-xs font-black text-slate-400 hover:text-slate-700" onClick={() => { setPage(1); setFilters(defaultFilters); setSearch("") }}>
              <X className="size-3.5" />
              تصفير
            </Button>
          </div>
        </div>

        {filtersVisible ? <div className="grid min-w-0 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 2xl:grid-cols-4">
          {auth.isDeveloper ? (
            <FilterField label="الصيدلية" icon={<Building className="size-4" />}>
              <Select value={selectedPharmacyId || "all"} onValueChange={(value: string | null) => {
                const nextPharmacyId = value && value !== "all" ? value : ""
                requestRef.current?.abort()
                payloadRef.current = null
                setPayload(null)
                setPage(1)
                setSelectedPharmacyId(nextPharmacyId)
                setFilters((prev) => ({ ...prev, branchId: "all" }))
                if (nextPharmacyId) void auth.setActiveScope({ pharmacyId: nextPharmacyId, branchId: null })
              }}>
                <SelectTrigger className={filterSelectClass()}><SelectValue placeholder="اختر الصيدلية">{selectedPharmacy?.name ?? "اختر صيدلية"}</SelectValue></SelectTrigger>
                <SelectContent className={dropdownClass()} align="center">
                  <SelectItem value="all">اختر صيدلية</SelectItem>
                  {pharmacies.map((pharmacy) => <SelectItem key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          ) : null}

          <FilterField label="الفرع" icon={<Store className="size-4" />}>
            <Select value={filters.branchId} onValueChange={(value: string | null) => setFilter("branchId", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{branchFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل الفروع</SelectItem>
                {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="نوع الصنف الصيدلي">
            <AppSelect value={filters.itemType} onChange={(value) => setFilter("itemType", value)} options={itemTypeOptions} />
          </FilterField>

          <FilterField label="المجموعة الرئيسية">
            <Select value={filters.groupId} onValueChange={(value: string | null) => setFilter("groupId", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{groupFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل المجموعات</SelectItem>
                {(payload?.groups ?? []).map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="الماركة">
            <Select value={filters.brandId} onValueChange={(value: string | null) => setFilter("brandId", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{brandFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل الماركات</SelectItem>
                {(payload?.brands ?? []).map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="الشركة المنتجة">
            <Select value={filters.manufacturer} onValueChange={(value: string | null) => setFilter("manufacturer", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{manufacturerFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل الشركات</SelectItem>
                {(payload?.manufacturers ?? []).map((manufacturer) => <SelectItem key={manufacturer} value={manufacturer}>{manufacturer}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="الوحدة الأساسية">
            <Select value={filters.unit} onValueChange={(value: string | null) => setFilter("unit", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{unitFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل الوحدات</SelectItem>
                {(payload?.units ?? []).map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="الوحدات الفرعية">
            <Select value={filters.subUnit} onValueChange={(value: string | null) => setFilter("subUnit", value ?? "all")}>
              <SelectTrigger className={filterSelectClass()}><SelectValue>{subUnitFilterLabel}</SelectValue></SelectTrigger>
              <SelectContent className={dropdownClass()} align="center">
                <SelectItem value="all">كل الوحدات الفرعية</SelectItem>
                {(payload?.subUnits ?? []).map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="تاريخ الصلاحية" icon={<CalendarDays className="size-4" />}>
            <AppSelect value={filters.expiry} onChange={(value) => setFilter("expiry", value)} options={expiryFilterOptions} />
          </FilterField>

          <FilterField label="سعر البيع للجمهور">
            <AppSelect value={filters.price} onChange={(value) => setFilter("price", value)} options={priceFilterOptions} />
          </FilterField>

          <FilterField label="الكمية">
            <AppSelect value={filters.stock} onChange={(value) => setFilter("stock", value)} options={stockFilterOptions} />
          </FilterField>

          <div className="flex items-end">
            <FilterField label="خيارات">
              <label className="flex h-9 w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm shadow-slate-100 transition hover:border-slate-300">
                <span>غير مخصص للبيع</span>
                <Checkbox checked={filters.notForSale} onCheckedChange={(checked: boolean | "indeterminate") => setFilter("notForSale", Boolean(checked))} />
              </label>
            </FilterField>
          </div>
        </div> : null}
        {activeChips.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 sm:px-6">
            <span className="text-xs font-black text-slate-400">الفلاتر الحالية:</span>
            {activeChips.map((chip) => (
              <span key={chip} className="inline-flex h-7 items-center rounded-full border border-sky-100 bg-sky-50 px-3 text-xs font-black text-sky-700">{chip}</span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
          <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex size-9 items-center justify-center rounded-2xl bg-sky-50 text-brand ring-1 ring-sky-100">
                  <Package className="size-4" />
                </span>
                <div>
                  <h2 className="text-lg font-black text-slate-950">{mode === "deleted" ? "الأدوية والأصناف المحذوفة" : "كل الأدوية والأصناف"}</h2>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">{itemsTotal.toLocaleString("ar-EG")} صف حسب الفلاتر الحالية</p>
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="relative w-full lg:w-80 xl:w-96">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                  placeholder="ابحث بالاسم، الباركود، المادة الفعالة، التركيز أو الشركة..."
                  className="h-10 rounded-2xl border-slate-300 bg-white pr-9 pl-3 text-right text-sm font-bold shadow-none focus-visible:ring-2 focus-visible:ring-sky-100"
                />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {canExport ? (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800" onClick={() => exportRows("csv")} disabled={loading}>
                      <FileSpreadsheet className="size-3.5 text-emerald-600" />
                      CSV
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800" onClick={() => exportRows("excel")} disabled={loading}>
                      <FileSpreadsheet className="size-3.5 text-emerald-700" />
                      Excel
                    </Button>
                  </>
                ) : null}
                {canPrint ? (
                <PrintContentButton
                  title={mode === "deleted" ? "تقرير محذوفات الأصناف" : "تقرير كل الأصناف"}
                  subtitle={`${rowsForPrint.length.toLocaleString("ar-EG")} صنف مطبوع${activeChips.length ? ` — الفلاتر: ${activeChips.join("، ")}` : ""}`}
                  buttonLabel="طباعة المحتوى"
                  disabled={loading}
                >
                  <ItemsPrintSummary
                    total={rowsForPrint.length}
                    lowStock={lowStockCount}
                    outOfStock={outOfStockCount}
                    expirySoon={expirySoonCount}
                    expired={expiredCount}
                  />
                  <PrintableTable columns={printColumns} rows={rowsForPrint} />
                </PrintContentButton>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800">
                        <Columns3 className="size-3.5" />
                        عرض الأعمدة
                      </Button>
                    }
                  />
                  <DropdownMenuContent side="bottom" sideOffset={12} className="w-56 rounded-xl border-slate-200 bg-white p-1 text-right shadow-xl" align="center">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-right font-black">اختار الأعمدة</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {availableColumns.filter((column) => column.canHide !== false).map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.key}
                          checked={visibleColumns.has(column.key)}
                          onCheckedChange={(checked: boolean) => {
                            setVisibleColumns((prev) => {
                              const next = new Set(prev)
                              if (checked) next.add(column.key)
                              else next.delete(column.key)
                              return next
                            })
                          }}
                          className="justify-end rounded-lg text-right text-sm font-bold text-slate-700"
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                  <span>عرض</span>
                  <Select value={String(pageSize)} onValueChange={(value: string | null) => { setPage(1); setPageSize(Number(value)) }}>
                    <SelectTrigger className="h-7 w-20 rounded-lg border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent className={dropdownClass("min-w-24")} align="center" side="bottom" sideOffset={12}>
                      {pageSizeOptions.map((size) => <SelectItem key={size} value={String(size)}>{size.toLocaleString("en-US")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span>إدخالات</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-100 px-5 py-2.5 text-xs font-bold text-slate-500 sm:px-6">
          <LegendDot className="bg-rose-200 ring-rose-300" label="نفاد / منتهي" />
          <LegendDot className="bg-amber-200 ring-amber-300" label="كمية ناقصة" />
          <LegendDot className="bg-orange-200 ring-orange-300" label="صلاحية قرب الانتهاء" />
          <span className="me-auto text-slate-400">{itemsTotal.toLocaleString("ar-EG")} صنف مطابق • صفحة {currentPage.toLocaleString("ar-EG")} من {totalPages.toLocaleString("ar-EG")}</span>
        </div>

        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-sky-100 bg-sky-50/70 px-5 py-3 text-sm font-black text-slate-700 sm:px-6">
            <span>{selectedIds.size.toLocaleString("ar-EG")} صنف محدد في الصفحة الحالية</span>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl bg-white" disabled={bulkBusy || !canUpdate} onClick={() => void bulkChangeStatus("activate")}>تفعيل</Button>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl bg-white" disabled={bulkBusy || !canUpdate} onClick={() => void bulkChangeStatus("deactivate")}>إلغاء تفعيل</Button>
            {mode === "deleted" ? (
              <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl bg-white text-emerald-700" disabled={bulkBusy || !canRestore} onClick={() => void bulkChangeStatus("restore")}>استرجاع المحدد</Button>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl bg-white text-amber-700" disabled={bulkBusy || !canArchive} onClick={() => void bulkChangeStatus("archive")}>أرشفة</Button>
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl bg-white text-rose-700" disabled={bulkBusy || !canDelete} onClick={() => void bulkChangeStatus("delete")}>حذف</Button>
              </>
            )}
            <Button type="button" size="sm" variant="ghost" className="h-8 rounded-xl text-slate-500" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</Button>
          </div>
        ) : null}

        {error ? (
          <div className="m-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-black text-rose-700">{error}</div>
        ) : null}

        <div className="relative min-h-[320px] min-w-0 overflow-auto pharmacy-scrollbar px-3 pb-4 sm:px-6 lg:max-h-[calc(100vh-400px)]">
          {refreshing ? (
            <div className="pointer-events-none sticky top-2 z-40 ms-auto mb-2 flex w-fit items-center gap-2 rounded-full border border-blue-100 bg-white/95 px-3 py-1.5 text-xs font-black text-blue-700 shadow-lg backdrop-blur">
              <Loader2 className="size-3.5 animate-spin" /> تحديث النتائج...
            </div>
          ) : null}
          <Table dir="rtl" className="w-full min-w-[1180px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-slate-100 bg-white">
            <TableHeader className="sticky top-0 z-20 bg-white shadow-[0_1px_0_rgba(226,232,240,0.95)]">
              <TableRow className="bg-gradient-to-l from-slate-50 to-white hover:bg-slate-50">
                {visibleColumnList.map((column) => (
                  <TableHead
                    key={column.key}
                    className={cn("group h-11 border-b border-l border-slate-100 px-3 text-right text-xs font-black tracking-wider text-slate-600 last:border-l-0", column.className)}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.key === "select" ? (
                      <div className="flex justify-center">
                        <Checkbox checked={allPageSelected} onCheckedChange={(checked: boolean | "indeterminate") => togglePageSelected(Boolean(checked))} />
                      </div>
                    ) : (
                      <span className="inline-flex cursor-pointer items-center gap-1.5 select-none hover:text-slate-900">
                        {column.label}
                        {sort.key === column.key ? (
                          <span className="text-brand">{sort.dir === "asc" ? "↑" : "↓"}</span>
                        ) : (
                          <span className="text-slate-300 opacity-40 transition group-hover:opacity-100">↕</span>
                        )}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialLoading ? (
                Array.from({ length: 7 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={visibleColumnList.length} className="p-3">
                      <div className="h-8 animate-pulse rounded-xl bg-slate-100" />
                    </TableCell>
                  </TableRow>
                ))
              ) : pagedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnList.length} className="h-36 text-center text-sm font-black text-slate-500">
                    لا توجد بيانات متاحة في الجدول
                  </TableCell>
                </TableRow>
              ) : pagedItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  columns={visibleColumnList}
                  selected={selectedIds.has(item.id)}
                  branchId={filters.branchId}
                  pharmacyId={pharmacyId}
                  mode={mode}
                  permissions={{ canUpdate, canDelete, canRestore, canArchive, canCreate }}
                  onSelect={(checked) => toggleSelected(item.id, checked)}
                  onAction={(action) => void changeItemStatus(item, action)}
                />
              ))}
            </TableBody>
          </Table>
        </div>

          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="text-sm font-bold text-slate-500">
              <>عرض {itemsTotal === 0 ? 0 : ((currentPage - 1) * pageSize + 1).toLocaleString("ar-EG")} إلى {Math.min(currentPage * pageSize, itemsTotal).toLocaleString("ar-EG")} من {itemsTotal.toLocaleString("ar-EG")} إدخالات — صفحة {currentPage.toLocaleString("ar-EG")} / {totalPages.toLocaleString("ar-EG")}</>
              {selectedIds.size ? <span className="me-2 text-brand">— {selectedIds.size.toLocaleString("ar-EG")} محدد</span> : null}
            </div>
            <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Button type="button" variant="ghost" className="h-9 rounded-none border-l border-slate-200 px-4 text-xs font-bold" disabled={currentPage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                <ChevronRight className="size-3.5" />
                السابق
              </Button>
              <span className="flex h-9 min-w-11 items-center justify-center bg-sky-600 px-3 text-sm font-bold text-white">{currentPage.toLocaleString("ar-EG")}</span>
              <Button type="button" variant="ghost" className="h-9 rounded-none px-4 text-xs font-bold" disabled={currentPage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
                التالي
                <ChevronLeft className="size-3.5" />
              </Button>
            </div>
          </div>
      </Card>
    </section>
  )
}


function ItemsPrintSummary({
  total,
  lowStock,
  outOfStock,
  expirySoon,
  expired,
}: {
  total: number
  lowStock: number
  outOfStock: number
  expirySoon: number
  expired: number
}) {
  return (
    <div className="print-table-summary">
      <div><span>إجمالي الأصناف</span><strong>{total.toLocaleString("ar-EG")}</strong></div>
      <div><span>كمية ناقصة</span><strong>{lowStock.toLocaleString("ar-EG")}</strong></div>
      <div><span>نافد</span><strong>{outOfStock.toLocaleString("ar-EG")}</strong></div>
      <div><span>صلاحية تحتاج مراجعة</span><strong>{(expirySoon + expired).toLocaleString("ar-EG")}</strong></div>
    </div>
  )
}

function AppSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <Select value={value} onValueChange={(v: string | null) => onChange(v ?? "all")}>
      <SelectTrigger className={filterSelectClass()}><SelectValue>{optionLabel(options, value)}</SelectValue></SelectTrigger>
      <SelectContent className={dropdownClass()} align="center">
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function FilterField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-black text-slate-600">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full ring-1.5", className)} />{label}</span>
}

function itemScopeHref(path: string, pharmacyId: string) {
  if (!pharmacyId) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}pharmacy_id=${encodeURIComponent(pharmacyId)}`
}

function exportValue(item: PharmacyItemListRow, key: ColumnKey, branchId: string) {
  switch (key) {
    case "name": return `${item.name_ar}${item.name_en ? ` / ${item.name_en}` : ""}`
    case "branch": return item.branch?.name ?? "كل الفروع"
    case "stock": return quantityBreakdownLabel(item, branchId)
    case "unit": return item.unit ?? "—"
    case "unitEquation": return unitEquationLabel(item)
    case "unitCount": return unitCountLabel(item)
    case "subUnits": return (item.sub_units ?? []).map((unit) => `${unit.unit_name} x${unit.factor ?? 1}`).join(" | ")
    case "sellPrice": return money(item.sell_price)
    case "oldSellPrice": return money(item.old_sell_price)
    case "buyPrice": return money(item.buy_price)
    case "manufacturer": return item.manufacturer_name ?? "—"
    case "pharmacyType": return optionLabel(itemTypeOptions, item.pharmacy_type ?? "other")
    case "activeIngredient": return item.active_ingredient ?? item.generic_name ?? "—"
    case "dosage": return [item.dosage_form, item.strength, item.package_size].filter(Boolean).join(" — ") || "—"
    case "group": return item.group?.name ?? "—"
    case "subCategory": return item.sub_category ?? "—"
    case "brand": return item.brand?.name ?? "—"
    case "type": return itemTypeLabel(item.item_type)
    case "productType": return item.product_type === "variable" ? "متغير" : "مفرد"
    case "tax": return item.tax_name ? `${item.tax_name}${numberValue(item.tax_percent) ? ` (${numberValue(item.tax_percent)}%)` : ""}` : (numberValue(item.tax_percent) ? `${numberValue(item.tax_percent)}%` : "—")
    case "storage": return [item.rack, item.shelf_row, item.position].filter(Boolean).join(" / ") || "—"
    case "customFields": return [item.custom_field_1, item.custom_field_2, item.custom_field_3, item.custom_field_4].filter((value): value is string => Boolean(value)).join(" | ") || "—"
    case "weight": return numberValue(item.weight) ? numberValue(item.weight).toLocaleString("ar-EG", { maximumFractionDigits: 3 }) : "—"
    case "expiry": return expiryLabel(item)
    case "sku": return primaryBarcode(item)
    case "status": return statusLabel(item.status)
    default: return ""
  }
}

function ItemRow({
  item,
  columns,
  selected,
  branchId,
  pharmacyId,
  mode,
  permissions,
  onSelect,
  onAction,
}: {
  item: PharmacyItemListRow
  columns: Array<{ key: ColumnKey; label: string; className?: string }>
  selected: boolean
  branchId: string
  pharmacyId: string
  mode: ItemsMode
  permissions: ItemActionPermissions
  onSelect: (checked: boolean) => void
  onAction: (action: "delete" | "restore" | "archive" | "activate" | "deactivate") => void
}) {
  const low = isLowStock(item, branchId)
  const out = isOutOfStock(item, branchId)
  const expState = expiryState(item)
  const rowTone = out || expState === "expired"
    ? "bg-rose-50/70 hover:bg-rose-50"
    : low
      ? "bg-amber-50/70 hover:bg-amber-50"
      : expState === "soon"
        ? "bg-orange-50/70 hover:bg-orange-50"
        : "hover:bg-slate-50/80"

  return (
    <TableRow className={cn("border-b border-slate-100 transition", rowTone)}>
      {columns.map((column) => (
        <TableCell key={column.key} className={cn("border-b border-slate-100 px-3 py-3 text-right text-sm font-bold text-slate-800", column.className)}>
          {renderCell({ item, keyName: column.key, selected, branchId, pharmacyId, mode, permissions, onSelect, onAction })}
        </TableCell>
      ))}
    </TableRow>
  )
}

function renderCell({
  item,
  keyName,
  selected,
  branchId,
  pharmacyId,
  mode,
  permissions,
  onSelect,
  onAction,
}: {
  item: PharmacyItemListRow
  keyName: ColumnKey
  selected: boolean
  branchId: string
  pharmacyId: string
  mode: ItemsMode
  permissions: ItemActionPermissions
  onSelect: (checked: boolean) => void
  onAction: (action: "delete" | "restore" | "archive" | "activate" | "deactivate") => void
}) {
  switch (keyName) {
    case "select":
      return <div className="flex justify-center"><Checkbox checked={selected} onCheckedChange={(checked: boolean | "indeterminate") => onSelect(Boolean(checked))} /></div>
    case "actions":
      return <ItemActions item={item} pharmacyId={pharmacyId} mode={mode} permissions={permissions} onAction={onAction} />
    case "image":
      return item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt={item.name_ar} loading="lazy" decoding="async" className="mx-auto size-10 rounded-xl object-cover ring-1 ring-slate-100" />
      ) : (
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><ImageIcon className="size-5" /></span>
      )
    case "name":
      return (
        <div className="min-w-0">
          <div className="font-black text-slate-950">{item.name_ar}</div>
          {item.name_en ? <div className="mt-0.5 text-xs font-bold text-slate-400" dir="ltr">{item.name_en}</div> : null}
          <div className="mt-1 flex flex-wrap gap-1">
            {item.not_for_sale ? <Badge variant="outline" className="border-rose-100 bg-rose-50 text-rose-600">ليس للبيع</Badge> : null}
            {priceChanged(item) ? <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">سعر جديد</Badge> : null}
          </div>
        </div>
      )
    case "branch": return item.branch?.name ?? <span className="text-slate-400">كل الفروع</span>
    case "stock": {
      const low = isLowStock(item, branchId)
      const out = isOutOfStock(item, branchId)
      return (
        <span className={cn("inline-flex min-w-24 justify-center rounded-full px-3 py-1 text-xs font-black", out ? "bg-rose-100 text-rose-700" : low ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
          {quantityBreakdownLabel(item, branchId)}
        </span>
      )
    }
    case "unit": return item.unit ?? "—"
    case "unitEquation": return <span className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-sky-800">{unitEquationLabel(item)}</span>
    case "unitCount": {
      const count = unitCountLabel(item)
      return count === "—" ? <span className="text-slate-400">—</span> : <Badge variant="outline" className="bg-blue-50 font-black text-blue-700">{count}</Badge>
    }
    case "subUnits": return (item.sub_units ?? []).length ? <div className="flex max-w-[240px] flex-wrap gap-1">{(item.sub_units ?? []).slice(0, 3).map((unit) => <Badge key={unit.id ?? unit.unit_name} variant="outline" className="bg-slate-50 font-black text-slate-600">{unit.unit_name} × {unit.factor ?? 1}</Badge>)}</div> : <span className="text-slate-400">—</span>
    case "sellPrice": return <span className="font-black text-slate-950">{money(item.sell_price)} ج.م</span>
    case "oldSellPrice": return numberValue(item.old_sell_price) > 0 ? <span className="text-slate-500 line-through decoration-slate-400">{money(item.old_sell_price)} ج.م</span> : <span className="text-slate-400">—</span>
    case "buyPrice": return <span>{money(item.buy_price)} ج.م</span>
    case "manufacturer": return item.manufacturer_name ?? <span className="text-slate-400">—</span>
    case "pharmacyType": return <Badge variant="outline" className="bg-violet-50 font-black text-violet-700">{optionLabel(itemTypeOptions, item.pharmacy_type ?? "other")}</Badge>
    case "activeIngredient": return <span className="font-bold text-slate-700">{item.active_ingredient ?? item.generic_name ?? "—"}</span>
    case "dosage": return <div><div className="font-black text-slate-800">{[item.dosage_form, item.strength].filter(Boolean).join(" — ") || "—"}</div>{item.package_size ? <div className="mt-0.5 text-xs font-bold text-slate-400">{item.package_size}</div> : null}</div>
    case "group": return item.group?.name ?? <span className="text-slate-400">—</span>
    case "subCategory": return item.sub_category ?? <span className="text-slate-400">—</span>
    case "brand": return item.brand?.name ?? <span className="text-slate-400">—</span>
    case "type": return itemTypeLabel(item.item_type)
    case "productType": return <Badge variant="outline" className="bg-indigo-50 font-black text-indigo-700">{item.product_type === "variable" ? "متغير" : "مفرد"}</Badge>
    case "tax": return item.tax_name || numberValue(item.tax_percent) ? <span>{item.tax_name ?? "ضريبة"}{numberValue(item.tax_percent) ? ` (${numberValue(item.tax_percent)}%)` : ""}</span> : <span className="text-slate-400">—</span>
    case "storage": return [item.rack, item.shelf_row, item.position].filter(Boolean).length ? <span className="font-mono text-xs font-black" dir="ltr">{[item.rack, item.shelf_row, item.position].filter(Boolean).join(" / ")}</span> : <span className="text-slate-400">—</span>
    case "customFields": return [item.custom_field_1, item.custom_field_2, item.custom_field_3, item.custom_field_4].filter((value): value is string => Boolean(value)).length ? <div className="flex max-w-[260px] flex-wrap gap-1">{[item.custom_field_1, item.custom_field_2, item.custom_field_3, item.custom_field_4].filter((value): value is string => Boolean(value)).map((value) => <Badge key={value} variant="outline" className="bg-slate-50 font-black text-slate-600">{value}</Badge>)}</div> : <span className="text-slate-400">—</span>
    case "weight": return numberValue(item.weight) ? <span>{numberValue(item.weight).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}</span> : <span className="text-slate-400">—</span>
    case "expiry": {
      const state = expiryState(item)
      return <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-black", state === "expired" ? "bg-rose-100 text-rose-700" : state === "soon" ? "bg-orange-100 text-orange-700" : state === "safe" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500")}>{expiryLabel(item)}</span>
    }
    case "sku": return <span dir="ltr" className="font-mono text-xs font-black text-slate-700">{primaryBarcode(item)}</span>
    case "status": return <Badge variant="outline" className="bg-slate-50 font-black text-slate-600">{statusLabel(item.status)}</Badge>
    default: return null
  }
}

type ItemActionPermissions = {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canRestore: boolean
  canArchive: boolean
}

function ItemActions({ item, pharmacyId, mode, permissions, onAction }: { item: PharmacyItemListRow; pharmacyId: string; mode: ItemsMode; permissions: ItemActionPermissions; onAction: (action: "delete" | "restore" | "archive" | "activate" | "deactivate") => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-8 rounded-xl border-blue-200 bg-white px-3 text-xs font-black text-blue-600">
            خيارات
            <SlidersHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent className="w-72 max-h-[min(70vh,520px)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-slate-200 bg-white p-1 text-right shadow-xl" align="end" sideOffset={6}>
        <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/barcode?item=${item.id}`, pharmacyId)} />}>
          طباعة ملصق الدواء <Barcode className="size-4 text-slate-500" />
        </DropdownMenuItem>
        <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/${item.id}`, pharmacyId)} />}>
          بطاقة الدواء <Eye className="size-4 text-slate-500" />
        </DropdownMenuItem>
        {permissions.canUpdate ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/${item.id}/edit`, pharmacyId)} />}>
            تعديل <Edit className="size-4 text-slate-500" />
          </DropdownMenuItem>
        ) : null}
        {mode === "deleted" ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold text-emerald-700" disabled={!permissions.canRestore} onClick={() => onAction("restore")}>
            استرجاع الصنف <Archive className="size-4" />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold text-rose-600" disabled={!permissions.canDelete} onClick={() => onAction("delete")}>
            حذف <Trash2 className="size-4" />
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {permissions.canUpdate ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/${item.id}/opening-stock`, pharmacyId)} />}>
            إضافة كمية افتتاحية جديدة <Box className="size-4 text-slate-500" />
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/${item.id}/card`, pharmacyId)} />}>
          كرت الصنف <RotateCcw className="size-4 text-slate-500" />
        </DropdownMenuItem>
        {permissions.canUpdate ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/price-groups?item=${item.id}`, pharmacyId)} />}>
            إضافة أو تعديل مجموعة الأسعار <FileSpreadsheet className="size-4 text-slate-500" />
          </DropdownMenuItem>
        ) : null}
        {permissions.canCreate ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold" render={<Link href={itemScopeHref(`/dashboard/items/new?duplicate=${item.id}`, pharmacyId)} />}>
            صنف مكرر <Copy className="size-4 text-slate-500" />
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {item.status === "inactive" ? (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold text-emerald-700" disabled={!permissions.canUpdate} onClick={() => onAction("activate")}>تفعيل الصنف <RefreshCw className="size-4" /></DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="justify-end gap-2 rounded-lg font-bold text-amber-700" disabled={!permissions.canUpdate} onClick={() => onAction("deactivate")}>إلغاء تفعيل الصنف <RefreshCw className="size-4" /></DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
