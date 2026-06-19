import type { DashboardHomePayload } from "@/features/dashboard-home/types"

export type DailyProfitRow = {
  label: string
  value: number
  hint?: string
  tone?: "blue" | "green" | "amber" | "white"
  status?: "calculated" | "estimated" | "not_enabled"
}

export type DailyProfitSummary = {
  generatedAt: number
  rangeStart: number
  rangeEnd: number
  dataSource: "online" | "offline"
  pendingSyncCount: number
  salesSubtotal: number
  salesTotal: number
  salesDiscount: number
  salesShipping: number
  salesExtraFees: number
  salesReturnTotal: number
  customerRewardDiscounts: number
  purchasesSubtotal: number
  purchasesTotal: number
  purchaseShipping: number
  purchaseExtraExpenses: number
  purchaseTransferCost: number
  purchaseReturnTotal: number
  purchaseDiscounts: number
  roundingDifferences: number
  moduleRevenues: number
  endingInventoryPurchaseValue: number
  endingInventorySaleValue: number
  openingInventoryPurchaseValue: number
  openingInventorySaleValue: number
  expensesTotal: number
  stockCountGainLoss: number
  salariesTotal: number
  productionCostTotal: number
  damagedStockCost: number
  costOfGoodsSold: number
  grossProfit: number
  netProfit: number
  salesCount: number
  purchasesCount: number
  expensesCount: number
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function startOfLocalDay(date = new Date()) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

export function todayProfitRange(date = new Date()) {
  const rangeStart = startOfLocalDay(date)
  return { rangeStart, rangeEnd: rangeStart + DAY_MS }
}

function baseSummary(date = new Date()): DailyProfitSummary {
  const { rangeStart, rangeEnd } = todayProfitRange(date)
  return {
    generatedAt: Date.now(),
    rangeStart,
    rangeEnd,
    dataSource: "offline",
    pendingSyncCount: 0,
    salesSubtotal: 0,
    salesTotal: 0,
    salesDiscount: 0,
    salesShipping: 0,
    salesExtraFees: 0,
    salesReturnTotal: 0,
    customerRewardDiscounts: 0,
    purchasesSubtotal: 0,
    purchasesTotal: 0,
    purchaseShipping: 0,
    purchaseExtraExpenses: 0,
    purchaseTransferCost: 0,
    purchaseReturnTotal: 0,
    purchaseDiscounts: 0,
    roundingDifferences: 0,
    moduleRevenues: 0,
    endingInventoryPurchaseValue: 0,
    endingInventorySaleValue: 0,
    openingInventoryPurchaseValue: 0,
    openingInventorySaleValue: 0,
    expensesTotal: 0,
    stockCountGainLoss: 0,
    salariesTotal: 0,
    productionCostTotal: 0,
    damagedStockCost: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    netProfit: 0,
    salesCount: 0,
    purchasesCount: 0,
    expensesCount: 0,
  }
}

function valueOf(payload: DashboardHomePayload, id: string) {
  return roundMoney(payload.kpis.find((item) => item.id === id)?.value ?? 0)
}

function countFromHint(payload: DashboardHomePayload, id: string) {
  const hint = payload.kpis.find((item) => item.id === id)?.hint ?? ""
  const firstNumber = hint.match(/\d+/)?.[0]
  return firstNumber ? Number(firstNumber) : 0
}

export async function buildDailyProfitSummary(userId?: string, date = new Date()): Promise<DailyProfitSummary> {
  const summary = baseSummary(date)

  if (typeof window === "undefined") return summary

  try {
    const branchId = window.localStorage.getItem("active-branch-id") ?? "all"
    const params = new URLSearchParams({ date_filter: "today", branch_id: branchId || "all" })
    const response = await fetch(`/api/dashboard/home?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) throw new Error("dashboard-home request failed")
    const payload = (await response.json()) as DashboardHomePayload

    const salesTotal = valueOf(payload, "sales-total")
    const salesReturnTotal = valueOf(payload, "sales-returns")
    const purchasesTotal = valueOf(payload, "purchases-total")
    const purchaseReturnTotal = valueOf(payload, "purchase-returns")
    const expensesTotal = valueOf(payload, "expenses-total")
    const netProfit = valueOf(payload, "net-income")
    const grossProfit = roundMoney(salesTotal - salesReturnTotal)

    return {
      ...summary,
      generatedAt: Date.now(),
      dataSource: "online",
      salesTotal,
      salesSubtotal: salesTotal,
      salesReturnTotal,
      purchasesTotal,
      purchasesSubtotal: purchasesTotal,
      purchaseReturnTotal,
      expensesTotal,
      grossProfit,
      netProfit,
      salesCount: countFromHint(payload, "sales-total"),
      purchasesCount: countFromHint(payload, "purchases-total"),
      expensesCount: countFromHint(payload, "expenses-total"),
    }
  } catch {
    return summary
  }
}
