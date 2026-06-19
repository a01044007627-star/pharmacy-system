import { roleAtLeast } from "@/lib/auth/permissions"

export function getEffectiveScope(
  userRole: string,
  _userId: string,
  userBranchId: string | null,
  targetBranchId: string | null,
): { branch_id?: string } {
  if (userRole === "developer" || userRole === "owner" || roleAtLeast(userRole, "admin")) {
    return targetBranchId ? { branch_id: targetBranchId } : {}
  }

  if (userBranchId) return { branch_id: userBranchId }
  return {}
}
