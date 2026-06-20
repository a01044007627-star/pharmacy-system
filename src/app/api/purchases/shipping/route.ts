import { NextResponse } from "next/server"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "purchases:read",
      forbiddenMessage: "ليست لديك صلاحية عرض تكاليف الشحن",
    })
    const { page, pageSize, offset } = context.pagination()

    let query = context.db
      .from("pharmacy_purchases")
      .select("id,branch_id,purchase_number,supplier_name,total,shipping_fee,purchase_date,status", { count: "exact" })
      .eq("pharmacy_id", context.pharmacyId)
      .gt("shipping_fee", 0)
      .is("voided_at", null)
      .order("purchase_date", { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (context.branchId) query = query.eq("branch_id", context.branchId)

    const { data, error, count } = await query
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const rows = await relations.attachBranches(data ?? [])
    const summary = rows.reduce((acc, row) => ({
      total_shipping: acc.total_shipping + Number(row.shipping_fee ?? 0),
      total_purchases: acc.total_purchases + Number(row.total ?? 0),
    }), { total_shipping: 0, total_purchases: 0 })

    return NextResponse.json({
      shipping: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    return operationalErrorResponse(error, "purchase shipping GET failed", "فشل تحميل تكاليف الشحن")
  }
}

