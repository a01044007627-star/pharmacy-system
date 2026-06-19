"use client"

import { cn } from "@/lib/utils"

export function PriceInput({
  id, value, onChange, placeholder = "0.00", highlighted, dir = "ltr",
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  highlighted?: boolean
  dir?: "ltr" | "rtl"
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden",
        highlighted && "border-emerald-300 ring-2 ring-emerald-100",
      )}
    >
      <span className={cn("flex h-full items-center border-l border-slate-200 bg-slate-50 px-3 text-[11px] font-black text-slate-500", highlighted && "text-emerald-700")}>
        ج.م
      </span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder={placeholder}
        dir={dir}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-left font-bold text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none"
      />
    </div>
  )
}
