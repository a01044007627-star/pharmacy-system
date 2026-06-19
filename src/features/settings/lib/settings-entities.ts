import type { Permission } from "@/lib/auth/permissions"

export type SettingsEntityKey =
  | "branches"
  | "tax-rates"
  | "tax-groups"
  | "tax-group-members"
  | "invoice-designs"
  | "barcode-papers"
  | "receipt-printers"
  | "notification-templates"
  | "backups"
  | "price-groups"

export type SettingsEntityConfig = {
  table: string
  read: Permission
  write: Permission
  delete: Permission
  order?: string
  ascending?: boolean
  softDelete?: boolean
  defaultable?: boolean
}

export const settingsEntityConfigs: Record<SettingsEntityKey, SettingsEntityConfig> = {
  "branches": { table: "pharmacy_branches", read: "settings:branches.read", write: "settings:branches.write", delete: "branches:delete", order: "is_default", ascending: false, defaultable: true },
  "tax-rates": { table: "pharmacy_tax_rates", read: "settings:tax.read", write: "settings:tax.write", delete: "settings:tax.write", order: "name" },
  "tax-groups": { table: "pharmacy_tax_groups", read: "settings:tax.read", write: "settings:tax.write", delete: "settings:tax.write", order: "name" },
  "tax-group-members": { table: "pharmacy_tax_group_members", read: "settings:tax.read", write: "settings:tax.write", delete: "settings:tax.write", order: "created_at" },
  "invoice-designs": { table: "pharmacy_invoice_designs", read: "settings:invoice.read", write: "settings:invoice.write", delete: "settings:invoice.write", order: "is_default", ascending: false, defaultable: true },
  "barcode-papers": { table: "pharmacy_barcode_paper_settings", read: "settings:barcode.read", write: "settings:barcode.write", delete: "settings:barcode.write", order: "is_default", ascending: false, defaultable: true },
  "receipt-printers": { table: "pharmacy_receipt_printers", read: "settings:printers.read", write: "settings:printers.write", delete: "settings:printers.write", order: "is_default", ascending: false, defaultable: true },
  "notification-templates": { table: "pharmacy_notification_templates", read: "settings:notification-templates.read", write: "settings:notification-templates.write", delete: "settings:notification-templates.write", order: "scenario" },
  "backups": { table: "pharmacy_backups", read: "settings:backup.read", write: "settings:backup.write", delete: "settings:backup.write", order: "created_at", ascending: false, softDelete: true },
  "price-groups": { table: "pharmacy_price_groups", read: "inventory:read", write: "inventory:create", delete: "inventory:delete", order: "name" },
}

export function getSettingsEntityConfig(value: string | null | undefined) {
  if (!value || !(value in settingsEntityConfigs)) return null
  return settingsEntityConfigs[value as SettingsEntityKey]
}
