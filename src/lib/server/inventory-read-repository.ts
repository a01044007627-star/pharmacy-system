import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"

export type InventoryPagination = {
  page: number
  pageSize: number
  offset: number
}

export type StockMovementFilters = {
  branchId: string | null
  movementType: string
  direction: string
  itemId: string
  sourceTable: string
  dateFrom: string
  dateTo: string
  search: string
}

export class InventoryReadRepository {
  private readonly relations: OperationalRelationsRepository

  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {
    this.relations = new OperationalRelationsRepository(db, pharmacyId)
  }

  async searchItemIds(rawQuery: string, limit = 200) {
    const query = this.safeSearch(rawQuery)
    if (!query) return [] as string[]

    const barcodeQuery = rawQuery.replace(/[% ,().]/g, "").trim()
    const [itemsResult, barcodesResult] = await Promise.all([
      this.db
        .from("pharmacy_items")
        .select("id")
        .eq("pharmacy_id", this.pharmacyId)
        .neq("status", "deleted")
        .or(`name_ar.ilike.%${query}%,name_en.ilike.%${query}%,sku.ilike.%${query}%,search_text.ilike.%${query}%`)
        .limit(limit),
      barcodeQuery
        ? this.db
            .from("pharmacy_item_barcodes")
            .select("item_id")
            .eq("pharmacy_id", this.pharmacyId)
            .ilike("barcode", `%${barcodeQuery}%`)
            .limit(limit)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (itemsResult.error) throw itemsResult.error
    if (barcodesResult.error) throw barcodesResult.error

    const ids = [
      ...((itemsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id),
      ...((barcodesResult.data ?? []) as Array<{ item_id: string }>).map((row) => row.item_id),
    ]
    return Array.from(new Set(ids.filter(Boolean)))
  }

  async listBalances(params: {
    branchId: string | null
    search: string
    pagination: InventoryPagination
  }) {
    const itemIds = params.search ? await this.searchItemIds(params.search, 500) : []
    if (params.search && itemIds.length === 0) {
      return { rows: [], count: 0 }
    }

    let query = this.db
      .from("pharmacy_stock_balances")
      .select("pharmacy_id,item_id,branch_id,quantity,updated_at", { count: "exact" })
      .eq("pharmacy_id", this.pharmacyId)
      .order("quantity", { ascending: false })

    if (params.branchId) query = query.eq("branch_id", params.branchId)
    if (itemIds.length > 0) query = query.in("item_id", itemIds)

    const { data, error, count } = await query.range(
      params.pagination.offset,
      params.pagination.offset + params.pagination.pageSize - 1,
    )
    if (error) throw error

    const rows = await this.relations.attachInventoryRelations(data ?? [])
    return { rows, count: count ?? rows.length }
  }

  async listStockCounts(params: {
    branchId: string | null
    search: string
    status: string
    pagination: InventoryPagination
  }) {
    const itemIds = params.search ? await this.searchItemIds(params.search, 200) : []
    if (params.search && itemIds.length === 0) {
      return { rows: [], count: 0 }
    }

    let query = this.db
      .from("pharmacy_stock_counts")
      .select(
        "id,pharmacy_id,item_id,branch_id,expected_qty,counted_qty,variance,unit,notes,status,created_by,created_at,updated_at",
        { count: "exact" },
      )
      .eq("pharmacy_id", this.pharmacyId)
      .order("created_at", { ascending: false })

    if (params.branchId) query = query.eq("branch_id", params.branchId)
    if (itemIds.length > 0) query = query.in("item_id", itemIds)

    if (params.status === "matched") {
      query = query.in("status", ["posted", "matched"]).eq("variance", 0)
    } else if (params.status === "variance") {
      query = query.in("status", ["posted", "variance"]).neq("variance", 0)
    } else if (params.status && params.status !== "all") {
      query = query.eq("status", params.status)
    }

    const { data, error, count } = await query.range(
      params.pagination.offset,
      params.pagination.offset + params.pagination.pageSize - 1,
    )
    if (error) throw error

    const rows = await this.relations.attachInventoryRelations(data ?? [])
    return { rows, count: count ?? rows.length }
  }

  async listMovements(params: StockMovementFilters & { pagination: InventoryPagination }) {
    const itemIds = params.search ? await this.searchItemIds(params.search, 300) : []
    if (params.search && itemIds.length === 0) {
      return { rows: [], count: 0, summaryRows: [] }
    }

    let rowsQuery = this.db
      .from("pharmacy_stock_movements")
      .select(
        "id,pharmacy_id,item_id,batch_id,branch_id,direction,quantity,unit_price,total_value,movement_type,source_table,source_id,created_by,created_at",
        { count: "exact" },
      )
      .eq("pharmacy_id", this.pharmacyId)

    let summaryQuery = this.db
      .from("pharmacy_stock_movements")
      .select("direction,quantity,total_value", { count: "exact" })
      .eq("pharmacy_id", this.pharmacyId)

    if (params.branchId) {
      rowsQuery = rowsQuery.eq("branch_id", params.branchId)
      summaryQuery = summaryQuery.eq("branch_id", params.branchId)
    }
    if (params.movementType) {
      rowsQuery = rowsQuery.eq("movement_type", params.movementType)
      summaryQuery = summaryQuery.eq("movement_type", params.movementType)
    }
    if (params.direction) {
      rowsQuery = rowsQuery.eq("direction", params.direction)
      summaryQuery = summaryQuery.eq("direction", params.direction)
    }
    if (params.itemId) {
      rowsQuery = rowsQuery.eq("item_id", params.itemId)
      summaryQuery = summaryQuery.eq("item_id", params.itemId)
    }
    if (itemIds.length > 0) {
      rowsQuery = rowsQuery.in("item_id", itemIds)
      summaryQuery = summaryQuery.in("item_id", itemIds)
    }
    if (params.sourceTable) {
      rowsQuery = rowsQuery.eq("source_table", params.sourceTable)
      summaryQuery = summaryQuery.eq("source_table", params.sourceTable)
    }
    if (params.dateFrom) {
      const value = `${params.dateFrom}T00:00:00`
      rowsQuery = rowsQuery.gte("created_at", value)
      summaryQuery = summaryQuery.gte("created_at", value)
    }
    if (params.dateTo) {
      const value = `${params.dateTo}T23:59:59.999`
      rowsQuery = rowsQuery.lte("created_at", value)
      summaryQuery = summaryQuery.lte("created_at", value)
    }

    const [rowsResult, summaryResult] = await Promise.all([
      rowsQuery
        .order("created_at", { ascending: false })
        .range(params.pagination.offset, params.pagination.offset + params.pagination.pageSize - 1),
      summaryQuery.limit(5000),
    ])

    if (rowsResult.error) throw rowsResult.error
    if (summaryResult.error) throw summaryResult.error

    const rows = await this.relations.attachInventoryRelations(rowsResult.data ?? [])
    return {
      rows,
      count: rowsResult.count ?? rows.length,
      summaryRows: (summaryResult.data ?? []) as Array<{
        direction: string
        quantity: number | null
        total_value: number | null
      }>,
    }
  }

  private safeSearch(value: string) {
    return value.replace(/[,%.()'"]/g, " ").replace(/\s+/g, " ").trim()
  }
}
