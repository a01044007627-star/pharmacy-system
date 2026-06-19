"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useCalculator } from "../hooks/use-calculator"
import type { CalculatorProps } from "../types"

type BtnKind = "digit" | "op" | "fn" | "clear" | "equals"

interface BtnDef {
  label: string
  kind: BtnKind
  span?: number
  aria: string
  opKey?: string
}

const layout: BtnDef[][] = [
  [
    { label: "AC", kind: "clear", aria: "مسح الكل" },
    { label: "⌫", kind: "fn", aria: "مسح الرقم الأخير" },
    { label: "%", kind: "fn", aria: "نسبة" },
    { label: "÷", kind: "op", opKey: "÷", aria: "قسمة" },
  ],
  [
    { label: "7", kind: "digit", aria: "7" },
    { label: "8", kind: "digit", aria: "8" },
    { label: "9", kind: "digit", aria: "9" },
    { label: "×", kind: "op", opKey: "×", aria: "ضرب" },
  ],
  [
    { label: "4", kind: "digit", aria: "4" },
    { label: "5", kind: "digit", aria: "5" },
    { label: "6", kind: "digit", aria: "6" },
    { label: "−", kind: "op", opKey: "-", aria: "طرح" },
  ],
  [
    { label: "1", kind: "digit", aria: "1" },
    { label: "2", kind: "digit", aria: "2" },
    { label: "3", kind: "digit", aria: "3" },
    { label: "+", kind: "op", opKey: "+", aria: "جمع" },
  ],
  [
    { label: "±", kind: "fn", aria: "عكس الإشارة" },
    { label: "0", kind: "digit", span: 2, aria: "0" },
    { label: ".", kind: "digit", aria: "فاصلة" },
    { label: "=", kind: "equals", aria: "يساوي" },
  ],
]

const kindVariant: Record<BtnKind, "default" | "outline" | "secondary" | "ghost" | "destructive"> = {
  digit: "outline",
  op: "secondary",
  fn: "ghost",
  clear: "destructive",
  equals: "default",
}

const kindClass: Record<BtnKind, string> = {
  digit:
    "bg-white text-slate-800 border-slate-200 hover:bg-slate-100 active:bg-slate-200 shadow-sm",
  op:
    "bg-amber-50 text-amber-700 hover:bg-amber-100 active:bg-amber-200 border-amber-200 shadow-sm",
  fn:
    "bg-slate-100 text-slate-600 hover:bg-slate-200 active:bg-slate-300 border-slate-200 shadow-sm",
  clear:
    "bg-red-50 text-red-600 hover:bg-red-100 active:bg-red-200 border-red-200 shadow-sm",
  equals:
    "bg-brand text-white hover:bg-brand-hover active:brightness-90 border-brand shadow-md",
}

export function Calculator({ className, onResult, autoFocus }: CalculatorProps) {
  const calc = useCalculator(onResult)
  const { display, op, input, decimal, clear, backspace, negate, percent, performOp, equals } = calc
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const displayFont =
    display.length > 10 ? "text-lg" : display.length > 7 ? "text-xl" : "text-2xl"

  const isError = display === "خطأ"

  const actions: Record<string, () => void> = {
    AC: clear, "⌫": backspace, "%": percent,
    "÷": () => performOp("÷"), "×": () => performOp("×"),
    "−": () => performOp("-"), "+": () => performOp("+"),
    "=": equals, "±": negate, ".": decimal,
  }

  return (
    <div
      ref={ref}
      dir="ltr"
      className={cn("w-[268px] select-none", className)}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          "mb-2 flex h-14 items-center justify-end rounded-2xl px-5 font-mono font-black tabular-nums tracking-tight",
          isError ? "bg-red-50 text-red-600" : "bg-white text-slate-900 border border-slate-200",
          displayFont,
        )}
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="truncate">{display}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="أزرار الآلة الحاسبة">
        {layout.flat().map((def, i) => {
          const active = def.kind === "op" && def.opKey === op

          return (
            <Button
              key={`${def.label}-${i}`}
              variant={kindVariant[def.kind]}
              size="sm"
              onClick={() => {
                const handler = (actions as Record<string, () => void>)[def.label]
                if (handler) handler()
                else input(def.label)
              }}
              aria-label={def.aria}
              className={cn(
                kindClass[def.kind],
                "rounded-xl text-sm font-bold active:scale-90 active:duration-0",
                def.kind === "op" && active && "bg-brand text-white border-brand hover:bg-brand-hover shadow-md",
                def.span === 2 && "col-span-2",
              )}
            >
              {def.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
