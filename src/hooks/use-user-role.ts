"use client"

import { useMemo } from "react"
import { useAuth } from "@/contexts/auth-context"
import { roleAtLeast, type Permission } from "@/lib/auth/permissions"
import type { MedicalRole } from "@/types"

const ownerDevRoles: MedicalRole[] = ["owner", "developer"]

export function useUserRole() {
  const { role, loading, isDeveloper, isOwner, can } = useAuth()

  return useMemo(() => ({
    role,
    loading,
    isDeveloper,
    isOwner,
    isOwnerOrDev: role ? ownerDevRoles.includes(role) || isDeveloper || isOwner : false,
    isAdmin: role === "admin",
    isManager: role === "manager",
    isCashier: role === "cashier",
    isPharmacist: role === "pharmacist",
    hasRole: (r: string) => role === r,
    can: (permission: Permission) => can(permission),
    isAtLeast: (minimum: MedicalRole) => roleAtLeast(role, minimum),
  }), [role, loading, isDeveloper, isOwner, can])
}
