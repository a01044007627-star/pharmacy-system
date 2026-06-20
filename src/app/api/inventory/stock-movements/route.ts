import { NextResponse } from "next/server"
import { InventoryReadRepository } from "@/lib/server/inventory-read-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "inventory:read",
      forbiddenMessage: "ليست لديك صلاحية عرض حركة المخزون",
    })
    const pagination = context.pagination(50, 200)
    const repository = new InventoryReadRepository(context.db, context.pharmacyId)
    const { rows, count, summaryRows } = await repository.listMovements({
      branchId: context.branchId,
      movementType: normalizeFilter(context.text("movement_type")),
      direction: normalizeFilter(context.text("direction")),
      itemId: context.text("item_id"),
      sourceTable: normalizeFilter(context.text("source_table")),
      dateFrom: context.text("date_from"),
      dateTo: context.text("date_to"),
      search: context.search(),
      pagination,
    })

    const totalIn = summaryRows
      .filter((row) => row.direction === "in")
      .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
    const totalOut = summaryRows
      .filter((row) => row.direction === "out")
      .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)

    return NextResponse.json({
      records: rows,
      summary: {
        total_movements: count,
        total_in: totalIn,
        total_out: totalOut,
        net_quantity: totalIn - totalOut,
        total_value_in: summaryRows
          .filter((row) => row.direction === "in")
          .reduce((sum, row) => sum + Number(row.total_value ?? 0), 0),
        total_value_out: summaryRows
          .filter((row) => row.direction === "out")
          .reduce((sum, row) => sum + Number(row.total_value ?? 0), 0),
      },
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / pagination.pageSize)),
      },
    })
  } catch (error) {
    return operationalErrorResponse(error, "stock-movements GET failed", "فشل تحميل حركة المخزون")
  }
}

function normalizeFilter(value: string) {
  return value === "all" ? "" : value
}
