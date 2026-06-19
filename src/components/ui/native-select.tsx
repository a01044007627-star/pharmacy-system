import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"

const nativeSelectLabelMap: Record<string, string> = {
  all: "الكل",
  none: "بدون",
  active: "نشط",
  inactive: "غير نشط",
  pending: "قيد الانتظار",
  paid: "مدفوع",
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئيًا",
  cash: "نقدي",
  card: "بطاقة",
  wallet: "محفظة",
  bank: "تحويل بنكي",
  cheque: "شيك",
  credit: "آجل",
  supplier: "مورد",
  customer: "عميل",
  both: "مورد وعميل",
}

function localizeNativeOptionLabel(children: React.ReactNode) {
  if (typeof children !== "string") return children
  const key = children.trim().toLowerCase()
  return nativeSelectLabelMap[key] ?? children
}

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
  selectClassName?: string
}

function NativeSelect({
  className,
  selectClassName,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-full min-w-0 has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        dir="rtl"
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-xl border border-input bg-white py-1 pe-10 ps-3.5 text-right text-sm font-bold text-foreground shadow-xs transition-all outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-8 data-[size=sm]:rounded-lg data-[size=sm]:py-0.5 dark:bg-slate-900/30 dark:border-slate-800 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          selectClassName,
        )}
        {...props}
      />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 text-muted-foreground select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  children,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-white py-2 text-right text-slate-900", className)}
      {...props}
    >
      {localizeNativeOptionLabel(children)}
    </option>
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-white py-2 text-right text-slate-900", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
