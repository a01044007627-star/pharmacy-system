"use client"

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useAuth } from "@/contexts/auth-context"
import type { Permission } from "@/lib/auth/permissions"

type PermissionGateProps = {
  permission?: Permission
  permissions?: Permission[]
  mode?: "all" | "any"
  children: ReactNode
  fallback?: ReactNode
}

export function PermissionGate({ permission, permissions = [], mode = "all", children, fallback = null }: PermissionGateProps) {
  const { can, isDeveloper } = useAuth()
  const required = useMemo(() => permission ? [permission, ...permissions] : permissions, [permission, permissions])
  const allowed = isDeveloper || required.length === 0 || (mode === "any"
    ? required.some((item) => can(item))
    : required.every((item) => can(item)))

  return allowed ? <>{children}</> : <>{fallback}</>
}
