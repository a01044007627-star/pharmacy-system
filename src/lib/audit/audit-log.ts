import type { SupabaseClient } from "@supabase/supabase-js"

export type AuditSeverity = "info" | "warning" | "error" | "critical"

export type AuditLogPayload = {
  pharmacyId: string
  actorId?: string | null
  branchId?: string | null
  eventType: string
  source: string
  description: string
  severity?: AuditSeverity
  metadata?: Record<string, unknown>
}

export async function writeAuditLog(db: SupabaseClient, payload: AuditLogPayload) {
  if (!payload.pharmacyId || !payload.eventType || !payload.source) return

  try {
    const { error } = await db.from("pharmacy_audit_events").insert({
      pharmacy_id: payload.pharmacyId,
      actor_id: payload.actorId ?? null,
      branch_id: payload.branchId ?? null,
      event_type: payload.eventType,
      severity: payload.severity ?? "info",
      source: payload.source,
      description: payload.description,
      metadata: payload.metadata ?? {},
    })
    if (error) console.warn("audit log write failed", error)
  } catch (error) {
    console.warn("audit log write failed", error)
  }
}
