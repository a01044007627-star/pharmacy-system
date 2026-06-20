import Decimal from "decimal.js"

export type DecimalInput = Decimal.Value | null | undefined

function safeDecimal(value: DecimalInput, fallback = 0): Decimal {
  try {
    const decimal = new Decimal(value ?? fallback)
    return decimal.isFinite() ? decimal : new Decimal(fallback)
  } catch {
    return new Decimal(fallback)
  }
}

export class Money {
  static readonly SCALE = 2
  private readonly value: Decimal

  private constructor(value: DecimalInput) {
    this.value = safeDecimal(value).toDecimalPlaces(Money.SCALE, Decimal.ROUND_HALF_UP)
  }

  static zero() {
    return new Money(0)
  }

  static from(value: DecimalInput) {
    return new Money(value)
  }

  static nonNegative(value: DecimalInput) {
    return new Money(Decimal.max(0, safeDecimal(value)))
  }

  add(other: DecimalInput | Money) {
    return new Money(this.value.plus(other instanceof Money ? other.value : safeDecimal(other)))
  }

  subtract(other: DecimalInput | Money) {
    return new Money(this.value.minus(other instanceof Money ? other.value : safeDecimal(other)))
  }

  multiply(other: DecimalInput) {
    return new Money(this.value.times(safeDecimal(other)))
  }

  divide(other: DecimalInput) {
    const divisor = safeDecimal(other)
    if (divisor.isZero()) throw new Error("لا يمكن القسمة على صفر")
    return new Money(this.value.dividedBy(divisor))
  }

  min(other: DecimalInput | Money) {
    const candidate = other instanceof Money ? other.value : safeDecimal(other)
    return new Money(Decimal.min(this.value, candidate))
  }

  max(other: DecimalInput | Money) {
    const candidate = other instanceof Money ? other.value : safeDecimal(other)
    return new Money(Decimal.max(this.value, candidate))
  }

  clamp(min: DecimalInput, max: DecimalInput) {
    return new Money(Decimal.min(Decimal.max(this.value, safeDecimal(min)), safeDecimal(max)))
  }

  isNegative() {
    return this.value.isNegative()
  }

  isZero() {
    return this.value.isZero()
  }

  toNumber() {
    return this.value.toNumber()
  }

  toFixed() {
    return this.value.toFixed(Money.SCALE)
  }

  toJSON() {
    return this.toNumber()
  }
}

export function roundMoney(value: DecimalInput) {
  return Money.from(value).toNumber()
}
