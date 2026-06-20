import { Money } from "@/domain/shared/decimal-value"

export type ReturnSettlement = {
  total: number
  dueReduction: number
  refundAmount: number
}

export function calculateReturnSettlement(
  returnTotal: number,
  currentDue: number,
  currentPaid: number,
): ReturnSettlement {
  const total = Money.nonNegative(returnTotal)
  const due = Money.nonNegative(currentDue)
  const paid = Money.nonNegative(currentPaid)
  const dueReduction = due.min(total)
  const refundAmount = total.subtract(dueReduction).max(0).min(paid)

  return {
    total: total.toNumber(),
    dueReduction: dueReduction.toNumber(),
    refundAmount: refundAmount.toNumber(),
  }
}
