"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export const BARCODE_SCAN_EVENT = "pharmacy:barcode-scan"

type BarcodeScannerOptions = {
  onScan?: (barcode: string) => void
  minLength?: number
  terminator?: string
  timeoutMs?: number
  enabled?: boolean
}

export function useBarcodeScanner(options: BarcodeScannerOptions = {}) {
  const { onScan, minLength = 4, terminator = "Enter", timeoutMs = 80, enabled = true } = options
  const [lastBarcode, setLastBarcode] = useState("")
  const bufferRef = useRef("")
  const lastKeyAtRef = useRef(0)

  const handleScan = useCallback((rawBarcode: string) => {
    const barcode = rawBarcode.trim()
    if (barcode.length < minLength) return false
    setLastBarcode(barcode)
    onScan?.(barcode)
    window.dispatchEvent(new CustomEvent(BARCODE_SCAN_EVENT, { detail: { barcode } }))
    return true
  }, [minLength, onScan])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isEditable = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      const now = Date.now()
      if (now - lastKeyAtRef.current > timeoutMs) bufferRef.current = ""
      lastKeyAtRef.current = now

      if (event.key === terminator) {
        const value = bufferRef.current
        bufferRef.current = ""
        if (!isEditable && handleScan(value)) event.preventDefault()
        return
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable) {
        bufferRef.current += event.key
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [enabled, handleScan, terminator, timeoutMs])

  return { handleScan, lastBarcode }
}

type PrintOptions = {
  title?: string
  widthMm?: number
  autoClose?: boolean
}

export function usePrinter() {
  const print = useCallback(async (content: string, options: PrintOptions = {}) => {
    const { title = "طباعة", widthMm = 80, autoClose = true } = options
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=520,height=720")
    if (!printWindow) throw new Error("المتصفح منع نافذة الطباعة؛ اسمح بالنوافذ المنبثقة للمنظومة")

    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>
      @page{size:${Math.max(40, widthMm)}mm auto;margin:3mm}
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Tahoma,sans-serif}
      body{width:${Math.max(40, widthMm)}mm;max-width:100%;padding:2mm}img{max-width:100%;height:auto}
      table{width:100%;border-collapse:collapse}th,td{padding:2mm 1mm;text-align:right;vertical-align:top}
      .no-print{display:none!important}
    </style></head><body>${content}</body></html>`)
    printWindow.document.close()

    await new Promise<void>((resolve) => {
      if (printWindow.document.readyState === "complete") resolve()
      else printWindow.addEventListener("load", () => resolve(), { once: true })
    })
    printWindow.focus()
    printWindow.print()
    if (autoClose) window.setTimeout(() => printWindow.close(), 500)
  }, [])

  return { print }
}
