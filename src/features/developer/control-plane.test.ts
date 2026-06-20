import {
  normalizeFeatureFlagName,
  parsePharmacyLifecycleUpdate,
  safeDeveloperAction,
  isFeatureFlagEnabled,
} from "./control-plane"

describe("developer control plane validation", () => {
  test("normalizes a feature flag name", () => {
    expect(normalizeFeatureFlagName(" New Cashier.Flow ")).toBe("new_cashier.flow")
  })

  test("rejects unsafe feature flag names", () => {
    expect(() => normalizeFeatureFlagName("1 bad flag!")).toThrow()
  })

  test("accepts a complete pharmacy lifecycle update", () => {
    const update = parsePharmacyLifecycleUpdate({
      status: "suspended",
      plan: "professional",
      trial_ends_at: "2026-07-01",
      subscription_ends_at: "",
      max_branches: "8",
      max_users: 40,
      developer_notes: "  مراجعة الاشتراك  ",
    }, new Date("2026-06-20T00:00:00.000Z"))

    expect(update).toEqual({
      status: "suspended",
      plan: "professional",
      trial_ends_at: "2026-07-01T00:00:00.000Z",
      subscription_ends_at: null,
      max_branches: 8,
      max_users: 40,
      developer_notes: "مراجعة الاشتراك",
      updated_at: "2026-06-20T00:00:00.000Z",
    })
  })

  test("rejects unsupported pharmacy statuses", () => {
    expect(() => parsePharmacyLifecycleUpdate({ status: "deleted" })).toThrow("حالة الصيدلية")
  })

  test("rejects unsupported plans", () => {
    expect(() => parsePharmacyLifecycleUpdate({ plan: "unlimited-free" })).toThrow("خطة الاشتراك")
  })

  test("rejects invalid limits", () => {
    expect(() => parsePharmacyLifecycleUpdate({ max_users: 0 })).toThrow("حد المستخدمين")
    expect(() => parsePharmacyLifecycleUpdate({ max_branches: 1.5 })).toThrow("حد الفروع")
  })

  test("rejects empty updates", () => {
    expect(() => parsePharmacyLifecycleUpdate({})).toThrow("لا توجد تغييرات")
  })

  test("allows only known developer actions", () => {
    expect(safeDeveloperAction("update_pharmacy")).toBe("update_pharmacy")
    expect(safeDeveloperAction("onboard_client")).toBe("onboard_client")
    expect(() => safeDeveloperAction("drop_database")).toThrow("غير مدعوم")
  })

  test("evaluates global and tenant-scoped feature flags", () => {
    expect(isFeatureFlagEnabled({ enabled: true }, { pharmacyId: "p1", plan: "starter" })).toBe(true)
    expect(isFeatureFlagEnabled({ enabled: false }, { pharmacyId: "p1", plan: "starter" })).toBe(false)
    expect(isFeatureFlagEnabled(
      { enabled: true, conditions: { pharmacy_ids: ["p1"], plans: ["starter"] } },
      { pharmacyId: "p1", plan: "starter" },
    )).toBe(true)
    expect(isFeatureFlagEnabled(
      { enabled: true, conditions: { exclude_pharmacy_ids: ["p1"] } },
      { pharmacyId: "p1", plan: "starter" },
    )).toBe(false)
  })
})
