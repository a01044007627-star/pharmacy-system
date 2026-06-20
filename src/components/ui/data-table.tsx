"use client"

import * as React from "react"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  type Row,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight, Settings, FileSpreadsheet } from "lucide-react"
import { cn } from "@/lib/utils"
import { PrintContentButton, PrintableTable, type PrintableTableColumn } from "@/components/shared/print-content"

/* eslint-disable @typescript-eslint/no-unused-vars */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    className?: string
    headerClassName?: string
    label?: string
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  emptyText?: string
  pageSize?: number
  showPagination?: boolean
  showExportButtons?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  emptyText = "لا توجد نتائج.",
  pageSize = 10,
  showPagination = true,
  showExportButtons = true,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])

  // TanStack Table intentionally returns mutable helpers; React Compiler must not memoize this call.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: showPagination ? getPaginationRowModel() : undefined,
    initialState: {
      pagination: {
        pageSize: pageSize,
      },
    },
  })

  const exportToCSV = (excelFormat = false) => {
    const visibleColumns = table.getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== "actions" && col.id !== "select" && col.getIsVisible())
    
    const headers = visibleColumns.map((col) => {
      const header = col.columnDef.header
      if (typeof header === "string" && header.trim()) {
        return header
      }
      if (col.columnDef.meta?.label) {
        return col.columnDef.meta.label
      }
      const labels: Record<string, string> = {
        name: "الصنف",
        sku: "الباركود",
        group: "المجموعة",
        unit: "الوحدة",
        buyPrice: "سعر الشراء",
        sellPrice: "سعر البيع",
        currentStock: "المخزون",
        status: "الحالة",
      }
      return labels[col.id] || col.id
    })

    const rows = table.getRowModel().rows.map((row) => {
      return visibleColumns.map((col) => {
        const cellValue = row.getValue(col.id)
        if (cellValue === null || cellValue === undefined) return ""
        return `"${String(cellValue).replace(/"/g, '""')}"`
      })
    })

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `${excelFormat ? "excel-export" : "csv-export"}-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const totalCount = data.length
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination
  const startIndex = totalCount === 0 ? 0 : pageIndex * currentPageSize + 1
  const endIndex = Math.min(totalCount, (pageIndex + 1) * currentPageSize)
  const printableRows = table.getRowModel().rows as Row<TData>[]
  const printableColumns: PrintableTableColumn<Row<TData>>[] = table
    .getAllColumns()
    .filter((col) => col.getCanHide() && col.id !== "actions" && col.id !== "select" && col.getIsVisible())
    .map((col) => {
      const header = col.columnDef.header
      const labels: Record<string, string> = {
        name: "الصنف",
        sku: "الباركود",
        group: "المجموعة",
        unit: "الوحدة",
        buyPrice: "سعر الشراء",
        sellPrice: "سعر البيع",
        currentStock: "المخزون",
        status: "الحالة",
      }
      const label = typeof header === "string" && header.trim() ? header : col.columnDef.meta?.label ?? labels[col.id] ?? col.id
      return {
        key: col.id,
        header: label,
        render: (row) => {
          const value = row.getValue(col.id)
          if (value === null || value === undefined) return ""
          if (typeof value === "number") return value.toLocaleString("ar-EG")
          return String(value)
        },
      }
    })

  return (
    <div className="flex flex-col gap-4">
      {showPagination && !loading && data.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 p-4 text-slate-700" dir="rtl">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">عرض</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(val: string | null) => val && table.setPageSize(Number(val))}
            >
              <SelectTrigger className="h-8 w-20 rounded-lg bg-white border-slate-200 text-xs font-bold justify-between">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="center" className="z-50 min-w-[80px] rounded-lg border-slate-200 p-1 text-center shadow-lg bg-white">
                <SelectItem value="5" className="rounded-md justify-center font-bold text-xs py-1.5">5</SelectItem>
                <SelectItem value="10" className="rounded-md justify-center font-bold text-xs py-1.5">10</SelectItem>
                <SelectItem value="20" className="rounded-md justify-center font-bold text-xs py-1.5">20</SelectItem>
                <SelectItem value="50" className="rounded-md justify-center font-bold text-xs py-1.5">50</SelectItem>
                <SelectItem value="100" className="rounded-md justify-center font-bold text-xs py-1.5">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm font-semibold text-slate-500">إدخالات</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {showExportButtons && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => exportToCSV(false)}
                  className="h-8 rounded-lg text-xs font-bold gap-1.5 bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <FileSpreadsheet className="size-4 text-emerald-600" />
                  تصدير إلى CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => exportToCSV(true)}
                  className="h-8 rounded-lg text-xs font-bold gap-1.5 bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <FileSpreadsheet className="size-4 text-emerald-700" />
                  تصدير إلى Excel
                </Button>
              </>
            )}
            
            <PrintContentButton
              title="تقرير الجدول"
              subtitle={`${printableRows.length.toLocaleString("ar-EG")} صف من محتوى الجدول الحالي`}
              buttonLabel="طباعة"
              disabled={loading}
              className="h-8 rounded-lg border-slate-200 text-slate-600 hover:text-slate-900"
            >
              <PrintableTable columns={printableColumns} rows={printableRows} emptyText={emptyText} />
            </PrintContentButton>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs font-bold gap-1.5 bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <Settings className="size-4 text-slate-500" />
                    رؤية العمود
                  </Button>
                }
              />
              <DropdownMenuContent className="w-48 bg-white border border-slate-100 rounded-xl shadow-lg p-1 text-right">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide() && column.id !== "actions" && column.id !== "select")
                  .map((column) => {
                    const header = column.columnDef.header
                    let label = column.id
                    if (typeof header === "string" && header.trim()) {
                      label = header
                    } else if (column.columnDef.meta?.label) {
                      label = column.columnDef.meta.label
                    } else {
                      const labels: Record<string, string> = {
                        name: "الصنف",
                        sku: "الباركود",
                        group: "المجموعة",
                        unit: "الوحدة",
                        buyPrice: "سعر الشراء",
                        sellPrice: "سعر البيع",
                        currentStock: "المخزون",
                        status: "الحالة",
                      }
                      label = labels[column.id] || column.id
                    }
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(value: boolean) => column.toggleVisibility(!!value)}
                        className="text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-50"
                      >
                        {label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table dir="rtl">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="table-head-row">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const isSorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "table-head h-12 whitespace-nowrap text-right",
                        header.column.columnDef.meta?.headerClassName
                      )}
                      sortKey={canSort ? header.column.id : undefined}
                      currentSortKey={isSorted ? header.column.id : null}
                      sortDirection={isSorted ? (isSorted as "asc" | "desc") : undefined}
                      onSort={() => header.column.toggleSorting(isSorted === "asc")}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(5, pageSize) }).map((_, index) => (
                <TableRow key={index} className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="py-4">
                    <Skeleton className="h-6 w-full rounded-lg" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="table-row"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "table-cell",
                        cell.column.columnDef.meta?.className
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm font-black text-slate-500"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {table.getFooterGroups().some(footerGroup => footerGroup.headers.some(header => !header.isPlaceholder && header.column.columnDef.footer)) && (
            <TableFooter className="bg-slate-50 border-t-2 border-slate-200">
              {table.getFooterGroups().map((footerGroup) => (
                <TableRow key={footerGroup.id} className="hover:bg-slate-50/20">
                  {footerGroup.headers.map((header) => (
                    <TableCell
                      key={header.id}
                      className={cn(
                        "table-cell text-slate-800 font-black text-right p-3",
                        header.column.columnDef.meta?.className
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.footer,
                            header.getContext()
                          )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableFooter>
          )}
        </Table>
      </div>

      {showPagination && !loading && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 pb-4 pt-1 text-slate-500" dir="rtl">
          <div className="text-xs font-bold text-slate-500">
            {`عرض ${startIndex} إلى ${endIndex} من ${totalCount} إدخالات`}
          </div>
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-8 rounded-r-lg rounded-l-none font-bold text-xs gap-1 bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight className="size-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-8 rounded-l-lg rounded-r-none font-bold text-xs gap-1 bg-white border-slate-200 border-r-0 text-slate-600 hover:bg-slate-50"
            >
              التالي
              <ChevronLeft className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
