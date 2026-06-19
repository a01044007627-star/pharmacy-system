"use client"

import { Calculator } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calculator as CalculatorWidget } from "@/features/calculator"
import { navbarIconButtonClass } from "./nav-action-button"

export function CalculatorPopover() {
  return (
    <Popover>
      <PopoverTrigger title="الآلة الحاسبة" aria-label="الآلة الحاسبة" className={navbarIconButtonClass}>
        <Calculator className="size-[18px]" strokeWidth={2.35} />
      </PopoverTrigger>
      <PopoverContent
        dir="ltr"
        align="start"
        className="w-auto rounded-2xl border-slate-200 bg-white p-3 shadow-xl"
        sideOffset={10}
      >
        <CalculatorWidget autoFocus />
      </PopoverContent>
    </Popover>
  )
}
