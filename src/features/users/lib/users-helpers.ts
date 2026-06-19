import { getPermissions, type Permission } from "@/lib/auth/permissions"
import type { MedicalRole } from "@/types"
import type { PharmacyUser, UserFormValues } from "@/features/users/types"

export const assignableUserRoles: MedicalRole[] = [
  "admin",
  "manager",
  "accountant",
  "pharmacist",
  "cashier",
  "technician",
  "worker",
  "viewer",
  "no-access",
]

export function normalizedUserName(user: PharmacyUser) {
  return user.full_name || user.user_profile?.full_name || user.email || user.user_profile?.email || user.user_id
}

export function normalizedUserEmail(user: PharmacyUser) {
  return user.email || user.user_profile?.email || ""
}

export function normalizedUserPhone(user: PharmacyUser) {
  return user.phone || user.user_profile?.phone || ""
}

export function makeInitialUserValues(user?: PharmacyUser | null): UserFormValues {
  return {
    user_id: user?.user_id ?? undefined,
    email: normalizedUserEmail(user ?? ({} as PharmacyUser)),
    password: "",
    full_name: user ? normalizedUserName(user) : "",
    phone: user ? normalizedUserPhone(user) : "",
    title: user?.title ?? "",
    role: user?.role ?? "cashier",
    branch_id: user?.branch_id ?? null,
    is_active: user?.is_active ?? true,
    permissions: user?.permissions ?? [],
    denied_permissions: user?.denied_permissions ?? [],
  }
}

export function baseRolePermissions(role: MedicalRole): Permission[] {
  const permissions = getPermissions(role)
  return permissions.includes("system:all") ? [] : permissions
}

export function permissionSet(values: Permission[]) {
  return new Set<Permission>(values)
}
