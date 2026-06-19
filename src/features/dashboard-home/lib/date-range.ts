import type { DashboardDateFilter } from "../types"

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

export function resolveDashboardDateRange(filter: DashboardDateFilter, now = new Date()) {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)

  switch (filter) {
    case "yesterday": {
      const start = addDays(today, -1)
      return { start, end: today }
    }
    case "week":
      return { start: addDays(today, -6), end: tomorrow }
    case "month":
      return { start: addDays(today, -29), end: tomorrow }
    case "thisMonth":
      return { start: startOfMonth(today), end: tomorrow }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start, end }
    }
    case "thisYear":
    case "fiscalYear":
      return { start: startOfYear(today), end: tomorrow }
    case "lastYear":
      return { start: new Date(today.getFullYear() - 1, 0, 1), end: new Date(today.getFullYear(), 0, 1) }
    case "today":
    default:
      return { start: today, end: tomorrow }
  }
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function isoDateTime(date: Date) {
  return date.toISOString()
}

export function listDays(start: Date, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(start, index))
}

export function monthStarts(year: number) {
  return Array.from({ length: 12 }, (_, month) => new Date(year, month, 1))
}

export function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date)
}

export function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(date).replace(" ", "-")
}
