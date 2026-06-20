import { NextResponse } from "next/server"
import { unitPolicyService } from "@/domain/inventory/units/unit-policy"
import {
  isEnumValue,
  StockCountStatus,
  stockCountWorkflow,
} from "@/domain/workflows/operational-workflows"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { InventoryReadRepository } from "@/lib/server/inventory-read-repository"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function actionTarget(action: unknown) {
  if (action === "post") return StockCountStatus.Posted
  if (action === "approve") return StockCountStatus.Approved
  if (action === "cancel") return StockCountStatus.Cancelled
  throw new Error("الإجراء غير مدعوم")
}

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      anyPermissions: ["inventory:read", "inventory:stocktake"],
      forbiddenMessage: "ليست لديك صلاحية عرض الجرد",
    })
    const pagination = context.pagination()
    const status = context.text("status")
    if (status && status !== "all" && !isEnumValue(StockCountStatus, status)) {
      throw new Error("حالة الجرد غير صالحة")
    }

    const repository = new InventoryReadRepository(context.db, context.pharmacyId)
    const { rows, count } = await repository.listStockCounts({
      branchId: context.branchId,
      search: context.text("query"),
      status,
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
      statuses: stockCountWorkflow.values(),
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
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "inventory:stocktake",
      forbiddenMessage: "ليست لديك صلاحية تسجيل الجرد",
    })
    const itemId = clean(body.item_id)
    if (!itemId) throw new Error("اختر الصنف")
    if (!context.branchId) throw new Error("اختر الفرع قبل تسجيل الجرد")

    const { data: item, error: itemError } = await context.db
      .from("pharmacy_items")
      .select("id,name_ar,unit")
      .eq("pharmacy_id", context.pharmacyId)
      .eq("id", itemId)
      .neq("status", "deleted")
      .maybeSingle()
    if (itemError) throw itemError
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    const unitName = clean(body.unit) || item.unit || "وحدة"
    const policy = unitPolicyService.policyFor({ unit_name: unitName })

    let expectedQty: number
    if (body.auto_expected === true || body.expected_qty === null || body.expected_qty === undefined || body.expected_qty === "") {
      const { data: balance, error: balanceError } = await context.db
        .from("pharmacy_stock_balances")
        .select("quantity")
        .eq("pharmacy_id", context.pharmacyId)
        .eq("branch_id", context.branchId)
        .eq("item_id", itemId)
        .maybeSingle()
      if (balanceError) throw balanceError
      expectedQty = policy.assertValid(balance?.quantity ?? 0, "الرصيد الدفتري")
    } else {
      expectedQty = policy.assertValid(body.expected_qty, "الرصيد الدفتري")
    }
    const countedQty = policy.assertValid(body.counted_qty, "الكمية الفعلية")
    if (expectedQty < 0 || countedQty < 0) throw new Error("كميات الجرد لا يمكن أن تكون سالبة")

    const variance = policy.normalize(countedQty - expectedQty)
    const now = new Date().toISOString()
    const status = body.save_as_draft === true ? StockCountStatus.Draft : StockCountStatus.Posted
    const { data, error } = await context.db
      .from("pharmacy_stock_counts")
      .insert({
        pharmacy_id: context.pharmacyId,
        branch_id: context.branchId,
        item_id: itemId,
        expected_qty: expectedQty,
        counted_qty: countedQty,
        variance,
        unit: unitName,
        notes: clean(body.notes) || null,
        status,
        created_by: context.actorId,
        created_at: now,
        updated_at: now,
      })
      .select("id,pharmacy_id,item_id,branch_id,expected_qty,counted_qty,variance,unit,notes,status,created_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error("تعذر إنشاء سجل الجرد")

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const [record] = await relations.attachInventoryRelations([data])
    await writeAuditLog(context.db, {
      pharmacyId: context.pharmacyId,
      branchId: context.branchId,
      actorId: context.actorId,
      eventType: "stock_count.created",
      source: "inventory",
      description: status === StockCountStatus.Draft ? "تم حفظ مسودة جرد" : "تم تسجيل جرد مخزون",
      metadata: { count_id: data.id, item_id: itemId, expected_qty: expectedQty, counted_qty: countedQty, variance, status },
    })
    return NextResponse.json({ record }, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "stock-counts POST failed", "فشل تسجيل الجرد", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "inventory:stocktake",
      forbiddenMessage: "ليست لديك صلاحية تحديث الجرد",
    })
    const countId = clean(body.count_id)
    if (!countId) throw new Error("معرف الجرد مطلوب")
    const target = actionTarget(body.action)

    const { data: existing, error: existingError } = await context.db
      .from("pharmacy_stock_counts")
      .select("id,branch_id,item_id,status")
      .eq("pharmacy_id", context.pharmacyId)
      .eq("id", countId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "سجل الجرد غير موجود" }, { status: 404 })
    if (!isEnumValue(StockCountStatus, existing.status)) throw new Error("حالة الجرد الحالية غير معروفة")
    stockCountWorkflow.assertTransition(existing.status, target)

    let result: unknown
    if (target === StockCountStatus.Approved) {
      const { data, error } = await context.db.rpc("approve_stock_count_variance", {
        p_pharmacy_id: context.pharmacyId,
        p_count_id: countId,
        p_actor_id: context.actorId,
        p_notes: clean(body.notes) || null,
      })
      if (error) throw error
      result = data ?? { ok: true }
    } else {
      const updatePayload: Record<string, unknown> = {
        status: target,
        updated_at: new Date().toISOString(),
      }
      if (Object.prototype.hasOwnProperty.call(body, "notes")) {
        updatePayload.notes = clean(body.notes) || null
      }
      const { data, error } = await context.db
        .from("pharmacy_stock_counts")
        .update(updatePayload)
        .eq("pharmacy_id", context.pharmacyId)
        .eq("id", countId)
        .select("id,status,updated_at")
        .maybeSingle()
      if (error) throw error
      result = data
    }

    await writeAuditLog(context.db, {
      pharmacyId: context.pharmacyId,
      branchId: String(existing.branch_id ?? ""),
      actorId: context.actorId,
      eventType: `stock_count.${target}`,
      source: "inventory",
      description: target === StockCountStatus.Approved
        ? "تم اعتماد الجرد وتسوية المخزون"
        : target === StockCountStatus.Cancelled
          ? "تم إلغاء الجرد"
          : "تم ترحيل مسودة الجرد",
      metadata: { count_id: countId, item_id: existing.item_id, result },
    })
    return NextResponse.json({ result })
  } catch (error) {
    return operationalErrorResponse(error, "stock-counts PATCH failed", "فشل تحديث الجرد", 400)
  }
}
