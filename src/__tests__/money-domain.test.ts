import { Money } from "@/domain/shared/decimal-value"

describe("Money", () => {
  it("uses decimal arithmetic instead of binary floating point", () => {
    expect(Money.from(0.1).add(0.2).toNumber()).toBe(0.3)
  })

  it("rounds half up to two decimal places", () => {
    expect(Money.from("10.005").toNumber()).toBe(10.01)
  })

  it("clamps non-negative amounts", () => {
    expect(Money.nonNegative(-5).toNumber()).toBe(0)
  })

  it("does not accumulate intermediate rounding drift", () => {
    expect(Money.from(100).divide(3).multiply(3).toNumber()).toBe(100)
  })
})
