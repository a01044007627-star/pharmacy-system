import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns"
import { ar } from "date-fns/locale"
import { numberValue } from "@/lib/helpers"

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return format(d, "yyyy/MM/dd", { locale: ar })
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return format(d, "yyyy/MM/dd HH:mm", { locale: ar })
}

export function formatTimeAgo(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true, locale: ar })
}

export function money(value: unknown, currency?: string): string {
  const formatted = numberValue(value).toLocaleString("ar-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

export function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  if (isToday(d)) return "اليوم"
  if (isYesterday(d)) return "أمس"
  return formatDate(d)
}
