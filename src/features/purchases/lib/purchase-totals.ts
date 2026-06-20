import { Money } from "@/domain/shared/decimal-value"

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

export function calculatePurchaseTotals(
  lines: PurchaseCalculationLine[],
  values: { headerDiscount?: number; tax?: number; shipping?: number; paid?: number } = {},
): PurchaseTotals {
  let subtotal = Money.zero()
  let lineDiscount = Money.zero()

  for (const line of lines) {
    const gross = Money.nonNegative(line.buyPrice).multiply(Math.max(0, Number(line.quantity) || 0))
    subtotal = subtotal.add(gross)
    lineDiscount = lineDiscount.add(Money.nonNegative(line.discount).min(gross))
  }

  const netBeforeHeader = subtotal.subtract(lineDiscount).max(0)
  const headerDiscount = Money.nonNegative(values.headerDiscount).min(netBeforeHeader)
  const tax = Money.nonNegative(values.tax)
  const shipping = Money.nonNegative(values.shipping)
  const total = netBeforeHeader.subtract(headerDiscount).add(tax).add(shipping).max(0)
  const paid = Money.nonNegative(values.paid ?? total.toNumber()).min(total)
  const due = total.subtract(paid).max(0)

  return {
    subtotal: subtotal.toNumber(),
    lineDiscount: lineDiscount.toNumber(),
    headerDiscount: headerDiscount.toNumber(),
    tax: tax.toNumber(),
    shipping: shipping.toNumber(),
    total: total.toNumber(),
    paid: paid.toNumber(),
    due: due.toNumber(),
  }
}
