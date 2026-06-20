import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { InventoryReadRepository } from "@/lib/server/inventory-read-repository"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function n(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      anyPermissions: ["inventory:read", "inventory:stocktake"],
      forbiddenMessage: "ليست لديك صلاحية عرض الجرد",
    })
    const pagination = context.pagination()
    const repository = new InventoryReadRepository(context.db, context.pharmacyId)
    const { rows, count } = await repository.listStockCounts({
      branchId: context.branchId,
      search: context.text("query"),
      status: context.text("status"),
      pagination,
    })

    const summary = rows.reduce(
      (acc, row) => ({
        total_count: acc.total_count + 1,
        total_expected: acc.total_expected + Number(row.expected_qty ?? 0),
        total_counted: acc.total_counted + Number(row.counted_qty ?? 0),
        total_variance: acc.total_variance + Number(row.variance ?? 0),
      }),
      { total_count: 0, total_expected: 0, total_counted: 0, total_variance: 0 },
    )

    return NextResponse.json({
      records: rows,
      summary: { ...summary, total_count: count },
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / pagination.pageSize)),
      },
    })
  } catch (error) {
    return operationalErrorResponse(error, "stock-counts GET failed", "فشل تحميل الجرد")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const branchId = clean(body.branch_id)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: branchId || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:stocktake")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const itemId = clean(body.item_id)
    if (!itemId) return NextResponse.json({ error: "اختر الصنف" }, { status: 400 })
    const effectiveBranchId = branchId || scope.activeBranchId
    if (!effectiveBranchId) return NextResponse.json({ error: "اختر الفرع قبل تسجيل الجرد" }, { status: 400 })
    assertBranchScope(scope, effectiveBranchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()

    const { data: item, error: itemError } = await db
      .from("pharmacy_items")
      .select("id,name_ar,unit")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", itemId)
      .neq("status", "deleted")
      .maybeSingle()
    if (itemError) throw itemError
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    let expectedQty = n(body.expected_qty, Number.NaN)
    if (!Number.isFinite(expectedQty) || body.auto_expected === true) {
      const { data: balance, error: balanceError } = await db
        .from("pharmacy_stock_balances")
        .select("quantity")
        .eq("pharmacy_id", pharmacyId)
        .eq("branch_id", effectiveBranchId)
        .eq("item_id", itemId)
        .maybeSingle()
      if (balanceError) throw balanceError
      expectedQty = Number(balance?.quantity ?? 0)
    }

    const countedQty = Math.max(0, n(body.counted_qty, 0))
    const variance = countedQty - expectedQty
    const { data, error } = await db
      .from("pharmacy_stock_counts")
      .insert({
        pharmacy_id: pharmacyId,
        branch_id: effectiveBranchId,
        item_id: itemId,
        expected_qty: expectedQty,
        counted_qty: countedQty,
        variance,
        unit: clean(body.unit) || item.unit || null,
        notes: clean(body.notes) || null,
        status: "posted",
        created_by: scope.user.id,
        created_at: now,
        updated_at: now,
      })
      .select("id,pharmacy_id,item_id,branch_id,expected_qty,counted_qty,variance,unit,notes,status,created_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "تعذر إنشاء سجل الجرد" }, { status: 500 })

    const relations = new OperationalRelationsRepository(db, pharmacyId)
    const [record] = await relations.attachInventoryRelations([data])
    await writeAuditLog(db, {
      pharmacyId,
      branchId: effectiveBranchId,
      actorId: scope.user.id,
      eventType: "stock_count.created",
      source: "inventory",
      description: "تم تسجيل جرد مخزون",
      metadata: { count_id: data.id, item_id: itemId, expected_qty: expectedQty, counted_qty: countedQty, variance },
    })
    return NextResponse.json({ record }, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "stock-counts POST failed", "فشل تسجيل الجرد", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== "approve") return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })

    const countId = clean(body.count_id)
    if (!countId) return NextResponse.json({ error: "معرف الجرد مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:stocktake")) return NextResponse.json({ error: "ليست لديك صلاحية اعتماد الجرد" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const { data: existing, error: existingError } = await db
      .from("pharmacy_stock_counts")
      .select("id,branch_id,item_id,status")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", countId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "سجل الجرد غير موجود" }, { status: 404 })
    assertBranchScope(scope, String(existing.branch_id ?? ""))

    const { data, error } = await db.rpc("approve_stock_count_variance", {
      p_pharmacy_id: pharmacyId,
      p_count_id: countId,
      p_actor_id: scope.user.id,
      p_notes: clean(body.notes) || null,
    })
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId,
      branchId: String(existing.branch_id ?? ""),
      actorId: scope.user.id,
      eventType: "stock_count.approved",
      source: "inventory",
      description: "تم اعتماد جرد وتسوية المخزون",
      metadata: { count_id: countId, item_id: existing.item_id, result: data },
    })
    return NextResponse.json(data ?? { ok: true })
  } catch (error) {
    return operationalErrorResponse(error, "stock-counts PATCH failed", "فشل اعتماد الجرد", 400)
  }
}
