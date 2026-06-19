import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan, assertBranchScope } from "@/lib/auth/server-permissions"
import { getSettingsEntityConfig, type SettingsEntityKey } from "@/features/settings/lib/settings-entities"

type RequestBody = {
  entity?: SettingsEntityKey
  values?: Record<string, unknown>
}

async function getDb(): Promise<SupabaseClient> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return createAdminClient() as SupabaseClient
  return (await createClient()) as SupabaseClient
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function cleanValues(values: Record<string, unknown> | undefined, pharmacyId: string, userId?: string) {
  const input = values && typeof values === "object" ? values : {}
  const blocked = new Set(["id", "pharmacy_id", "created_at", "updated_at", "deleted_at"])
  const output: Record<string, unknown> = { pharmacy_id: pharmacyId }
  for (const [key, value] of Object.entries(input)) {
    if (blocked.has(key)) continue
    output[key] = value
  }
  if (userId && output.created_by === undefined) output.created_by = userId
  return output
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const entity = url.searchParams.get("entity") as SettingsEntityKey | null
    const config = getSettingsEntityConfig(entity)
    if (!config || !entity) return jsonError("نوع إعدادات غير صحيح", 422)

    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id"), requestedBranchId: url.searchParams.get("branch_id") })
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    const pharmacyId = url.searchParams.get("pharmacy_id") || scope.activePharmacyId
    if (!pharmacyId) return jsonError("اختر الصيدلية أولًا", 400)
    if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) return jsonError("لا تملك صلاحية على هذه الصيدلية", 403)
    if (!scopeCan(scope, config.read)) return jsonError("ليست لديك صلاحية قراءة هذا القسم", 403)

    const db = await getDb()
    let query = db.from(config.table).select("*").eq("pharmacy_id", pharmacyId)
    if (config.softDelete) query = query.is("deleted_at", null)
    const branchId = url.searchParams.get("branch_id")
    if (branchId) {
      assertBranchScope(scope, branchId)
      query = query.eq("branch_id", branchId)
    }
    if (config.order) query = query.order(config.order, { ascending: config.ascending ?? true })
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ rows: data ?? [], entity, pharmacyId })
  } catch (error) {
    console.error("settings entities GET failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل تحميل البيانات", 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody
    const config = getSettingsEntityConfig(body.entity)
    if (!config || !body.entity) return jsonError("نوع إعدادات غير صحيح", 422)

    const scope = await getServerAuthScope()
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    const pharmacyId = scope.activePharmacyId
    if (!pharmacyId) return jsonError("اختر الصيدلية أولًا", 400)
    if (!scopeCan(scope, config.write)) return jsonError("ليست لديك صلاحية إنشاء هذا السجل", 403)

    const db = await getDb()
    const values = cleanValues(body.values, pharmacyId, scope.user.id)
    assertBranchScope(scope, values.branch_id as string | null | undefined)
    await assertBranchBelongsToPharmacy(db, pharmacyId, values.branch_id)

    if (config.defaultable && values.is_default === true) {
      await db.from(config.table).update({ is_default: false }).eq("pharmacy_id", pharmacyId)
    }

    const { data, error } = await db.from(config.table).insert(values).select("*").single()
    if (error) throw error
    await audit(db, { pharmacyId, actorId: scope.user.id, event: `${body.entity}.created`, description: "تم إنشاء سجل إعدادات", metadata: { entity: body.entity, id: data?.id } })
    return NextResponse.json({ row: data, entity: body.entity }, { status: 201 })
  } catch (error) {
    console.error("settings entities POST failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل إنشاء السجل", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody & { id?: string }
    const config = getSettingsEntityConfig(body.entity)
    if (!config || !body.entity) return jsonError("نوع إعدادات غير صحيح", 422)
    if (!body.id) return jsonError("معرف السجل مطلوب", 400)

    const scope = await getServerAuthScope()
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    const pharmacyId = scope.activePharmacyId
    if (!pharmacyId) return jsonError("اختر الصيدلية أولًا", 400)
    if (!scopeCan(scope, config.write)) return jsonError("ليست لديك صلاحية تعديل هذا السجل", 403)

    const db = await getDb()
    const values = cleanValues(body.values, pharmacyId)
    delete values.pharmacy_id

    if (config.defaultable && values.is_default === true) {
      await db.from(config.table).update({ is_default: false }).eq("pharmacy_id", pharmacyId)
    }

    const { data, error } = await db.from(config.table).update(values).eq("id", body.id).eq("pharmacy_id", pharmacyId).select("*").maybeSingle()
    if (error) throw error
    if (!data) return jsonError("السجل غير موجود", 404)
    await audit(db, { pharmacyId, actorId: scope.user.id, event: `${body.entity}.updated`, description: "تم تعديل السجل", metadata: { entity: body.entity, id: body.id } })
    return NextResponse.json({ row: data, entity: body.entity })
  } catch (error) {
    console.error("settings entities PATCH failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل تعديل السجل", 400)
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const entity = url.searchParams.get("entity") as SettingsEntityKey | null
    const id = url.searchParams.get("id")
    const config = getSettingsEntityConfig(entity)
    if (!config || !entity) return jsonError("نوع إعدادات غير صحيح", 422)
    if (!id) return jsonError("معرف السجل مطلوب", 400)

    const scope = await getServerAuthScope()
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)
    const pharmacyId = scope.activePharmacyId
    if (!pharmacyId) return jsonError("اختر الصيدلية أولًا", 400)
    if (!scopeCan(scope, config.delete)) return jsonError("ليست لديك صلاحية حذف هذا السجل", 403)

    const db = await getDb()
    if (config.softDelete) {
      const { error } = await db.from(config.table).update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("pharmacy_id", pharmacyId)
      if (error) throw error
    } else {
      const { error } = await db.from(config.table).delete().eq("id", id).eq("pharmacy_id", pharmacyId)
      if (error) throw error
    }
    await audit(db, { pharmacyId, actorId: scope.user.id, event: `${entity}.deleted`, description: "تم حذف السجل", metadata: { entity, id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("settings entities DELETE failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل حذف السجل", 400)
  }
}
