import "server-only"

import { NextResponse } from "next/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { hasPermission, hasAnyPermission, canAccess, type Permission } from "@/lib/auth/permissions"
import type { AuthScope, PharmacyMembership } from "@/types"

export class PermissionError extends Error {
  status: number
  constructor(message = "ليست لديك صلاحية تنفيذ هذه العملية", status = 403) {
    super(message)
    this.status = status
  }
}

export function permissionErrorResponse(error: unknown) {
  if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status })
  return null
}

function activeMembership(scope: AuthScope): PharmacyMembership | undefined {
  const candidates = scope.memberships.filter((membership) => membership.pharmacy_id === scope.activePharmacyId)
  return candidates.find((membership) => membership.branch_id === scope.activeBranchId)
    ?? candidates.find((membership) => membership.branch_id === null)
    ?? candidates[0]
}

export function activeMembershipPermissions(scope: AuthScope): string[] {
  return activeMembership(scope)?.permissions ?? []
}

export function activeMembershipDeniedPermissions(scope: AuthScope): string[] {
  return activeMembership(scope)?.denied_permissions ?? []
}

export function scopeCan(scope: AuthScope, permission: Permission): boolean {
  return scope.isDeveloper || hasPermission(scope.role, permission, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
}

export function scopeCanAny(scope: AuthScope, permissions: Permission[]): boolean {
  return scope.isDeveloper || hasAnyPermission(scope.role, permissions, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
}

export function scopeCanAll(scope: AuthScope, permissions: Permission[]): boolean {
  return scope.isDeveloper || canAccess(scope.role, permissions, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
}

export function isBranchScoped(scope: AuthScope): boolean {
  if (scope.isDeveloper || scope.isOwner || ["owner", "admin"].includes(scope.role)) return false
  return Boolean(activeMembership(scope)?.branch_id)
}

export function assertBranchScope(scope: AuthScope, branchId?: string | null) {
  if (!isBranchScoped(scope)) return
  const membership = activeMembership(scope)
  if (branchId && membership?.branch_id && branchId !== membership.branch_id) {
    throw new PermissionError("ليست لديك صلاحية على هذا الفرع", 403)
  }
}

export async function requireAuthScope(params?: { requestedPharmacyId?: string | null; requestedBranchId?: string | null }) {
  const scope = await getServerAuthScope({
    ...params,
    strictRequested: Boolean(params?.requestedPharmacyId || params?.requestedBranchId),
  })
  if (!scope.user) throw new PermissionError("غير مسجل الدخول", 401)
  return scope
}

export async function requirePermission(permission: Permission, params?: { requestedPharmacyId?: string | null; requestedBranchId?: string | null }) {
  const scope = await requireAuthScope(params)
  if (!scopeCan(scope, permission)) throw new PermissionError()
  return scope
}

export async function requireAnyPermission(permissions: Permission[], params?: { requestedPharmacyId?: string | null; requestedBranchId?: string | null }) {
  const scope = await requireAuthScope(params)
  if (!scopeCanAny(scope, permissions)) throw new PermissionError()
  return scope
}

export function requireActivePharmacy(scope: AuthScope) {
  if (!scope.activePharmacyId) throw new PermissionError("اختر الصيدلية النشطة أولًا", 400)
  return scope.activePharmacyId
}
