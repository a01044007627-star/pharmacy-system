import type { MedicalRole } from "@/types"
import { hasPermission, type Permission } from "@/lib/auth/permissions"
import type { SettingsNamespace } from "./settings-keys"

export type SettingsPermissionModule =
  | SettingsNamespace
  | "branches"
  | "invoice"
  | "barcode"
  | "printers"
  | "notificationTemplates"
  | "backup"

const GLOBAL_DEVELOPER_MODULES = new Set<SettingsPermissionModule>(["system"])
const TENANT_WRITE_ROLES = new Set<MedicalRole>(["developer", "owner", "admin", "manager"])

const MODULE_PERMISSION_SLUG: Record<SettingsPermissionModule, string> = {
  project: "project",
  branches: "branches",
  tax: "tax",
  system: "system",
  items: "items",
  cashier: "cashier",
  sales: "sales",
  purchases: "purchases",
  payments: "payments",
  contacts: "contacts",
  stockAlerts: "stock-alerts",
  email: "email",
  sms: "sms",
  rewards: "rewards",
  extraUnits: "extra-units",
  customLabels: "custom-labels",
  shortcuts: "shortcuts",
  invoice: "invoice",
  barcode: "barcode",
  printers: "printers",
  notificationTemplates: "notification-templates",
  backup: "backup",
}

function modulePermission(module: SettingsPermissionModule | null | undefined, action: "read" | "write"): Permission {
  const slug = module ? MODULE_PERMISSION_SLUG[module] : null
  return (slug ? `settings:${slug}.${action}` : `settings:${action}`) as Permission
}

export function isGlobalSettingsModule(module?: SettingsPermissionModule | null): boolean {
  return Boolean(module && GLOBAL_DEVELOPER_MODULES.has(module))
}

export const isGlobalSettingsNamespace = isGlobalSettingsModule

export function canReadSettingsNamespace(role: MedicalRole, isDeveloper: boolean, module?: SettingsPermissionModule | null, extraPermissions: string[] = [], deniedPermissions: string[] = []): boolean {
  if (isDeveloper || role === "developer") return true
  if (!hasPermission(role, "settings:read", extraPermissions, deniedPermissions)) return false
  if (!module) return true
  if (isGlobalSettingsModule(module)) return hasPermission(role, modulePermission(module, "read"), extraPermissions, deniedPermissions)
  return hasPermission(role, modulePermission(module, "read"), extraPermissions, deniedPermissions) || hasPermission(role, "settings:read", extraPermissions, deniedPermissions)
}

export function canWriteSettingsNamespace(role: MedicalRole, isDeveloper: boolean, module?: SettingsPermissionModule | null, extraPermissions: string[] = [], deniedPermissions: string[] = []): boolean {
  if (isGlobalSettingsModule(module)) return isDeveloper || role === "developer"
  if (isDeveloper || role === "developer") return true
  if (!TENANT_WRITE_ROLES.has(role)) return false
  if (!hasPermission(role, "settings:write", extraPermissions, deniedPermissions)) return false
  if (!module) return true
  return hasPermission(role, modulePermission(module, "write"), extraPermissions, deniedPermissions) || hasPermission(role, "settings:write", extraPermissions, deniedPermissions)
}

export function settingsPermissionMessage(module?: SettingsPermissionModule | null): string {
  if (isGlobalSettingsModule(module)) return "إعدادات النظام الأساسية متاحة للمطور فقط"
  return "ليست لديك صلاحية تعديل هذا الجزء من الإعدادات"
}

export function settingsModulePermissions(module?: SettingsPermissionModule | null) {
  return {
    read: modulePermission(module, "read"),
    write: modulePermission(module, "write"),
  }
}
