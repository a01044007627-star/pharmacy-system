import { calculateReturnSettlement } from "@/features/sales/lib/return-settlement"

describe("calculateReturnSettlement", () => {
  it("settles outstanding credit before refunding cash", () => {
    expect(calculateReturnSettlement(80, 50, 150)).toEqual({
      total: 80,
      dueReduction: 50,
      refundAmount: 30,
    })
  })

  it("does not refund when the return is fully absorbed by the due amount", () => {
    expect(calculateReturnSettlement(40, 100, 0)).toEqual({
      total: 40,
      dueReduction: 40,
      refundAmount: 0,
    })
  })

  it("caps refunds at the currently collected amount", () => {
    expect(calculateReturnSettlement(250, 0, 200)).toEqual({
      total: 250,
      dueReduction: 0,
      refundAmount: 200,
    })
  })

  it("normalizes invalid and negative values", () => {
    expect(calculateReturnSettlement(Number.NaN, -10, -20)).toEqual({
      total: 0,
      dueReduction: 0,
      refundAmount: 0,
    })
  })
})
