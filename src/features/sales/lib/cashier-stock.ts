export type CashierStockIssue =
  | "out_of_stock"
  | "expired_stock"
  | "missing_batch"
  | "batch_shortage"
  | "expired_item"
  | null

export type CashierStockAvailability = {
  physicalQty: number
  sellableQty: number
  validBatchQty: number
  expiredBatchQty: number
  unallocatedQty: number
  positiveBatchQty: number
  stockIssue: CashierStockIssue
  stockMessage: string | null
}

export type CashierStockInput = {
  manageInventory?: boolean | null
  trackBatch?: boolean | null
  hasExpiry?: boolean | null
  itemExpiry?: string | null
  physicalQty: number
  validBatchQty: number
  expiredBatchQty: number
  positiveBatchQty: number
  today?: string
}

function safeQuantity(value: unknown) {
  const quantity = Number(value)
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0
}

function isValidDateOnly(value: string | null | undefined, today: string) {
  return !value || value >= today
}

/**
 * Defines the single source of truth for stock shown in the cashier.
 * Physical stock can include expired or unallocated quantities, therefore it
 * must never be presented as sellable stock for batch/expiry-managed items.
 */
export function resolveCashierStock(input: CashierStockInput): CashierStockAvailability {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const physicalQty = safeQuantity(input.physicalQty)
  const validBatchQty = safeQuantity(input.validBatchQty)
  const expiredBatchQty = safeQuantity(input.expiredBatchQty)
  const positiveBatchQty = safeQuantity(input.positiveBatchQty)
  const manageInventory = input.manageInventory !== false
  const trackBatch = input.trackBatch === true
  const hasExpiry = input.hasExpiry === true

  if (!manageInventory) {
    return {
      physicalQty,
      sellableQty: physicalQty,
      validBatchQty,
      expiredBatchQty,
      unallocatedQty: 0,
      positiveBatchQty,
      stockIssue: null,
      stockMessage: null,
    }
  }

  if (physicalQty <= 0) {
    return {
      physicalQty: 0,
      sellableQty: 0,
      validBatchQty,
      expiredBatchQty,
      unallocatedQty: 0,
      positiveBatchQty,
      stockIssue: "out_of_stock",
      stockMessage: "الرصيد الفعلي للصنف نافد.",
    }
  }

  const itemExpiryValid = isValidDateOnly(input.itemExpiry, today)
  const hasPositiveBatches = positiveBatchQty > 0
  let sellableQty = physicalQty
  let stockIssue: CashierStockIssue = null
  let stockMessage: string | null = null

  if (trackBatch) {
    sellableQty = Math.min(physicalQty, validBatchQty)
    if (!hasPositiveBatches) {
      stockIssue = "missing_batch"
      stockMessage = `يوجد رصيد فعلي ${physicalQty} لكن لا توجد تشغيلات مسجلة صالحة للبيع.`
    } else if (validBatchQty <= 0) {
      stockIssue = "expired_stock"
      stockMessage = `الرصيد الفعلي ${physicalQty} لكن كل رصيد التشغيلات منتهي أو غير صالح.`
    } else if (sellableQty < physicalQty) {
      stockIssue = "batch_shortage"
      stockMessage = `المتاح الصالح للبيع ${sellableQty} فقط من رصيد فعلي ${physicalQty}.`
    }
  } else if (hasExpiry) {
    if (hasPositiveBatches) {
      sellableQty = Math.min(physicalQty, validBatchQty)
      if (validBatchQty <= 0) {
        stockIssue = "expired_stock"
        stockMessage = `الرصيد الفعلي ${physicalQty} لكن لا توجد تشغيلة غير منتهية.`
      } else if (sellableQty < physicalQty) {
        stockIssue = "batch_shortage"
        stockMessage = `المتاح الصالح للبيع ${sellableQty} فقط من رصيد فعلي ${physicalQty}.`
      }
    } else if (!input.itemExpiry || !itemExpiryValid) {
      sellableQty = 0
      stockIssue = "expired_item"
      stockMessage = input.itemExpiry
        ? `الرصيد الفعلي ${physicalQty} لكن تاريخ صلاحية الصنف منتهي.`
        : `يوجد رصيد فعلي ${physicalQty} بدون تاريخ صلاحية أو تشغيلة صالحة.`
    }
  }

  const unallocatedQty = Math.max(0, physicalQty - positiveBatchQty)
  return {
    physicalQty,
    sellableQty: Math.max(0, sellableQty),
    validBatchQty,
    expiredBatchQty,
    unallocatedQty,
    positiveBatchQty,
    stockIssue,
    stockMessage,
  }
}
