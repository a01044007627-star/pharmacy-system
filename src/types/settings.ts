export type SettingsTabId =
  | "project" | "tax" | "items" | "contacts" | "sales" | "cashier"
  | "purchases" | "payments" | "stockAlerts" | "system" | "shortcuts"
  | "email" | "sms" | "rewards" | "extraUnits" | "customLabels"

export type CurrencySymbolPlacement = "before" | "after"
export type InventoryCostingMethod = "fifo" | "lifo" | "average"
export type TimeFormat = "12" | "24"
export type PaymentTerm = "cash" | "day" | "month"
export type SaleItemBehavior = "increase" | "replace" | "warn"
export type SalesRepCommissionBase = "invoice" | "profit"
export type CashCategoryScope = "pos" | "all"
export type SystemLanguage = "ar" | "en"
export type HttpMethod = "GET" | "POST"
export type FieldType = "text" | "number" | "date" | "select"

export type Option = { label: string; value: string }
export type CustomFieldGroup = "itemFields" | "purchaseFields" | "shippingFields" | "saleFields"
export type StringLabelGroup = "paymentFields" | "contactFields" | "locationFields" | "userFields" | "serviceFields"
