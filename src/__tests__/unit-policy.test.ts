import { unitPolicyService } from "@/domain/inventory/units/unit-policy"
import { QuantityMode } from "@/domain/inventory/units/unit-types"

describe("UnitPolicyService", () => {
  it("treats tablets as discrete quantities", () => {
    const unit = unitPolicyService.normalizeDefinition({ unit_name: "حباية" })
    expect(unit.quantity_mode).toBe(QuantityMode.Discrete)
    expect(unit.quantity_scale).toBe(0)
    expect(unit.allows_fraction).toBe(false)
  })

  it("treats milliliters as measured quantities", () => {
    const unit = unitPolicyService.normalizeDefinition({ unit_name: "مل" })
    expect(unit.quantity_mode).toBe(QuantityMode.Continuous)
    expect(unit.quantity_scale).toBe(3)
    expect(unit.allows_fraction).toBe(true)
  })

  it("rejects fractional conversion factors for discrete units", () => {
    expect(() => unitPolicyService.normalizeItemUnit({ unit_name: "شريط", factor: 1.5 }, 0)).toThrow(
      "معامل التحويل يجب أن تكون رقمًا صحيحًا لهذه الوحدة",
    )
  })
})
