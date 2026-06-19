"use client"

import type { ReactNode } from "react"

export type SummaryCardItem = {
  label: string
  value: ReactNode
  textColor?: string
}

export function SummaryCards({ items, className }: { items: SummaryCardItem[]; className?: string }) {
  return (
    <div
      className={
        className ??
        "grid gap-2 border-t border-slate-100 bg-slate-50/70 p-4 text-center text-[12px] font-black text-slate-700 sm:grid-cols-4"
      }
    >
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="block text-slate-500">{item.label}</span>
          <strong className={`mt-1 block text-base ${item.textColor ?? "text-slate-950"}`}>
            {item.value}
          </strong>
        </div>
      ))}
    </div>
  )
}
