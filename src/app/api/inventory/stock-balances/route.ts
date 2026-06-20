import { NextResponse } from "next/server"
import { InventoryReadRepository } from "@/lib/server/inventory-read-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "inventory:read",
      forbiddenMessage: "ليست لديك صلاحية عرض الأرصدة",
    })
    const pagination = context.pagination(200, 500)
    const repository = new InventoryReadRepository(context.db, context.pharmacyId)
    const { rows, count } = await repository.listBalances({
      branchId: context.branchId,
      search: context.search(),
      pagination,
    })

    const summary = {
      total_items: count,
      total_quantity: rows.reduce((total, row) => total + Number(row.quantity ?? 0), 0),
      out_of_stock: rows.filter((row) => Number(row.quantity ?? 0) <= 0).length,
    }

    return NextResponse.json({
      records: rows,
      summary,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / pagination.pageSize)),
      },
    })
  } catch (error) {
    return operationalErrorResponse(error, "stock-balances GET failed", "فشل تحميل الأرصدة")
  }
}
