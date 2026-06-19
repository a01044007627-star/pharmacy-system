"use client"

import { cn } from "@/lib/utils"

type BadgeVariant = "paid" | "partial" | "unpaid" | "received" | "pending" | "ordered" | "void" | "cancelled" | "active" | "inactive"

const variantStyles: Record<BadgeVariant, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid: "bg-red-50 text-red-600 border-red-200",
  received: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  ordered: "bg-sky-50 text-sky-700 border-sky-200",
  void: "bg-slate-50 text-slate-600 border-slate-200",
  cancelled: "bg-slate-50 text-slate-600 border-slate-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive: "bg-red-50 text-red-600 border-red-200",
}

export function StatusBadge({
  variant,
  label,
  className,
}: {
  variant: BadgeVariant
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-24 justify-center rounded-full border px-3 py-1 text-[11px] font-black",
        variantStyles[variant] ?? variantStyles.unpaid,
        className
      )}
    >
      {label}
    </span>
  )
}

export function paymentStatusLabel(status: string): string {
  if (status === "paid") return "مدفوعة"
  if (status === "partial") return "جزئية"
  return "غير مدفوعة"
}

export function paymentStatusVariant(status: string): BadgeVariant {
  if (status === "paid") return "paid"
  if (status === "partial") return "partial"
  return "unpaid"
}

export function purchaseStatusLabel(status: string): string {
  if (status === "received") return "مستلمة"
  if (status === "pending") return "في الانتظار"
  if (status === "ordered") return "تم الطلب"
  if (status === "void" || status === "cancelled") return "ملغاة"
  return "مسودة"
}

export function purchaseStatusVariant(status: string): BadgeVariant {
  if (status === "received") return "received"
  if (status === "pending" || status === "ordered") return "pending"
  if (status === "void" || status === "cancelled") return "void"
  return "pending"
}
