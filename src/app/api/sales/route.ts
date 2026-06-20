import { NextResponse } from "next/server"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "sales:read",
      forbiddenMessage: "ليست لديك صلاحية عرض المبيعات",
    })
    const { page, pageSize, offset } = context.pagination()
    const query = context.search()
    const paymentStatus = context.text("payment_status")
    const paymentMethod = context.text("payment_method")
    const dateFrom = context.text("date_from")
    const dateTo = context.text("date_to")

    let salesQuery = context.db
      .from("pharmacy_sales")
      .select(
        "id,pharmacy_id,branch_id,invoice_number,customer_name,status,payment_status,payment_method,subtotal,discount_total,tax_total,total,paid_amount,due_amount,sale_date,created_by,voided_at",
        { count: "exact" },
      )
      .eq("pharmacy_id", context.pharmacyId)
      .is("voided_at", null)
      .order("sale_date", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (context.branchId) salesQuery = salesQuery.eq("branch_id", context.branchId)
    if (query) salesQuery = salesQuery.or(`invoice_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
    if (paymentStatus && paymentStatus !== "all") salesQuery = salesQuery.eq("payment_status", paymentStatus)
    if (paymentMethod && paymentMethod !== "all") salesQuery = salesQuery.eq("payment_method", paymentMethod)
    if (dateFrom) salesQuery = salesQuery.gte("sale_date", `${dateFrom}T00:00:00`)
    if (dateTo) salesQuery = salesQuery.lte("sale_date", `${dateTo}T23:59:59.999`)

    const { data, error, count } = await salesQuery
    if (error) throw error

    const relations = new OperationalRelationsRepository(context.db, context.pharmacyId)
    const rows = await relations.attachBranches(data ?? [])
    const summary = rows.reduce(
      (total, row) => ({
        total: total.total + Number(row.total ?? 0),
        paid: total.paid + Number(row.paid_amount ?? 0),
        due: total.due + Number(row.due_amount ?? 0),
      }),
      { total: 0, paid: 0, due: 0 },
    )

    return NextResponse.json({
      sales: rows,
      summary: { count: count ?? rows.length, ...summary },
      pagination: {
        page,
        pageSize,
        total: count ?? rows.length,
        totalPages: Math.max(1, Math.ceil((count ?? rows.length) / pageSize)),
      },
      branchId: context.branchId,
      pharmacyId: context.pharmacyId,
    })
  } catch (error) {
    return operationalErrorResponse(error, "sales GET failed", "فشل تحميل المبيعات")
  }
}
