"use client"

import * as React from "react"
import { useReactToPrint } from "react-to-print"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PrintContentButtonProps = {
  title: string
  subtitle?: string
  documentTitle?: string
  buttonLabel?: string
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

const printPageStyle = `
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; direction: rtl; }
  body { font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-content-root { width: 100%; padding: 0; background: #fff; color: #0f172a; direction: rtl; }
  .print-content-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
  .print-content-title { margin: 0; font-size: 23px; font-weight: 900; line-height: 1.35; color: #0f172a; }
  .print-content-subtitle { margin: 6px 0 0; font-size: 12px; font-weight: 700; line-height: 1.8; color: #64748b; }
  .print-content-date { min-width: 150px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; line-height: 1.8; }
  .print-table-wrap { width: 100%; overflow: visible; }
  .print-table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 11px; direction: rtl; }
  .print-table th { background: #eaf4ff; color: #0f172a; font-weight: 900; white-space: nowrap; }
  .print-table th, .print-table td { border: 1px solid #dbe5ef; padding: 7px 8px; text-align: right; vertical-align: middle; line-height: 1.65; }
  .print-table tbody tr:nth-child(even) td { background: #f8fafc; }
  .print-table-empty { padding: 24px !important; text-align: center !important; font-weight: 900; color: #64748b; }
  .print-table-summary { margin: 0 0 12px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .print-table-summary > div { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; background: #f8fafc; }
  .print-table-summary span { display: block; font-size: 10px; color: #64748b; font-weight: 800; }
  .print-table-summary strong { display: block; margin-top: 2px; font-size: 16px; color: #0f172a; font-weight: 900; }
  @media print { .no-print { display: none !important; } }
`

export function PrintContentButton({
  title,
  subtitle,
  documentTitle,
  buttonLabel = "طباعة المحتوى",
  disabled,
  className,
  children,
}: PrintContentButtonProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [printedAt, setPrintedAt] = React.useState("")

  React.useEffect(() => {
    setPrintedAt(new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date()))
  }, [])

  const handlePrint = useReactToPrint({
    contentRef,
    documentTitle: documentTitle ?? title,
    pageStyle: printPageStyle,
  })

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => void handlePrint()}
        className={cn("h-9 gap-1.5 rounded-xl border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 shadow-none hover:bg-slate-50 hover:text-slate-800", className)}
      >
        <Printer className="size-3.5" />
        {buttonLabel}
      </Button>

      <div aria-hidden="true" className="pointer-events-none fixed -left-[10000px] top-0 w-[1120px] bg-white opacity-0">
        <div ref={contentRef} className="print-content-root" dir="rtl">
          <header className="print-content-header">
            <div>
              <h1 className="print-content-title">{title}</h1>
              {subtitle ? <p className="print-content-subtitle">{subtitle}</p> : null}
            </div>
            <div className="print-content-date">
              <div>تاريخ الطباعة</div>
              <div>{printedAt}</div>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </div>
    </>
  )
}

export type PrintableTableColumn<T> = {
  key: string
  header: string
  render: (row: T, index: number) => React.ReactNode
  className?: string
}

export function PrintableTable<T>({
  columns,
  rows,
  emptyText = "لا توجد بيانات متاحة في الجدول",
}: {
  columns: PrintableTableColumn<T>[]
  rows: T[]
  emptyText?: string
}) {
  return (
    <div className="print-table-wrap">
      <table className="print-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>{column.render(row, rowIndex)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="print-table-empty" colSpan={Math.max(columns.length, 1)}>{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
