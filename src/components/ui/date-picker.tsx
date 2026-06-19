"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value?: Date
  onChange?: (date: Date | undefined) => void
  placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            dir="rtl"
            data-empty={!value}
            className="h-10 w-full rounded-xl border-slate-200 bg-white px-3.5 py-1 text-sm font-semibold shadow-xs transition-all outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50 hover:bg-slate-50/50 justify-between flex items-center gap-1.5 data-[empty=true]:text-muted-foreground"
          />
        }
      >
        <span className="flex-1 text-right">
          {value ? format(value, "yyyy-MM-dd") : (placeholder ?? "اختر التاريخ")}
        </span>
        <CalendarIcon className="size-4 text-muted-foreground pointer-events-none shrink-0" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange?.(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
