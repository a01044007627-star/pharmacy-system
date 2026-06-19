export type PurchaseTotals = {
  subtotal: number
  lineDiscount: number
  headerDiscount: number
  tax: number
  shipping: number
  total: number
  paid: number
  due: number
}

export type PurchaseCalculationLine = {
  quantity: number
  buyPrice: number
  discount: number
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculatePurchaseTotals(
  lines: PurchaseCalculationLine[],
  values: { headerDiscount?: number; tax?: number; shipping?: number; paid?: number } = {},
): PurchaseTotals {
  const subtotal = money(lines.reduce((sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.buyPrice), 0))
  const lineDiscount = money(lines.reduce((sum, line) => {
    const gross = Math.max(0, line.quantity) * Math.max(0, line.buyPrice)
    return sum + Math.min(gross, Math.max(0, line.discount))
  }, 0))
  const headerDiscount = money(Math.min(Math.max(0, subtotal - lineDiscount), Math.max(0, values.headerDiscount ?? 0)))
  const tax = money(Math.max(0, values.tax ?? 0))
  const shipping = money(Math.max(0, values.shipping ?? 0))
  const total = money(Math.max(0, subtotal - lineDiscount - headerDiscount + tax + shipping))
  const paid = money(Math.min(total, Math.max(0, values.paid ?? total)))
  return { subtotal, lineDiscount, headerDiscount, tax, shipping, total, paid, due: money(total - paid) }
}
