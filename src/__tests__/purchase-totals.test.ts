import { calculatePurchaseTotals } from "@/features/purchases/lib/purchase-totals"

describe("calculatePurchaseTotals", () => {
  it("calculates discounts, tax, shipping and due amount", () => {
    expect(calculatePurchaseTotals(
      [
        { quantity: 2, buyPrice: 100, discount: 20 },
        { quantity: 1, buyPrice: 50, discount: 0 },
      ],
      { headerDiscount: 10, tax: 14, shipping: 6, paid: 100 },
    )).toEqual({
      subtotal: 250,
      lineDiscount: 20,
      headerDiscount: 10,
      tax: 14,
      shipping: 6,
      total: 240,
      paid: 100,
      due: 140,
    })
  })

  it("caps discounts and paid amount", () => {
    expect(calculatePurchaseTotals(
      [{ quantity: 1, buyPrice: 50, discount: 100 }],
      { headerDiscount: 100, paid: 500 },
    )).toEqual({
      subtotal: 50,
      lineDiscount: 50,
      headerDiscount: 0,
      tax: 0,
      shipping: 0,
      total: 0,
      paid: 0,
      due: 0,
    })
  })
})
