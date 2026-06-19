export const SUPER_ADMIN_EMAIL = "mostafa0falcon@gmail.com"
export const SUPER_ADMIN_ROLE = "developer" as const

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
}

export function resolveRole(email: string | null | undefined, currentRole: string | null | undefined): string {
  if (isSuperAdmin(email)) return SUPER_ADMIN_ROLE
  return currentRole ?? "no-access"
}
