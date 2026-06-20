import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

type BranchShape = { id: string; name: string; code?: string | null }
type SaleShape = { id: string; invoice_number: string }
type BatchShape = { id: string; batch_number?: string | null; expiry_date?: string | null }
type ItemShape = { id: string; name_ar: string; sku?: string | null; unit?: string | null }
type EmployeeShape = { id: string; name: string; position?: string | null }
type PartnerShape = { id: string; phone?: string | null; address?: string | null }
type AddressShape = {
  id: string
  address: string
  city?: string | null
  state?: string | null
  phone?: string | null
  label?: string | null
}

type BranchScopedRow = { branch_id?: string | null }
type SaleScopedRow = { sale_id?: string | null }
type BatchScopedRow = { batch_id?: string | null }
type ItemScopedRow = { item_id?: string | null }
type EmployeeScopedRow = { employee_id?: string | null }
type CustomerScopedRow = { customer_id?: string | null }
type AddressScopedRow = { shipping_address_id?: string | null }

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

export class OperationalRelationsRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {}

  async attachBranches<T extends BranchScopedRow>(rows: T[]): Promise<Array<T & { branch: BranchShape | null }>> {
    const map = await this.loadMap<BranchShape>(
      "pharmacy_branches",
      "id,name,code",
      uniqueIds(rows.map((row) => row.branch_id)),
      "branches lookup",
    )
    return rows.map((row) => ({ ...row, branch: row.branch_id ? map.get(row.branch_id) ?? null : null }))
  }

  async attachItems<T extends ItemScopedRow>(rows: T[]): Promise<Array<T & { item: ItemShape | null }>> {
    const map = await this.loadMap<ItemShape>(
      "pharmacy_items",
      "id,name_ar,sku,unit",
      uniqueIds(rows.map((row) => row.item_id)),
      "items lookup",
    )
    return rows.map((row) => ({ ...row, item: row.item_id ? map.get(row.item_id) ?? null : null }))
  }

  async attachEmployees<T extends EmployeeScopedRow>(rows: T[]): Promise<Array<T & { employee: EmployeeShape | null }>> {
    const map = await this.loadMap<EmployeeShape>(
      "pharmacy_employees",
      "id,name,position",
      uniqueIds(rows.map((row) => row.employee_id)),
      "employees lookup",
    )
    return rows.map((row) => ({ ...row, employee: row.employee_id ? map.get(row.employee_id) ?? null : null }))
  }

  async attachCustomers<T extends CustomerScopedRow>(rows: T[]): Promise<Array<T & { customer: PartnerShape | null }>> {
    const map = await this.loadMap<PartnerShape>(
      "pharmacy_partners",
      "id,phone,address",
      uniqueIds(rows.map((row) => row.customer_id)),
      "customers lookup",
    )
    return rows.map((row) => ({ ...row, customer: row.customer_id ? map.get(row.customer_id) ?? null : null }))
  }

  async attachShippingAddresses<T extends AddressScopedRow>(rows: T[]): Promise<Array<T & { shipping_address: AddressShape | null }>> {
    const map = await this.loadMap<AddressShape>(
      "pharmacy_customer_addresses",
      "id,address,city,state,phone,label",
      uniqueIds(rows.map((row) => row.shipping_address_id)),
      "shipping addresses lookup",
    )
    return rows.map((row) => ({
      ...row,
      shipping_address: row.shipping_address_id ? map.get(row.shipping_address_id) ?? null : null,
    }))
  }

  async attachSales<T extends SaleScopedRow>(rows: T[]): Promise<Array<T & { sale: SaleShape | null }>> {
    const map = await this.loadMap<SaleShape>(
      "pharmacy_sales",
      "id,invoice_number",
      uniqueIds(rows.map((row) => row.sale_id)),
      "sales lookup",
    )
    return rows.map((row) => ({ ...row, sale: row.sale_id ? map.get(row.sale_id) ?? null : null }))
  }

  async attachBatches<T extends BatchScopedRow>(rows: T[]): Promise<Array<T & { batch: BatchShape | null }>> {
    const map = await this.loadMap<BatchShape>(
      "pharmacy_item_batches",
      "id,batch_number,expiry_date",
      uniqueIds(rows.map((row) => row.batch_id)),
      "batches lookup",
    )
    return rows.map((row) => ({ ...row, batch: row.batch_id ? map.get(row.batch_id) ?? null : null }))
  }

  async attachInventoryRelations<T extends ItemScopedRow & BranchScopedRow>(rows: T[]) {
    const withItems = await this.attachItems(rows)
    return this.attachBranches(withItems)
  }

  async activeSalesReturnQuantities(saleLineIds: string[]) {
    return this.activeReturnQuantities({
      lineTable: "pharmacy_sales_return_lines",
      headerTable: "pharmacy_sales_returns",
      lineIdColumn: "sale_line_id",
      lineIds: saleLineIds,
    })
  }

  async activePurchaseReturnQuantities(purchaseLineIds: string[]) {
    return this.activeReturnQuantities({
      lineTable: "pharmacy_purchase_return_lines",
      headerTable: "pharmacy_purchase_returns",
      lineIdColumn: "purchase_line_id",
      lineIds: purchaseLineIds,
    })
  }

  private async loadMap<T extends { id: string }>(
    table: string,
    columns: string,
    ids: string[],
    operation: string,
  ): Promise<Map<string, T>> {
    if (ids.length === 0) return new Map<string, T>()

    const { data, error } = await this.db
      .from(table)
      .select(columns)
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", ids)

    if (error) {
      this.warn(operation, error)
      return new Map<string, T>()
    }

    return new Map(((data ?? []) as unknown as T[]).map((row) => [row.id, row]))
  }

  private async activeReturnQuantities(params: {
    lineTable: string
    headerTable: string
    lineIdColumn: string
    lineIds: string[]
  }) {
    if (params.lineIds.length === 0) return new Map<string, number>()

    const { data: rawLines, error: linesError } = await this.db
      .from(params.lineTable)
      .select(`return_id,${params.lineIdColumn},quantity`)
      .eq("pharmacy_id", this.pharmacyId)
      .in(params.lineIdColumn, params.lineIds)
    if (linesError) throw linesError

    const lines = rawLines as unknown as Array<{ return_id: string; quantity: number | null; [key: string]: unknown }> | null
    const returnIds = uniqueIds((lines ?? []).map((row) => row.return_id))
    if (returnIds.length === 0) return new Map<string, number>()

    const { data: activeHeaders, error: headersError } = await this.db
      .from(params.headerTable)
      .select("id")
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", returnIds)
      .is("voided_at", null)
    if (headersError) throw headersError

    const activeIds = new Set((activeHeaders ?? []).map((row) => row.id as string))
    const totals = new Map<string, number>()
    for (const row of lines ?? []) {
      if (!activeIds.has(row.return_id)) continue
      const lineId = row[params.lineIdColumn]
      if (typeof lineId !== "string" || !lineId) continue
      totals.set(lineId, (totals.get(lineId) ?? 0) + Number(row.quantity ?? 0))
    }
    return totals
  }

  private warn(operation: string, error: { message?: string } | unknown) {
    const message = error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error)
    console.warn(`[OperationalRelationsRepository] ${operation} failed`, message)
  }
}
