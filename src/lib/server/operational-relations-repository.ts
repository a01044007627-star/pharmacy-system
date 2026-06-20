import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

type BranchShape = { id: string; name: string; code?: string | null }
type SaleShape = { id: string; invoice_number: string }
type BatchShape = { id: string; batch_number?: string | null; expiry_date?: string | null }

type BranchScopedRow = { branch_id?: string | null }
type SaleScopedRow = { sale_id?: string | null }
type BatchScopedRow = { batch_id?: string | null }

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

export class OperationalRelationsRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {}

  async attachBranches<T extends BranchScopedRow>(rows: T[]): Promise<Array<T & { branch: BranchShape | null }>> {
    const ids = uniqueIds(rows.map((row) => row.branch_id))
    if (ids.length === 0) return rows.map((row) => ({ ...row, branch: null }))

    const { data, error } = await this.db
      .from("pharmacy_branches")
      .select("id,name,code")
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", ids)
    if (error) {
      this.warn("branches lookup", error)
      return rows.map((row) => ({ ...row, branch: null }))
    }

    const map = new Map((data ?? []).map((branch) => [branch.id as string, branch as BranchShape]))
    return rows.map((row) => ({ ...row, branch: row.branch_id ? map.get(row.branch_id) ?? null : null }))
  }

  async attachSales<T extends SaleScopedRow>(rows: T[]): Promise<Array<T & { sale: SaleShape | null }>> {
    const ids = uniqueIds(rows.map((row) => row.sale_id))
    if (ids.length === 0) return rows.map((row) => ({ ...row, sale: null }))

    const { data, error } = await this.db
      .from("pharmacy_sales")
      .select("id,invoice_number")
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", ids)
    if (error) {
      this.warn("sales lookup", error)
      return rows.map((row) => ({ ...row, sale: null }))
    }

    const map = new Map((data ?? []).map((sale) => [sale.id as string, sale as SaleShape]))
    return rows.map((row) => ({ ...row, sale: row.sale_id ? map.get(row.sale_id) ?? null : null }))
  }

  async attachBatches<T extends BatchScopedRow>(rows: T[]): Promise<Array<T & { batch: BatchShape | null }>> {
    const ids = uniqueIds(rows.map((row) => row.batch_id))
    if (ids.length === 0) return rows.map((row) => ({ ...row, batch: null }))

    const { data, error } = await this.db
      .from("pharmacy_item_batches")
      .select("id,batch_number,expiry_date")
      .eq("pharmacy_id", this.pharmacyId)
      .in("id", ids)
    if (error) {
      this.warn("batches lookup", error)
      return rows.map((row) => ({ ...row, batch: null }))
    }

    const map = new Map((data ?? []).map((batch) => [batch.id as string, batch as BatchShape]))
    return rows.map((row) => ({ ...row, batch: row.batch_id ? map.get(row.batch_id) ?? null : null }))
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

    const lines = rawLines as unknown as Array<{ return_id: string; quantity: number | null; [key: string]: any }> | null

    const returnIds = uniqueIds((lines ?? []).map((row) => row.return_id as string | null))
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
      if (!activeIds.has(row.return_id as string)) continue
      const lineId = row[params.lineIdColumn] as string | null
      if (!lineId) continue
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
