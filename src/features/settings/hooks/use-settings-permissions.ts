"use client"

import { useMemo } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useUserRole } from "@/hooks/use-user-role"
import type { SettingsPermissionModule } from "../lib/settings-permissions"
import { canReadSettingsNamespace, canWriteSettingsNamespace, settingsModulePermissions } from "../lib/settings-permissions"

export function useSettingsPermissions(module?: SettingsPermissionModule) {
  const { can, isDeveloper, memberships, activePharmacyId } = useAuth()
  const { isOwnerOrDev, role } = useUserRole()
  const activeMembership = memberships.find((membership) => membership.pharmacy_id === activePharmacyId)
  const extraPermissions = activeMembership?.permissions ?? []
  const deniedPermissions = activeMembership?.denied_permissions ?? []

  return useMemo(() => {
    const modulePerms = settingsModulePermissions(module)
    const canReadNamespace = canReadSettingsNamespace(role, isDeveloper, module, extraPermissions, deniedPermissions)
    const canWriteNamespace = canWriteSettingsNamespace(role, isDeveloper, module, extraPermissions, deniedPermissions)

    return {
      canRead: can("settings:read") || isDeveloper || role === "developer",
      canWrite: can("settings:write") || isDeveloper || role === "developer",
      canReadNamespace,
      canWriteNamespace,
      moduleReadPermission: modulePerms.read,
      moduleWritePermission: modulePerms.write,
      role,
      isDeveloper,
      isOwnerOrDev,
    }
  }, [activePharmacyId, can, deniedPermissions, extraPermissions, isDeveloper, isOwnerOrDev, module, role])
}
