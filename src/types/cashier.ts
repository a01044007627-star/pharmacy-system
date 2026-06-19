import type { PaymentMethod, SaleStatus, DiscountType } from "./sales"

export type { PaymentMethod, SaleStatus, DiscountType }

export interface CashierLine {
  itemId: string
  name: string
  sku?: string | null
  unit: string
  quantity: number
  unitPrice: number
  discount: number
  discountType: DiscountType
  manageInventory: boolean
  currentStock: number
  barcodes?: string[]
  manufacturerName?: string | null
  group?: string | null
  brand?: string | null
}

export interface CashierCustomer {
  id: string
  name: string
  mobile?: string | null
  phone?: string | null
  email?: string | null
  balance?: number | string | null
  openingBalance?: number | string | null
  status?: string | null
  contactId?: string | null
}

export interface CashierTaxRate {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

export interface CashierShift {
  id: string
  branchId: string
  openingCash: number
  expectedCash?: number
  openedAt: string
  closedAt?: string | null
  notes?: string | null
  status: "open" | "closed"
}

export interface CashierTotals {
  subtotal: number
  lineDiscount: number
  invoiceDiscount: number
  taxAmount: number
  shippingValue: number
  total: number
  paid: number
  due: number
  qtyCount: number
}

export interface SavedDraft {
  lines?: CashierLine[]
  customerId?: string | null
  customerName?: string
  branchId?: string
  paidAmount?: string
  discountValue?: string
  discountType?: DiscountType
  paymentMethod?: PaymentMethod
  shippingFeeValue?: string
  invoiceNotes?: string
  selectedTaxRate?: string
  savedAt?: string
}