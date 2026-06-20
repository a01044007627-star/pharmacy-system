"use client"

import { memo, useDeferredValue, useMemo, useState } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, Info, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { PrintContentButton, PrintableTable, type PrintableTableColumn } from "@/components/shared/print-content"
import { cn } from "@/lib/utils"
import type { DashboardTableColumn, DashboardTableConfig, DashboardTone } from "../types"

const toneClasses: Record<DashboardTone, { icon: string; title: string }> = {
  blue: { icon: "text-sky-600 bg-sky-50", title: "text-[#24164f]" },
  green: { icon: "text-emerald-600 bg-emerald-50", title: "text-[#24164f]" },
  amber: { icon: "text-amber-600 bg-amber-50", title: "text-[#24164f]" },
  red: { icon: "text-rose-600 bg-rose-50", title: "text-[#24164f]" },
  purple: { icon: "text-violet-600 bg-violet-50", title: "text-[#24164f]" },
  cyan: { icon: "text-cyan-600 bg-cyan-50", title: "text-[#24164f]" },
  slate: { icon: "text-slate-600 bg-slate-50", title: "text-[#24164f]" },
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return value.toLocaleString("en-US")
  if (typeof value === "string") return value
  return ""
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function columnKey<T extends { id: string }>(column: DashboardTableColumn<T>) {
  return String(column.key)
}

function rawCellValue<T extends { id: string }>(row: T, column: DashboardTableColumn<T>) {
  return stringifyCell(row[column.key as keyof T])
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function buildHtmlTable<T extends { id: string }>(title: string, rows: T[], columns: DashboardTableColumn<T>[]) {
  const head = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("")
  const body = rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(rawCellValue(row, column))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}">لا توجد بيانات متاحة في الجدول</td></tr>`

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; direction: rtl; }
  h1 { margin: 0 0 16px; font-size: 22px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th { background: #e8f2ff; font-size: 13px; font-weight: 800; }
  th, td { border: 1px solid #dbe5ef; padding: 8px 10px; text-align: right; vertical-align: middle; }
  tr:nth-child(even) td { background: #f8fafc; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`
}

interface DashboardReportTableProps<T extends { id: string }> {
  config: DashboardTableConfig<T>
  loading?: boolean
}

function DashboardReportTableInner<T extends { id: string }>({ config, loading }: DashboardReportTableProps<T>) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(config.defaultPageSize ?? 12)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [sortState, setSortState] = useState<{ key: string; direction: "asc" | "desc" } | null>(null)
  const tone = toneClasses[config.tone]
  const Icon = config.icon

  const visibleColumns = useMemo(() => {
    const hidden = new Set(hiddenColumns)
    return config.columns.filter((column) => !hidden.has(columnKey(column)))
  }, [config.columns, hiddenColumns])

  const filteredRows = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase()
    const rows = !search
      ? config.rows
      : config.rows.filter((row) =>
          Object.values(row).some((value) => stringifyCell(value).toLowerCase().includes(search)),
        )

    if (!sortState) return rows
    return [...rows].sort((a, b) => {
      const first = stringifyCell(a[sortState.key as keyof T]).toLowerCase()
      const second = stringifyCell(b[sortState.key as keyof T]).toLowerCase()
      const result = first.localeCompare(second, "ar", { numeric: true })
      return sortState.direction === "asc" ? result : -result
    })
  }, [config.rows, deferredQuery, sortState])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(start, start + pageSize)
  const from = filteredRows.length === 0 ? 0 : start + 1
  const to = Math.min(start + pageSize, filteredRows.length)
  const tableMinWidth = visibleColumns.length <= 4 ? "min-w-full" : "min-w-[1040px]"
  const printColumns = useMemo<PrintableTableColumn<T>[]>(() => {
    return visibleColumns.map((column) => ({
      key: columnKey(column),
      header: column.header,
      render: (row) => rawCellValue(row, column),
    }))
  }, [visibleColumns])

  const toggleColumn = (key: string) => {
    setHiddenColumns((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key)
      if (current.length >= config.columns.length - 1) return current
      return [...current, key]
    })
  }

  const toggleSort = (key: string) => {
    setPage(1)
    setSortState((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" }
      if (current.direction === "asc") return { key, direction: "desc" }
      return null
    })
  }

  const handleCsvExport = () => {
    const header = visibleColumns.map((column) => `"${column.header.replaceAll('"', '""')}"`).join(",")
    const body = filteredRows.map((row) => visibleColumns.map((column) => `"${rawCellValue(row, column).replaceAll('"', '""')}"`).join(",")).join("\n")
    downloadFile(`${config.id}.csv`, `\ufeff${header}\n${body}`, "text/csv;charset=utf-8")
  }

  const handleExcelExport = () => {
    downloadFile(`${config.id}.xls`, buildHtmlTable(config.title, filteredRows, visibleColumns), "application/vnd.ms-excel;charset=utf-8")
  }

  return (
    <Card className={cn("w-full rounded-3xl border-slate-200 bg-white py-0 shadow-[0_10px_26px_rgba(15,23,42,0.06)]", config.className)} dir="rtl">
      <CardHeader className="gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ring-slate-100", tone.icon)}>
              <Icon className="size-5" />
            </span>
            <CardTitle className={cn("text-2xl font-black tracking-tight", tone.title)}>{config.title}</CardTitle>
            {config.info ? (
              <TooltipProvider delay={80}>
                <Tooltip>
                  <TooltipTrigger type="button">
                    <span className="inline-flex">
                      <Info className="size-4 text-[#1f6f8b]" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[300px] text-center text-xs font-bold leading-5">
                    {config.info}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(220px,280px)_auto] sm:items-center">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                placeholder={config.searchPlaceholder ?? "بحث .."}
                className="h-10 rounded-2xl border-slate-300 bg-white pr-9 pl-3 text-right text-sm font-bold shadow-none focus-visible:ring-2 focus-visible:ring-sky-100"
              />
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <span>عرض</span>
              <Select value={String(pageSize)} onValueChange={(value: string | null) => { if (!value) return; setPageSize(Number(value)); setPage(1) }}>
                <SelectTrigger className="h-10 w-24 rounded-2xl border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={12} align="start" className="z-[90] rounded-xl p-1 shadow-xl">
                  {[10, 12, 25, 50, 100, 1000].map((v) => (
                    <SelectItem key={v} value={String(v)} className="h-9 text-sm font-bold">
                      {v.toLocaleString("en-US")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>إدخالات</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCsvExport} disabled={loading} className="h-8 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800">
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExcelExport} disabled={loading} className="h-8 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800">
            <FileSpreadsheet className="size-3.5" />
            Excel
          </Button>
          <PrintContentButton
            title={config.title}
            subtitle={`${filteredRows.length.toLocaleString("ar-EG")} صف حسب البحث والفلاتر الحالية`}
            buttonLabel="طباعة الجدول"
            disabled={loading}
            className="h-8"
          >
            <PrintableTable columns={printColumns} rows={filteredRows} />
          </PrintContentButton>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none transition-colors hover:bg-slate-50 hover:text-slate-800">
              <Columns3 className="size-3.5" />
              رؤية العمود
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" sideOffset={12} align="start" className="z-[90] min-w-48 rounded-xl p-1 text-right shadow-xl">
              <DropdownMenuGroup>
                {config.columns.map((column) => {
                  const key = columnKey(column)
                  return (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={!hiddenColumns.includes(key)}
                      onCheckedChange={() => toggleColumn(key)}
                      className="h-9 text-sm font-bold"
                    >
                      {column.header}
                    </DropdownMenuCheckboxItem>
                  )
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 pt-0 sm:px-6">
        <div className={cn("overflow-auto rounded-2xl border border-slate-100 bg-white pharmacy-scrollbar", config.compact ? "max-h-[405px]" : "max-h-[500px]")}> 
          <Table className={cn(tableMinWidth, "text-[15px]")}> 
            <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(226,232,240,0.9)]">
              <TableRow className="border-b border-slate-100 hover:bg-white">
                {visibleColumns.map((column) => {
                  const key = columnKey(column)
                  const sortMark = sortState?.key === key ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"
                  return (
                    <TableHead
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={cn("h-12 cursor-pointer select-none border-l border-slate-100 px-4 text-right text-base font-black text-slate-950 last:border-l-0", column.className)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {column.header}
                        <span className="text-slate-300">{sortMark}</span>
                      </span>
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: Math.min(pageSize, 8) }, (_, rowIndex) => (
                  <TableRow key={rowIndex} className="border-b border-slate-100">
                    {visibleColumns.map((column, columnIndex) => (
                      <TableCell key={`${String(column.key)}-${columnIndex}`} className="border-l border-slate-100 px-4 py-3 last:border-l-0">
                        <Skeleton className="h-5 w-full rounded-md" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pageRows.length ? (
                pageRows.map((row, rowIndex) => (
                  <TableRow key={row.id} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/75 hover:bg-sky-50/60">
                    {visibleColumns.map((column) => (
                      <TableCell key={String(column.key)} className={cn("border-l border-slate-100 px-4 py-3 text-right text-[15px] font-bold text-slate-950 last:border-l-0", column.className)}>
                        {column.render ? column.render(row, start + rowIndex) : stringifyCell(row[column.key as keyof T])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length} className="h-14 bg-slate-50 text-center text-base font-black text-slate-800">
                    لا توجد بيانات متاحة في الجدول
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-col gap-3 text-sm font-bold text-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <span>عرض {from.toLocaleString("en-US")} إلى {to.toLocaleString("en-US")} من {filteredRows.length.toLocaleString("en-US")} إدخالات</span>
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <Button type="button" variant="ghost" size="sm" className="h-9 rounded-none border-l border-slate-200 px-4 text-xs font-bold" disabled={safePage <= 1 || loading} onClick={() => setPage((v) => Math.max(1, v - 1))}>
              <ChevronRight className="size-3.5" />
              السابق
            </Button>
            <span className="flex h-9 min-w-11 items-center justify-center bg-sky-600 px-3 text-sm font-bold text-white">{safePage}</span>
            <Button type="button" variant="ghost" size="sm" className="h-9 rounded-none px-4 text-xs font-bold" disabled={safePage >= totalPages || loading} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>
              التالي
              <ChevronLeft className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export const DashboardReportTable = memo(DashboardReportTableInner) as typeof DashboardReportTableInner

export function PaymentButton() {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl border-brand/30 bg-white px-3 text-xs font-bold text-brand shadow-none hover:bg-brand-muted hover:text-brand-hover">
      إضافة الدفع
    </Button>
  )
}

export function WarningEmptyState() {
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-600">
      <AlertTriangle className="size-4" />
      يحتاج مراجعة
    </span>
  )
}
