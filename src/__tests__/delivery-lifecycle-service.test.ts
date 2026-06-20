import { DeliveryLifecycleService } from "@/domain/delivery/delivery-lifecycle-service"
import { DeliveryStatus } from "@/domain/workflows/operational-workflows"

describe("DeliveryLifecycleService", () => {
  const service = new DeliveryLifecycleService()

  it("requires an assigned delivery agent before dispatch", () => {
    expect(() => service.prepareUpdate(
      { status: DeliveryStatus.Preparing, due_amount: 0, payment_method: "cash" },
      { status: DeliveryStatus.Shipped },
    )).toThrow("حدد مندوب التوصيل")
  })

  it("requires full cash-on-delivery collection before delivery", () => {
    expect(() => service.prepareUpdate(
      { status: DeliveryStatus.Shipped, due_amount: 125.5, payment_method: "cod", delivery_agent_name: "مندوب 1" },
      { status: DeliveryStatus.Delivered, collected_amount: 100 },
    )).toThrow("كامل المبلغ المتبقي")
  })

  it("records legal delivery timestamps and exact collection", () => {
    const now = "2026-06-20T12:00:00.000Z"
    expect(service.prepareUpdate(
      { status: DeliveryStatus.Shipped, due_amount: 125.5, payment_method: "cod", delivery_agent_name: "مندوب 1" },
      { status: DeliveryStatus.Delivered, collected_amount: 125.5, proof_of_delivery_url: "https://example.test/proof" },
      now,
    )).toMatchObject({
      status: DeliveryStatus.Delivered,
      collected_amount: 125.5,
      delivered_at: now,
      proof_of_delivery_url: "https://example.test/proof",
    })
  })
})
