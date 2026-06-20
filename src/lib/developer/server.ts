import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { PermissionError } from "@/lib/auth/server-permissions"

export async function requireDeveloperControlPlane() {
  const scope = await getServerAuthScope()
  if (!scope.user) throw new PermissionError("غير مسجل الدخول", 401)
  if (!scope.isDeveloper) throw new PermissionError("لوحة المنصة متاحة للمطورين فقط", 403)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new PermissionError("مفتاح Service Role مطلوب لتشغيل لوحة المنصة", 503)

  const db = createAdminClient() as SupabaseClient
  const { data: developer, error } = await db.from("developer_users")
    .select("id,user_id,role,is_active,permissions")
    .eq("user_id", scope.user.id)
    .eq("is_active", true)
    .maybeSingle()
  if (error) throw error
  if (!developer) throw new PermissionError("حساب المطور غير مفعل داخل سجل المنصة", 403)
  return { scope, db, developer }
}

export async function writeDeveloperAudit(
  db: SupabaseClient,
  input: {
    developerId: string
    pharmacyId?: string | null
    eventType: string
    severity?: "info" | "warning" | "error" | "critical"
    description: string
    metadata?: Record<string, unknown>
    request?: Request
  },
) {
  const forwarded = input.request?.headers.get("x-forwarded-for")
  const ipAddress = forwarded?.split(",")[0]?.trim() || input.request?.headers.get("x-real-ip") || null
  const { error } = await db.from("developer_audit_events").insert({
    pharmacy_id: input.pharmacyId ?? null,
    developer_id: input.developerId,
    event_type: input.eventType,
    severity: input.severity ?? "info",
    source: "control-plane",
    description: input.description,
    metadata: input.metadata ?? {},
    ip_address: ipAddress,
  })
  if (error) throw error
}
