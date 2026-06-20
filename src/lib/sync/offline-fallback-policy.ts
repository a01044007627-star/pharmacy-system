/** Supabase/PostgREST errors contain a stable code and must not be mistaken for offline mode. */
type StructuredBackendError = { code?: unknown; status?: unknown; message?: unknown; name?: unknown }

export class OfflineFallbackPolicy {
  static canFallback(error: unknown): boolean {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true
    if (!(error instanceof Error) && (!error || typeof error !== "object")) return false

    const candidate = error as StructuredBackendError
    const code = typeof candidate.code === "string" ? candidate.code.trim() : ""
    const status = Number(candidate.status ?? 0)
    if (code) return false
    if (status >= 400) return false

    const name = String(candidate.name ?? "")
    const message = String(candidate.message ?? "").toLowerCase()
    return name === "AbortError"
      || error instanceof TypeError
      || message.includes("failed to fetch")
      || message.includes("networkerror")
      || message.includes("network request failed")
      || message.includes("load failed")
      || message.includes("connection")
  }

  static assertTenantPayload(table: string, payload: Record<string, unknown>): void {
    if (!table.startsWith("pharmacy_")) return
    const pharmacyId = String(payload.pharmacy_id ?? "").trim()
    if (!pharmacyId) throw new Error(`لا يمكن حفظ ${table} دون تحديد الصيدلية النشطة`)
  }
}
