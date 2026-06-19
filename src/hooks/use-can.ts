"use client"

import { useMemo } from "react"
import { useAuth } from "@/contexts/auth-context"
import type { Permission } from "@/lib/auth/permissions"

export function useCan(permission: Permission): boolean {
  const { can } = useAuth()
  return can(permission)
}

export function useAnyPermission(permissions: Permission[]): boolean {
  const { can, isDeveloper } = useAuth()
  return useMemo(() => isDeveloper || permissions.length === 0 || permissions.some((permission) => can(permission)), [can, isDeveloper, permissions])
}

export function useAllPermissions(permissions: Permission[]): boolean {
  const { can, isDeveloper } = useAuth()
  return useMemo(() => isDeveloper || permissions.every((permission) => can(permission)), [can, isDeveloper, permissions])
}
