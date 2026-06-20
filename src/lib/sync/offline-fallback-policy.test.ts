import { OfflineFallbackPolicy } from "@/lib/sync/offline-fallback-policy"

describe("OfflineFallbackPolicy", () => {
  test("allows actual browser network failures", () => {
    expect(OfflineFallbackPolicy.canFallback(new TypeError("Failed to fetch"))).toBe(true)
    expect(OfflineFallbackPolicy.canFallback(new DOMException("aborted", "AbortError"))).toBe(true)
  })
  test("does not hide RLS, SQL, validation or HTTP failures as offline", () => {
    expect(OfflineFallbackPolicy.canFallback({ code: "42501", message: "permission denied" })).toBe(false)
    expect(OfflineFallbackPolicy.canFallback({ code: "23505", message: "duplicate key" })).toBe(false)
    expect(OfflineFallbackPolicy.canFallback({ status: 500, message: "server error" })).toBe(false)
  })
  test("requires tenant id for pharmacy-owned offline writes", () => {
    expect(() => OfflineFallbackPolicy.assertTenantPayload("pharmacy_sales", { total: 10 })).toThrow(/الصيدلية/)
    expect(() => OfflineFallbackPolicy.assertTenantPayload("pharmacy_sales", { pharmacy_id: "p1" })).not.toThrow()
    expect(() => OfflineFallbackPolicy.assertTenantPayload("system_settings", {})).not.toThrow()
  })
})
