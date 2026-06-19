export type ReturnSettlement = {
  total: number
  dueReduction: number
  refundAmount: number
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateReturnSettlement(
  returnTotal: number,
  currentDue: number,
  currentPaid: number,
): ReturnSettlement {
  const total = money(Math.max(0, Number(returnTotal) || 0))
  const due = money(Math.max(0, Number(currentDue) || 0))
  const paid = money(Math.max(0, Number(currentPaid) || 0))
  const dueReduction = money(Math.min(due, total))
  const refundAmount = money(Math.min(Math.max(total - dueReduction, 0), paid))
  return { total, dueReduction, refundAmount }
}
