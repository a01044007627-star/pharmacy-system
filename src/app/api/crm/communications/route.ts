import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

const CHANNELS = new Set(["email", "whatsapp", "phone", "sms", "note"])
const DIRECTIONS = new Set(["inbound", "outbound"])
const STATUSES = new Set(["draft", "sent", "read", "completed", "failed"])

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

async function readPartner(db: SupabaseClient, pharmacyId: string, partnerId: string) {
  const { data, error } = await db
    .from("pharmacy_partners")
    .select("id,name")
    .eq("pharmacy_id", pharmacyId)
    .eq("id", partnerId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("جهة الاتصال المحددة غير تابعة للصيدلية")
  return data
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id"),
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض سجل التواصل" }, { status: 403 })

    const page = safeInt(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeInt(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const query = safeSearch(clean(url.searchParams.get("query")))
    const channel = clean(url.searchParams.get("channel"))
    const status = clean(url.searchParams.get("status"))
    const branchId = clean(url.searchParams.get("branch_id")) || null
    assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    let listQuery = db
      .from("pharmacy_partner_communications")
      .select("id,pharmacy_id,branch_id,partner_id,partner_name,channel,direction,subject,body,status,occurred_at,created_at,updated_at,partner:pharmacy_partners(id,name,phone,email,type)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("occurred_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (branchId) listQuery = listQuery.eq("branch_id", branchId)
    if (CHANNELS.has(channel)) listQuery = listQuery.eq("channel", channel)
    if (STATUSES.has(status)) listQuery = listQuery.eq("status", status)
    if (query) listQuery = listQuery.or(`partner_name.ilike.%${query}%,subject.ilike.%${query}%,body.ilike.%${query}%`)

    const { data, error, count } = await listQuery
    if (error) throw error
    return NextResponse.json({
      communications: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    })
  } catch (error) {
    console.error("communications GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل سجل التواصل" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: clean(body.branch_id) || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة تواصل" }, { status: 403 })

    const channel = clean(body.channel) || "note"
    const direction = clean(body.direction) || "outbound"
    const status = clean(body.status) || "completed"
    const subject = clean(body.subject)
    const communicationBody = clean(body.body)
    const partnerId = clean(body.partner_id) || null
    const branchId = clean(body.branch_id) || scope.activeBranchId || null
    assertBranchScope(scope, branchId)
    if (!CHANNELS.has(channel) || !DIRECTIONS.has(direction) || !STATUSES.has(status)) {
      return NextResponse.json({ error: "بيانات نوع التواصل أو حالته غير صحيحة" }, { status: 422 })
    }
    if (!subject && !communicationBody) return NextResponse.json({ error: "اكتب عنوانًا أو تفاصيل للتواصل" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const partner = partnerId ? await readPartner(db, scope.activePharmacyId, partnerId) : null
    const partnerName = partner?.name ?? (clean(body.partner_name) || "تواصل عام")

    const { data, error } = await db
      .from("pharmacy_partner_communications")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        branch_id: branchId,
        partner_id: partnerId,
        partner_name: partnerName,
        channel,
        direction,
        subject,
        body: communicationBody,
        status,
        occurred_at: clean(body.occurred_at) || new Date().toISOString(),
        created_by: scope.user.id,
      })
      .select("id,pharmacy_id,branch_id,partner_id,partner_name,channel,direction,subject,body,status,occurred_at,created_at,updated_at")
      .single()
    if (error) throw error

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId,
      actorId: scope.user.id,
      eventType: "crm.communication.created",
      source: "crm",
      description: "تمت إضافة سجل تواصل",
      metadata: { communication_id: data.id, partner_id: partnerId, channel, status },
    })
    return NextResponse.json({ communication: data }, { status: 201 })
  } catch (error) {
    console.error("communications POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة سجل التواصل" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const id = clean(body.id)
    if (!id) return NextResponse.json({ error: "معرف سجل التواصل مطلوب" }, { status: 400 })
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل التواصل" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: existing, error: existingError } = await db
      .from("pharmacy_partner_communications")
      .select("id,branch_id")
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("id", id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "سجل التواصل غير موجود" }, { status: 404 })
    assertBranchScope(scope, existing.branch_id)

    const updates: Record<string, unknown> = {}
    if (body.status !== undefined) {
      const status = clean(body.status)
      if (!STATUSES.has(status)) return NextResponse.json({ error: "حالة التواصل غير صحيحة" }, { status: 422 })
      updates.status = status
    }
    if (body.subject !== undefined) updates.subject = clean(body.subject)
    if (body.body !== undefined) updates.body = clean(body.body)
    if (body.channel !== undefined) {
      const channel = clean(body.channel)
      if (!CHANNELS.has(channel)) return NextResponse.json({ error: "قناة التواصل غير صحيحة" }, { status: 422 })
      updates.channel = channel
    }
    if (body.direction !== undefined) {
      const direction = clean(body.direction)
      if (!DIRECTIONS.has(direction)) return NextResponse.json({ error: "اتجاه التواصل غير صحيح" }, { status: 422 })
      updates.direction = direction
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "لا توجد تعديلات" }, { status: 400 })

    const { data, error } = await db
      .from("pharmacy_partner_communications")
      .update(updates)
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("id", id)
      .select("id,pharmacy_id,branch_id,partner_id,partner_name,channel,direction,subject,body,status,occurred_at,created_at,updated_at")
      .single()
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: existing.branch_id,
      actorId: scope.user.id,
      eventType: "crm.communication.updated",
      source: "crm",
      description: "تم تعديل سجل تواصل",
      metadata: { communication_id: id, changed_fields: Object.keys(updates) },
    })
    return NextResponse.json({ communication: data })
  } catch (error) {
    console.error("communications PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل سجل التواصل" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = clean(url.searchParams.get("id"))
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية حذف التواصل" }, { status: 403 })
    if (!id) return NextResponse.json({ error: "معرف سجل التواصل مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const { data: existing, error: existingError } = await db
      .from("pharmacy_partner_communications")
      .select("id,branch_id")
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("id", id)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "سجل التواصل غير موجود" }, { status: 404 })
    assertBranchScope(scope, existing.branch_id)

    const { error } = await db
      .from("pharmacy_partner_communications")
      .delete()
      .eq("pharmacy_id", scope.activePharmacyId)
      .eq("id", id)
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      branchId: existing.branch_id,
      actorId: scope.user.id,
      eventType: "crm.communication.deleted",
      source: "crm",
      description: "تم حذف سجل تواصل",
      metadata: { communication_id: id },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("communications DELETE failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف سجل التواصل" }, { status: 400 })
  }
}
