import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { getSettingsEntityConfig, type SettingsEntityKey } from "@/features/settings/lib/settings-entities"
type RouteContext = { params: Promise<{ id: string }> }

type Body = {
  entity?: SettingsEntityKey
  values?: Record<string, unknown>
  setDefault?: boolean
}

async function getDb(): Promise<SupabaseClient> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return createAdminClient() as SupabaseClient
  return (await createClient()) as SupabaseClient
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function cleanValues(values: Record<string, unknown> | undefined) {
  const blocked = new Set(["id", "pharmacy_id", "created_at", "updated_at", "deleted_at"])
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values ?? {})) {
    if (blocked.has(key)) continue
    output[key] = value
  }
  output.updated_at = new Date().toISOString()
  return output
}

async function readExisting(db: SupabaseClient, table: string, id: string) {
  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as (Record<string, unknown> & { pharmacy_id?: string; branch_id?: string | null }) | null
}

async function assertBranchBelongsToPharmacy(db: SupabaseClient, pharmacyId: string, branchId?: unknown) {
  if (typeof branchId !== "string" || !branchId) return
  const { data, error } = await db.from("pharmacy_branches").select("id").eq("pharmacy_id", pharmacyId).eq("id", branchId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error("الفرع المحدد غير تابع لهذه الصيدلية")
}

async function audit(db: SupabaseClient, payload: { pharmacyId: string; actorId: string; event: string; description: string; metadata?: Record<string, unknown> }) {
  await db.from("pharmacy_audit_events").insert({
    pharmacy_id: payload.pharmacyId,
    actor_id: payload.actorId,
    event_type: payload.event,
    severity: "info",
    source: "settings",
    description: payload.description,
    metadata: payload.metadata ?? {},
  }).then(() => undefined, () => undefined)
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const id = (await context.params).id
    const url = new URL(request.url)
    const entity = url.searchParams.get("entity") as SettingsEntityKey | null
    const config = getSettingsEntityConfig(entity)
    if (!config || !entity) return jsonError("نوع إعدادات غير صحيح", 422)

    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: url.searchParams.get("branch_id") })
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    if (!scopeCan(scope, config.read)) return jsonError("ليست لديك صلاحية قراءة هذا السجل", 403)

    const db = await getDb()
    const row = await readExisting(db, config.table, id)
    if (!row) return jsonError("السجل غير موجود", 404)
    if (!scope.isDeveloper && row.pharmacy_id !== scope.activePharmacyId) return jsonError("لا تملك صلاحية على هذا السجل", 403)
    assertBranchScope(scope, row.branch_id)
    return NextResponse.json({ row, entity })
  } catch (error) {
    console.error("settings entity GET failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل تحميل السجل", 500)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const id = (await context.params).id
    const body = (await request.json().catch(() => ({}))) as Body
    const config = getSettingsEntityConfig(body.entity)
    if (!config || !body.entity) return jsonError("نوع إعدادات غير صحيح", 422)

    const scope = await getServerAuthScope()
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    if (!scopeCan(scope, config.write)) return jsonError("ليست لديك صلاحية تعديل هذا السجل", 403)

    const db = await getDb()
    const existing = await readExisting(db, config.table, id)
    if (!existing?.pharmacy_id) return jsonError("السجل غير موجود", 404)
    if (!scope.isDeveloper && existing.pharmacy_id !== scope.activePharmacyId) return jsonError("لا تملك صلاحية على هذا السجل", 403)
    assertBranchScope(scope, existing.branch_id)

    const values = cleanValues(body.values)
    if (values.branch_id !== undefined) {
      assertBranchScope(scope, values.branch_id as string | null | undefined)
      await assertBranchBelongsToPharmacy(db, String(existing.pharmacy_id), values.branch_id)
    }

    if (config.defaultable && (body.setDefault || values.is_default === true)) {
      await db.from(config.table).update({ is_default: false }).eq("pharmacy_id", existing.pharmacy_id)
      values.is_default = true
    }

    const { data, error } = await db.from(config.table).update(values).eq("id", id).select("*").single()
    if (error) throw error
    await audit(db, { pharmacyId: String(existing.pharmacy_id), actorId: scope.user.id, event: `${body.entity}.updated`, description: "تم تعديل سجل إعدادات", metadata: { entity: body.entity, id } })
    return NextResponse.json({ row: data, entity: body.entity })
  } catch (error) {
    console.error("settings entity PATCH failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل تعديل السجل", 400)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const id = (await context.params).id
    const url = new URL(request.url)
    const entity = url.searchParams.get("entity") as SettingsEntityKey | null
    const config = getSettingsEntityConfig(entity)
    if (!config || !entity) return jsonError("نوع إعدادات غير صحيح", 422)

    const scope = await getServerAuthScope()
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    if (!scopeCan(scope, config.delete)) return jsonError("ليست لديك صلاحية حذف هذا السجل", 403)

    const db = await getDb()
    const existing = await readExisting(db, config.table, id)
    if (!existing?.pharmacy_id) return jsonError("السجل غير موجود", 404)
    if (!scope.isDeveloper && existing.pharmacy_id !== scope.activePharmacyId) return jsonError("لا تملك صلاحية على هذا السجل", 403)
    assertBranchScope(scope, existing.branch_id)

    const response = config.softDelete
      ? await db.from(config.table).update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id)
      : await db.from(config.table).delete().eq("id", id)
    if (response.error) throw response.error
    await audit(db, { pharmacyId: String(existing.pharmacy_id), actorId: scope.user.id, event: `${entity}.deleted`, description: "تم حذف سجل إعدادات", metadata: { entity, id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("settings entity DELETE failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل حذف السجل", 400)
  }
}
