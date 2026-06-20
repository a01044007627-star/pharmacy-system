import { StateMachine } from "./state-machine"

export enum PurchaseOrderStatus {
  Draft = "draft",
  Sent = "sent",
  Partial = "partial",
  Received = "received",
  Cancelled = "cancelled",
}

export enum DeliveryStatus {
  Pending = "pending",
  Confirmed = "confirmed",
  Preparing = "preparing",
  Shipped = "shipped",
  Delivered = "delivered",
  Cancelled = "cancelled",
  Returned = "returned",
}

export enum StockCountStatus {
  Draft = "draft",
  Posted = "posted",
  Approved = "approved",
  Cancelled = "cancelled",
}

export const purchaseOrderWorkflow = new StateMachine<PurchaseOrderStatus>({
  [PurchaseOrderStatus.Draft]: [PurchaseOrderStatus.Sent, PurchaseOrderStatus.Cancelled],
  [PurchaseOrderStatus.Sent]: [PurchaseOrderStatus.Partial, PurchaseOrderStatus.Received, PurchaseOrderStatus.Cancelled],
  [PurchaseOrderStatus.Partial]: [PurchaseOrderStatus.Received, PurchaseOrderStatus.Cancelled],
  [PurchaseOrderStatus.Received]: [],
  [PurchaseOrderStatus.Cancelled]: [],
})

export const deliveryWorkflow = new StateMachine<DeliveryStatus>({
  [DeliveryStatus.Pending]: [DeliveryStatus.Confirmed, DeliveryStatus.Cancelled],
  [DeliveryStatus.Confirmed]: [DeliveryStatus.Preparing, DeliveryStatus.Cancelled],
  [DeliveryStatus.Preparing]: [DeliveryStatus.Shipped, DeliveryStatus.Cancelled],
  [DeliveryStatus.Shipped]: [DeliveryStatus.Delivered, DeliveryStatus.Returned],
  [DeliveryStatus.Delivered]: [DeliveryStatus.Returned],
  [DeliveryStatus.Cancelled]: [],
  [DeliveryStatus.Returned]: [],
})

export const stockCountWorkflow = new StateMachine<StockCountStatus>({
  [StockCountStatus.Draft]: [StockCountStatus.Posted, StockCountStatus.Cancelled],
  [StockCountStatus.Posted]: [StockCountStatus.Approved, StockCountStatus.Cancelled],
  [StockCountStatus.Approved]: [],
  [StockCountStatus.Cancelled]: [],
})

export function isEnumValue<T extends Record<string, string>>(enumObject: T, value: unknown): value is T[keyof T] {
  return typeof value === "string" && Object.values(enumObject).includes(value)
}
