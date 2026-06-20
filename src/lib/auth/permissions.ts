import type { MedicalRole } from "@/types"

export type Permission =
  | "system:all"
  | "developer:read"
  | "developer:write"
  | "pharmacy:read"
  | "pharmacy:write"
  | "pharmacy:delete"
  | "branches:read"
  | "branches:write"
  | "branches:delete"
  | "users:read"
  | "users:write"
  | "users:delete"
  | "roles:manage"
  | "auth:audit.read"
  | "auth:sessions.manage"
  | "sales:read"
  | "sales:write"
  | "sales:void"
  | "sales:discount"
  | "sales:price-override"
  | "purchases:read"
  | "purchases:write"
  | "purchases:void"
  | "inventory:read"
  | "inventory:write"
  | "inventory:create"
  | "inventory:update"
  | "inventory:delete"
  | "inventory:restore"
  | "inventory:archive"
  | "inventory:stocktake"
  | "inventory:opening-stock.write"
  | "inventory:transfer.write"
  | "inventory:damaged.write"
  | "inventory:barcode.print"
  | "items:view-cost"
  | "items:view-profit"
  | "items:export"
  | "items:print"
  | "items:ledger.read"
  | "items:price-groups.write"
  | "financials:read"
  | "financials:write"
  | "reports:read"
  | "reports:export"
  | "hr:read"
  | "hr:write"
  | "crm:read"
  | "crm:write"
  | "settings:read"
  | "settings:write"
  | "settings:system.read"
  | "settings:system.write"
  | "settings:project.read"
  | "settings:project.write"
  | "settings:branches.read"
  | "settings:branches.write"
  | "settings:tax.read"
  | "settings:tax.write"
  | "settings:items.read"
  | "settings:items.write"
  | "settings:sales.read"
  | "settings:sales.write"
  | "settings:cashier.read"
  | "settings:cashier.write"
  | "settings:purchases.read"
  | "settings:purchases.write"
  | "settings:payments.read"
  | "settings:payments.write"
  | "settings:contacts.read"
  | "settings:contacts.write"
  | "settings:invoice.read"
  | "settings:invoice.write"
  | "settings:barcode.read"
  | "settings:barcode.write"
  | "settings:printers.read"
  | "settings:printers.write"
  | "settings:stock-alerts.read"
  | "settings:stock-alerts.write"
  | "settings:notification-templates.read"
  | "settings:notification-templates.write"
  | "settings:email.read"
  | "settings:email.write"
  | "settings:sms.read"
  | "settings:sms.write"
  | "settings:backup.read"
  | "settings:backup.write"
  | "settings:shortcuts.read"
  | "settings:shortcuts.write"
  | "settings:rewards.read"
  | "settings:rewards.write"
  | "settings:extra-units.read"
  | "settings:extra-units.write"
  | "settings:custom-labels.read"
  | "settings:custom-labels.write"
  | "notifications:read"
  | "notifications:manage"
  | "notifications:templates.write"
  | "notifications:system.read"
  | "prescriptions:read"
  | "prescriptions:write"
  | "delivery:read"
  | "delivery:write"
  | "loyalty:read"
  | "loyalty:write"
  | "sync:read"
  | "deleted-records:read"
  | "deleted-records:restore"

export const ALL_PERMISSIONS: Permission[] = [
  "system:all",
  "developer:read", "developer:write",
  "pharmacy:read", "pharmacy:write", "pharmacy:delete",
  "branches:read", "branches:write", "branches:delete",
  "users:read", "users:write", "users:delete", "roles:manage", "auth:audit.read", "auth:sessions.manage",
  "sales:read", "sales:write", "sales:void", "sales:discount", "sales:price-override",
  "purchases:read", "purchases:write", "purchases:void",
  "inventory:read", "inventory:write", "inventory:create", "inventory:update", "inventory:delete", "inventory:restore", "inventory:archive", "inventory:stocktake", "inventory:opening-stock.write", "inventory:transfer.write", "inventory:damaged.write", "inventory:barcode.print",
  "items:view-cost", "items:view-profit", "items:export", "items:print", "items:ledger.read", "items:price-groups.write",
  "financials:read", "financials:write",
  "reports:read", "reports:export",
  "hr:read", "hr:write",
  "crm:read", "crm:write",
  "settings:read", "settings:write",
  "settings:system.read", "settings:system.write",
  "settings:project.read", "settings:project.write",
  "settings:branches.read", "settings:branches.write",
  "settings:tax.read", "settings:tax.write",
  "settings:items.read", "settings:items.write",
  "settings:sales.read", "settings:sales.write",
  "settings:cashier.read", "settings:cashier.write",
  "settings:purchases.read", "settings:purchases.write",
  "settings:payments.read", "settings:payments.write",
  "settings:contacts.read", "settings:contacts.write",
  "settings:invoice.read", "settings:invoice.write",
  "settings:barcode.read", "settings:barcode.write",
  "settings:printers.read", "settings:printers.write",
  "settings:stock-alerts.read", "settings:stock-alerts.write",
  "settings:notification-templates.read", "settings:notification-templates.write",
  "settings:email.read", "settings:email.write",
  "settings:sms.read", "settings:sms.write",
  "settings:backup.read", "settings:backup.write",
  "settings:shortcuts.read", "settings:shortcuts.write",
  "settings:rewards.read", "settings:rewards.write",
  "settings:extra-units.read", "settings:extra-units.write",
  "settings:custom-labels.read", "settings:custom-labels.write",
  "notifications:read", "notifications:manage", "notifications:templates.write", "notifications:system.read",
  "prescriptions:read", "prescriptions:write", "delivery:read", "delivery:write", "loyalty:read", "loyalty:write", "sync:read", "deleted-records:read", "deleted-records:restore",
]

const SETTINGS_READ_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => p.startsWith("settings:") && p.endsWith(".read"))
const SETTINGS_WRITE_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => p.startsWith("settings:") && p.endsWith(".write"))

const SYSTEM_ONLY_PERMISSIONS = new Set<Permission>([
  "system:all",
  "developer:read",
  "developer:write",
  "roles:manage",
  "auth:sessions.manage",
  "settings:system.read",
  "settings:system.write",
  "notifications:system.read",
])

function isSystemOnlyPermission(permission: Permission) {
  return SYSTEM_ONLY_PERMISSIONS.has(permission) || permission.startsWith("developer:")
}

const OWNER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !isSystemOnlyPermission(p))

const ADMIN_SETTINGS: Permission[] = [
  ...SETTINGS_READ_PERMISSIONS.filter((p) => !isSystemOnlyPermission(p)),
  ...SETTINGS_WRITE_PERMISSIONS.filter((p) => !isSystemOnlyPermission(p) && p !== "settings:backup.write"),
]

const MANAGER_SETTINGS: Permission[] = [
  "settings:read", "settings:write",
  "settings:project.read",
  "settings:branches.read", "settings:branches.write",
  "settings:items.read", "settings:items.write",
  "settings:sales.read", "settings:sales.write",
  "settings:cashier.read", "settings:cashier.write",
  "settings:purchases.read", "settings:purchases.write",
  "settings:payments.read",
  "settings:contacts.read",
  "settings:invoice.read",
  "settings:barcode.read", "settings:barcode.write",
  "settings:printers.read", "settings:printers.write",
  "settings:stock-alerts.read", "settings:stock-alerts.write",
  "settings:notification-templates.read",
  "settings:shortcuts.read", "settings:shortcuts.write",
  "settings:extra-units.read", "settings:custom-labels.read",
]

const ROLE_PERMISSIONS: Record<MedicalRole, Permission[]> = {
  developer: ["system:all"],
  owner: OWNER_PERMISSIONS,
  admin: [
    "pharmacy:read", "pharmacy:write",
    "branches:read", "branches:write", "branches:delete",
    "users:read", "users:write", "users:delete", "auth:audit.read",
    "sales:read", "sales:write", "sales:void", "sales:discount", "sales:price-override",
    "purchases:read", "purchases:write", "purchases:void",
    "inventory:read", "inventory:write", "inventory:create", "inventory:update", "inventory:delete", "inventory:restore", "inventory:archive", "inventory:stocktake", "inventory:opening-stock.write", "inventory:transfer.write", "inventory:damaged.write", "inventory:barcode.print",
    "items:view-cost", "items:view-profit", "items:export", "items:print", "items:ledger.read", "items:price-groups.write",
    "financials:read", "financials:write",
    "reports:read", "reports:export",
    "hr:read", "hr:write",
    "crm:read", "crm:write",
    "settings:read", "settings:write", ...ADMIN_SETTINGS,
    "notifications:read", "notifications:manage", "notifications:templates.write",
    "prescriptions:read", "prescriptions:write", "delivery:read", "delivery:write", "loyalty:read", "loyalty:write", "sync:read", "deleted-records:read", "deleted-records:restore",
  ],
  manager: [
    "pharmacy:read", "branches:read", "branches:write", "users:read",
    "sales:read", "sales:write", "sales:void", "sales:discount",
    "purchases:read", "purchases:write",
    "inventory:read", "inventory:write", "inventory:create", "inventory:update", "inventory:archive", "inventory:stocktake", "inventory:opening-stock.write", "inventory:transfer.write", "inventory:damaged.write", "inventory:barcode.print",
    "items:view-cost", "items:export", "items:print", "items:ledger.read", "items:price-groups.write",
    "financials:read", "reports:read", "reports:export",
    "hr:read", "crm:read", "crm:write",
    ...MANAGER_SETTINGS,
    "notifications:read", "notifications:manage",
    "delivery:read", "delivery:write", "sync:read",
  ],
  accountant: [
    "pharmacy:read", "branches:read",
    "sales:read", "purchases:read",
    "inventory:read", "items:view-cost", "items:view-profit", "items:export", "items:print", "items:ledger.read",
    "financials:read", "financials:write",
    "reports:read", "reports:export",
    "crm:read",
    "settings:read", "settings:project.read", "settings:tax.read", "settings:invoice.read", "settings:payments.read", "settings:contacts.read",
    "notifications:read",
  ],
  pharmacist: [
    "pharmacy:read", "branches:read",
    "sales:read", "sales:write",
    "purchases:read",
    "inventory:read", "inventory:write", "inventory:create", "inventory:update", "inventory:stocktake", "inventory:opening-stock.write", "inventory:barcode.print",
    "items:print", "items:ledger.read",
    "crm:read",
    "settings:read", "settings:items.read", "settings:stock-alerts.read", "settings:barcode.read", "settings:printers.read",
    "notifications:read", "prescriptions:read", "prescriptions:write",
  ],
  cashier: [
    "pharmacy:read", "branches:read",
    "sales:read", "sales:write",
    "inventory:read",
    "crm:read",
    "settings:read", "settings:cashier.read", "settings:printers.read",
    "notifications:read",
  ],
  technician: [
    "pharmacy:read", "branches:read", "inventory:read", "inventory:write", "inventory:update", "inventory:stocktake", "inventory:barcode.print", "sales:read", "notifications:read",
  ],
  worker: ["pharmacy:read", "branches:read", "inventory:read", "sales:read", "notifications:read"],
  viewer: [
    "pharmacy:read", "branches:read", "sales:read", "purchases:read", "inventory:read", "reports:read", "settings:read", "notifications:read",
  ],
  "no-access": [],
}

export const ROLE_HIERARCHY: MedicalRole[] = [
  "no-access",
  "viewer",
  "worker",
  "technician",
  "cashier",
  "pharmacist",
  "accountant",
  "manager",
  "admin",
  "owner",
  "developer",
]

export function normalizeRole(role: string | null | undefined): MedicalRole {
  if (!role) return "no-access"
  if (ROLE_HIERARCHY.includes(role as MedicalRole)) return role as MedicalRole
  return "no-access"
}

function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS.includes(value as Permission)
}

export function sanitizePermissionList(
  values: string[] = [],
  options: { allowDeveloper?: boolean; allowSystemOnly?: boolean } = {},
): Permission[] {
  const unique = new Set<Permission>()
  for (const permission of values) {
    if (!isPermission(permission)) continue
    if (!options.allowDeveloper && (permission === "system:all" || permission.startsWith("developer:"))) continue
    if (!options.allowSystemOnly && isSystemOnlyPermission(permission)) continue
    unique.add(permission)
  }
  return Array.from(unique)
}

export function isAssignablePharmacyPermission(permission: Permission): boolean {
  return !isSystemOnlyPermission(permission)
}

export function getPermissions(
  role: string | null | undefined,
  extraPermissions: string[] = [],
  deniedPermissions: string[] = [],
): Permission[] {
  const normalized = normalizeRole(role)
  const base = ROLE_PERMISSIONS[normalized] ?? []
  if (base.includes("system:all")) return ["system:all"]

  const denied = new Set(sanitizePermissionList(deniedPermissions))
  const merged = new Set<Permission>(base.filter((permission) => !denied.has(permission)))

  for (const permission of sanitizePermissionList(extraPermissions)) {
    if (denied.has(permission)) continue
    merged.add(permission)
  }
  return Array.from(merged)
}

export function hasPermission(
  role: string | null | undefined,
  permission: Permission,
  extraPermissions: string[] = [],
  deniedPermissions: string[] = [],
): boolean {
  const permissions = getPermissions(role, extraPermissions, deniedPermissions)
  return permissions.includes("system:all") || permissions.includes(permission)
}

export function hasAnyPermission(
  role: string | null | undefined,
  requiredPermissions: Permission[],
  extraPermissions: string[] = [],
  deniedPermissions: string[] = [],
): boolean {
  if (requiredPermissions.length === 0) return true
  const permissions = getPermissions(role, extraPermissions, deniedPermissions)
  if (permissions.includes("system:all")) return true
  return requiredPermissions.some((permission) => permissions.includes(permission))
}

export function canAccess(
  role: string | null | undefined,
  requiredPermissions: Permission[],
  extraPermissions: string[] = [],
  deniedPermissions: string[] = [],
): boolean {
  const permissions = getPermissions(role, extraPermissions, deniedPermissions)
  if (permissions.includes("system:all")) return true
  return requiredPermissions.every((permission) => permissions.includes(permission))
}

export function roleAtLeast(role: string | null | undefined, minimum: MedicalRole): boolean {
  const currentIdx = ROLE_HIERARCHY.indexOf(normalizeRole(role))
  const minimumIdx = ROLE_HIERARCHY.indexOf(minimum)
  return currentIdx >= minimumIdx
}
