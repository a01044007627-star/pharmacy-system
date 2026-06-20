import {
  DeliveryStatus,
  deliveryWorkflow,
  PurchaseOrderStatus,
  purchaseOrderWorkflow,
} from "@/domain/workflows/operational-workflows"

describe("operational workflows", () => {
  it("allows the normal purchase order lifecycle", () => {
    expect(purchaseOrderWorkflow.canTransition(PurchaseOrderStatus.Draft, PurchaseOrderStatus.Sent)).toBe(true)
    expect(purchaseOrderWorkflow.canTransition(PurchaseOrderStatus.Sent, PurchaseOrderStatus.Received)).toBe(true)
  })

  it("blocks invalid purchase order jumps", () => {
    expect(() => purchaseOrderWorkflow.assertTransition(PurchaseOrderStatus.Draft, PurchaseOrderStatus.Received)).toThrow()
  })

  it("does not allow delivered orders to return to preparation", () => {
    expect(deliveryWorkflow.canTransition(DeliveryStatus.Delivered, DeliveryStatus.Preparing)).toBe(false)
  })
})
