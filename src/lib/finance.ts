import Decimal from "decimal.js"

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return parseFloat(value) || 0
  if (value === null || value === undefined) return 0
  if (typeof value === "boolean") return value ? 1 : 0
  return 0
}

export function money(value: number): string {
  return new Intl.NumberFormat("ar-EG", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  return new Decimal(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function positive(value: number): number {
  return Math.max(0, value)
}

export function calculateVAT(amount: number, rate = 0.15): number {
  return new Decimal(amount).times(rate).toNumber()
}

export function calculateDiscount(
  amount: number,
  discountPercent: number
): number {
  return new Decimal(amount).times(discountPercent).div(100).toNumber()
}

export function calculateProfit(cost: number, sellingPrice: number): number {
  return new Decimal(sellingPrice).minus(cost).toNumber()
}

export function calculateProfitMargin(cost: number, sellingPrice: number): number {
  if (cost === 0) return 0
  return new Decimal(sellingPrice).minus(cost).div(sellingPrice).times(100).toNumber()
}

export function roundTo(amount: number, decimals = 2): number {
  return new Decimal(amount).toDecimalPlaces(decimals).toNumber()
}

export function percent(value: number, total: number): number {
  if (total === 0) return 0
  return (value / total) * 100
}

export function settlePayment(paid: number, due: number): { remaining: number; change: number } {
  if (paid >= due) return { remaining: 0, change: paid - due }
  return { remaining: due - paid, change: 0 }
}

export function discountAmount(price: number, discountPercent: number): number {
  return price * (discountPercent / 100)
}

export function paymentStatus(total: number, paid: number): "unpaid" | "paid" | "partial" {
  if (paid <= 0) return "unpaid"
  if (paid >= total) return "paid"
  return "partial"
}
