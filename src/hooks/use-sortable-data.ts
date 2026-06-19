"use client"

import { useState, useMemo } from "react"
import type { SortConfig } from "@/types"

function getSortValue(item: Record<string, unknown>, key: string): unknown {
  if (!item) return undefined
  let val = item[key]
  if (key === "name" && (val === undefined || val === null)) {
    val = item.title ?? item.supplierName ?? item.customerName ?? item.referenceNumber ?? item.id
  }
  const numKeys = ["amount", "balance", "debit", "credit", "total", "paidAmount", "dueAmount", "price"]
  if (numKeys.includes(key)) return Number(val) || 0
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const v = val as Record<string, unknown>
    if (typeof v.seconds === "number") return v.seconds
  }
  return val
}

export function useSortableData<T extends Record<string, unknown>>(items: T[], config: SortConfig | null = null) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(config)

  const sortedItems = useMemo(() => {
    const sortableItems = [...items]
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aVal = getSortValue(a, sortConfig.key)
        const bVal = getSortValue(b, sortConfig.key)
        if (aVal === undefined || aVal === null) return 1
        if (bVal === undefined || bVal === null) return -1
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortConfig.direction === "asc" ? aVal.localeCompare(bVal, "ar") : bVal.localeCompare(aVal, "ar")
        }
        if (typeof aVal === "boolean" && typeof bVal === "boolean") {
          return sortConfig.direction === "asc" ? (aVal ? 1 : 0) - (bVal ? 1 : 0) : (bVal ? 1 : 0) - (aVal ? 1 : 0)
        }
        if ((aVal as number) < (bVal as number)) return sortConfig.direction === "asc" ? -1 : 1
        if ((aVal as number) > (bVal as number)) return sortConfig.direction === "asc" ? 1 : -1
        return 0
      })
    }
    return sortableItems
  }, [items, sortConfig])

  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "asc"
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") direction = "desc"
    setSortConfig({ key, direction })
  }

  return { items: sortedItems, requestSort, sortConfig }
}
