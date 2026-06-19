import type { SupabaseClient } from "@supabase/supabase-js"

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export type OpeningStockPayload = {
  pharmacyId: string
  itemId: string
  branchId?: string | null
  fallbackBranchId?: string | null
  actorId?: string | null
  quantity: unknown
  unitPrice?: unknown
  unit?: string | null
  batchNumber?: string | null
  expiryDate?: string | null
  trackBatch?: boolean | null
  hasExpiry?: boolean | null
  sourceType?: string
  mode?: "set" | "increment"
}

async function getUsableBranchId(db: SupabaseClient, pharmacyId: string, explicitBranchId?: string | null, fallbackBranchId?: string | null) {
  const requested = clean(explicitBranchId) || clean(fallbackBranchId)
  if (requested) {
    const { data, error } = await db
      .from("pharmacy_branches")
      .select("id")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", requested)
      .neq("status", "closed")
      .maybeSingle()
    if (error) throw error
    if (!data?.id) throw new Error("فرع المخزون الافتتاحي غير تابع لهذه الصيدلية أو مغلق")
    return data.id as string
  }

  const { data, error } = await db
    .from("pharmacy_branches")
    .select("id")
    .eq("pharmacy_id", pharmacyId)
    .neq("status", "closed")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error("لا يوجد فرع صالح لتسجيل المخزون الافتتاحي")
  return data.id as string
}

export async function addOpeningStock(db: SupabaseClient, payload: OpeningStockPayload) {
  const quantity = Math.max(0, numberValue(payload.quantity))
  if (quantity <= 0) return null

  const branchId = await getUsableBranchId(db, payload.pharmacyId, payload.branchId, payload.fallbackBranchId)
  const unitPrice = Math.max(0, numberValue(payload.unitPrice))
  const unit = clean(payload.unit) || null
  const batchNumber = clean(payload.batchNumber) || null
  const expiryDate = clean(payload.expiryDate) || null
  const shouldCreateBatch = Boolean(payload.trackBatch || payload.hasExpiry || batchNumber || expiryDate)
  let batchId: string | null = null

  if (shouldCreateBatch) {
    const { data: batch, error: batchError } = await db
      .from("pharmacy_item_batches")
      .insert({
        pharmacy_id: payload.pharmacyId,
        item_id: payload.itemId,
        branch_id: branchId,
        batch_number: batchNumber || "OPENING",
        expiry_date: expiryDate || null,
        quantity,
        remaining_quantity: quantity,
        unit,
        cost_price: unitPrice,
        source_type: payload.sourceType ?? "opening_stock",
        source_id: payload.itemId,
      })
      .select("id")
      .maybeSingle()
    if (batchError) throw batchError
    batchId = (batch?.id as string | undefined) ?? null
  }

  const balanceQuantity = payload.mode === "increment"
    ? await (async () => {
        const { data, error } = await db
          .from("pharmacy_stock_balances")
          .select("quantity")
          .eq("pharmacy_id", payload.pharmacyId)
          .eq("item_id", payload.itemId)
          .eq("branch_id", branchId)
          .maybeSingle()
        if (error) throw error
        return numberValue((data as { quantity?: unknown } | null)?.quantity) + quantity
      })()
    : quantity

  const { error: balanceError } = await db
    .from("pharmacy_stock_balances")
    .upsert({
      pharmacy_id: payload.pharmacyId,
      item_id: payload.itemId,
      branch_id: branchId,
      quantity: balanceQuantity,
      updated_at: new Date().toISOString(),
    }, { onConflict: "pharmacy_id,item_id,branch_id" })
  if (balanceError) throw balanceError

  const { error: movementError } = await db
    .from("pharmacy_stock_movements")
    .insert({
      pharmacy_id: payload.pharmacyId,
      item_id: payload.itemId,
      batch_id: batchId,
      branch_id: branchId,
      direction: "in",
      quantity,
      unit_price: unitPrice,
      total_value: Number((quantity * unitPrice).toFixed(2)),
      movement_type: "opening_stock",
      source_table: "pharmacy_items",
      source_id: payload.itemId,
      created_by: payload.actorId || null,
    })
  if (movementError) throw movementError

  return { branchId, batchId, quantity }
}

export async function adjustOpeningStock(db: SupabaseClient, payload: OpeningStockPayload & { delta: unknown }) {
  const delta = numberValue(payload.delta)
  if (delta === 0) return null
  if (delta > 0) return addOpeningStock(db, { ...payload, quantity: delta, sourceType: "opening_stock_adjustment", mode: "increment" })

  const quantity = Math.abs(delta)
  const branchId = await getUsableBranchId(db, payload.pharmacyId, payload.branchId, payload.fallbackBranchId)
  const unitPrice = Math.max(0, numberValue(payload.unitPrice))

  const { data: balance, error: readError } = await db
    .from("pharmacy_stock_balances")
    .select("quantity")
    .eq("pharmacy_id", payload.pharmacyId)
    .eq("item_id", payload.itemId)
    .eq("branch_id", branchId)
    .maybeSingle()
  if (readError) throw readError
  if (numberValue((balance as { quantity?: unknown } | null)?.quantity) < quantity) {
    throw new Error("لا يمكن تقليل المخزون الافتتاحي لأن الرصيد الحالي أقل من الفرق المطلوب")
  }

  const { error: balanceError } = await db
    .from("pharmacy_stock_balances")
    .update({
      quantity: numberValue((balance as { quantity?: unknown }).quantity) - quantity,
      updated_at: new Date().toISOString(),
    })
    .eq("pharmacy_id", payload.pharmacyId)
    .eq("item_id", payload.itemId)
    .eq("branch_id", branchId)
  if (balanceError) throw balanceError

  const { error: movementError } = await db
    .from("pharmacy_stock_movements")
    .insert({
      pharmacy_id: payload.pharmacyId,
      item_id: payload.itemId,
      branch_id: branchId,
      direction: "out",
      quantity,
      unit_price: unitPrice,
      total_value: Number((quantity * unitPrice).toFixed(2)),
      movement_type: "opening_stock_adjustment",
      source_table: "pharmacy_items",
      source_id: payload.itemId,
      created_by: payload.actorId || null,
    })
  if (movementError) throw movementError

  return { branchId, batchId: null, quantity: -quantity }
}
