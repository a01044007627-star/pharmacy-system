import { resolveCashierStock } from "./cashier-stock"

describe("resolveCashierStock", () => {
  it("uses valid batch quantity as sellable stock for expiry-managed items", () => {
    const result = resolveCashierStock({
      manageInventory: true,
      hasExpiry: true,
      trackBatch: false,
      itemExpiry: null,
      physicalQty: 10,
      validBatchQty: 6,
      expiredBatchQty: 4,
      positiveBatchQty: 10,
      today: "2026-06-20",
    })

    expect(result.sellableQty).toBe(6)
    expect(result.stockIssue).toBe("batch_shortage")
  })

  it("does not expose expired stock as sellable", () => {
    const result = resolveCashierStock({
      manageInventory: true,
      hasExpiry: true,
      trackBatch: true,
      itemExpiry: "2025-08-10",
      physicalQty: 10,
      validBatchQty: 0,
      expiredBatchQty: 10,
      positiveBatchQty: 10,
      today: "2026-06-20",
    })

    expect(result.sellableQty).toBe(0)
    expect(result.stockIssue).toBe("expired_stock")
  })

  it("allows legacy item-level expiry only when it is still valid", () => {
    const valid = resolveCashierStock({
      manageInventory: true,
      hasExpiry: true,
      trackBatch: false,
      itemExpiry: "2027-01-01",
      physicalQty: 8,
      validBatchQty: 0,
      expiredBatchQty: 0,
      positiveBatchQty: 0,
      today: "2026-06-20",
    })
    const expired = resolveCashierStock({
      manageInventory: true,
      hasExpiry: true,
      trackBatch: false,
      itemExpiry: "2025-01-01",
      physicalQty: 8,
      validBatchQty: 0,
      expiredBatchQty: 0,
      positiveBatchQty: 0,
      today: "2026-06-20",
    })

    expect(valid.sellableQty).toBe(8)
    expect(expired.sellableQty).toBe(0)
    expect(expired.stockIssue).toBe("expired_item")
  })
})
