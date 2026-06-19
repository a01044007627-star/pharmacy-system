import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

function applyPartnerTypeFilter<T>(query: T, partnerType: string | null): T {
  const builder = query as any
  if (partnerType === "customer") return builder.in("type", ["customer", "both"]) as T
  if (partnerType === "supplier") return builder.in("type", ["supplier", "both"]) as T
  if (partnerType === "both") return builder.eq("type", "both") as T
  return query
}

function applyPartnerFilters<T>(query: T, filters: { partnerType: string | null; status: string; search: string }): T {
  let builder = applyPartnerTypeFilter(query, filters.partnerType) as any
  if (filters.status && filters.status !== "all") builder = builder.eq("status", filters.status)
  if (filters.search) builder = builder.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%,tax_id.ilike.%${filters.search}%`)
  return builder as T
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const filters = {
      partnerType: clean(url.searchParams.get("type")) || null,
      status: clean(url.searchParams.get("status")),
      search: safeSearch(clean(url.searchParams.get("query"))),
    }
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 250)
    const offset = (page - 1) * pageSize

    let listQuery = db
      .from("pharmacy_partners")
      .select("id,pharmacy_id,type,name,phone,email,address,tax_id,opening_balance,balance,credit_limit,notes,status,created_at,updated_at", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("name")
      .range(offset, offset + pageSize - 1)
    listQuery = applyPartnerFilters(listQuery, filters)

    let summaryQuery = db
      .from("pharmacy_partners")
      .select("id,type,status,balance,credit_limit,opening_balance", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .limit(50000)
    summaryQuery = applyPartnerFilters(summaryQuery, filters)

    const [{ data, error, count }, { data: summaryRows, error: summaryError, count: summaryCount }] = await Promise.all([listQuery, summaryQuery])
    if (error) throw error
    if (summaryError) throw summaryError

    const summarySource = summaryRows ?? []
    const summary = {
      total: summaryCount ?? count ?? summarySource.length,
      count: summaryCount ?? count ?? summarySource.length,
      active: summarySource.filter((r) => r.status === "active").length,
      inactive: summarySource.filter((r) => r.status !== "active").length,
      totalBalance: summarySource.reduce((acc, r) => acc + Number(r.balance ?? 0), 0),
      openingBalance: summarySource.reduce((acc, r) => acc + Number(r.opening_balance ?? 0), 0),
      creditLimit: summarySource.reduce((acc, r) => acc + Number(r.credit_limit ?? 0), 0),
    }

    return NextResponse.json({
      partners: data ?? [],
      summary,
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("partners GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل جهات الاتصال"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية إضافة جهات اتصال" }, { status: 403 })

    const name = clean(body.name)
    if (!name) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 })

    const type = clean(body.type)
    if (!["customer", "supplier", "both"].includes(type)) {
      return NextResponse.json({ error: "نوع جهة الاتصال غير صالح" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const openingBalance = Math.max(0, Number(body.opening_balance) || 0)

    const { data, error } = await db
      .from("pharmacy_partners")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        type,
        name,
        phone: clean(body.phone) || null,
        email: clean(body.email) || null,
        address: clean(body.address) || null,
        tax_id: clean(body.tax_id) || null,
        opening_balance: openingBalance,
        balance: openingBalance,
        credit_limit: Math.max(0, Number(body.credit_limit) || 0),
        notes: clean(body.notes) || null,
        status: ["active", "inactive"].includes(clean(body.status)) ? clean(body.status) : "active",
      })
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "فشل إنشاء جهة الاتصال" }, { status: 500 })
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "partner.created",
      source: "partners",
      description: "تم إنشاء جهة اتصال جديدة",
      metadata: { partner_id: data.id, name: data.name, type: data.type, opening_balance: data.opening_balance },
    })

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("partners POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const ids = Array.isArray(body.ids) ? body.ids.map(clean).filter(Boolean) : []
    const partnerId = clean(body.id) || ids[0]
    if (!partnerId && ids.length === 0) return NextResponse.json({ error: "معرف جهة الاتصال مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    if (ids.length > 0 && ["activate", "deactivate"].includes(clean(body.action))) {
      const status = clean(body.action) === "activate" ? "active" : "inactive"
      const { data, error } = await db
        .from("pharmacy_partners")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("pharmacy_id", scope.activePharmacyId)
        .in("id", ids)
        .select("id,name,type,status")
      if (error) throw error
      await writeAuditLog(db, {
        pharmacyId: scope.activePharmacyId,
        actorId: scope.user.id,
        eventType: `partner.bulk_${status}`,
        source: "partners",
        description: "تم تنفيذ إجراء متعدد على جهات الاتصال",
        metadata: { ids, status },
      })
      return NextResponse.json({ partners: data ?? [], count: data?.length ?? 0 })
    }

    const allowedFields = ["name", "phone", "email", "address", "tax_id", "credit_limit", "notes", "status"]
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === "credit_limit") updates[field] = Math.max(0, Number(body[field]) || 0)
        else updates[field] = clean(body[field]) || null
      }
    }
    if (body.type && ["customer", "supplier", "both"].includes(clean(body.type))) {
      updates.type = clean(body.type)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 })
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await db
      .from("pharmacy_partners")
      .update(updates)
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "جهة الاتصال غير موجودة" }, { status: 404 })
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "partner.updated",
      source: "partners",
      description: "تم تعديل جهة اتصال",
      metadata: { partner_id: data.id, name: data.name, type: data.type, fields: Object.keys(updates).filter((key) => key !== "updated_at") },
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error("partners PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const partnerId = url.searchParams.get("id")
    if (!partnerId) return NextResponse.json({ error: "معرف جهة الاتصال مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "crm:write")) return NextResponse.json({ error: "ليست لديك صلاحية حذف جهات الاتصال" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient

    const { error } = await db
      .from("pharmacy_partners")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("id", partnerId)
      .eq("pharmacy_id", scope.activePharmacyId)

    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "partner.deactivated",
      source: "partners",
      description: "تم تعطيل جهة اتصال",
      metadata: { partner_id: partnerId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("partners DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل حذف جهة الاتصال"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
