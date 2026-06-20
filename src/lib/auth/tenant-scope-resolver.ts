import { normalizeRole } from "@/lib/auth/permissions"
import type { BranchSummary, MedicalRole, PharmacyMembership, PharmacySummary } from "@/types"

/**
 * Resolves the tenant and branch visible to a signed-in user.
 *
 * Platform developers are not pharmacy owners or employees. Owners may access
 * only pharmacies they own, while staff access is derived from active tenant
 * memberships and optional branch scope.
 */
export class TenantScopeResolver {
  constructor(
    private readonly memberships: PharmacyMembership[],
    private readonly ownedPharmacies: PharmacySummary[],
    private readonly developerPharmacies: PharmacySummary[],
    private readonly isDeveloper: boolean,
  ) {}

  accessiblePharmacies(): PharmacySummary[] {
    const source = this.isDeveloper
      ? this.developerPharmacies
      : [
          ...this.ownedPharmacies,
          ...this.memberships.map((membership) => membership.pharmacy).filter(Boolean) as PharmacySummary[],
        ]

    return Array.from(new Map(source.map((pharmacy) => [pharmacy.id, pharmacy])).values())
  }

  pickPharmacy(requestedPharmacyId?: string | null, strictRequested = false): PharmacySummary | null {
    const pharmacies = this.accessiblePharmacies()
    if (requestedPharmacyId) {
      const requested = pharmacies.find((pharmacy) => pharmacy.id === requestedPharmacyId) ?? null
      if (requested || strictRequested) return requested
    }
    return this.ownedPharmacies[0]
      ?? this.memberships.find((membership) => membership.pharmacy)?.pharmacy
      ?? this.developerPharmacies[0]
      ?? null
  }

  roleFor(pharmacyId: string | null, branchId?: string | null): MedicalRole {
    if (this.isDeveloper) return "developer"
    if (!pharmacyId) return "no-access"
    if (this.ownedPharmacies.some((pharmacy) => pharmacy.id === pharmacyId)) return "owner"
    return this.membershipFor(pharmacyId, branchId)?.role ?? "no-access"
  }

  membershipFor(pharmacyId: string | null, branchId?: string | null): PharmacyMembership | null {
    if (!pharmacyId) return null
    const candidates = this.memberships.filter((membership) => membership.pharmacy_id === pharmacyId)
    if (!candidates.length) return null
    return candidates.find((membership) => membership.branch_id === branchId)
      ?? candidates.find((membership) => membership.branch_id === null)
      ?? candidates[0]
      ?? null
  }

  visibleBranches(pharmacyId: string | null, allBranches: BranchSummary[]): BranchSummary[] {
    if (!pharmacyId) return []
    if (this.isDeveloper || this.ownedPharmacies.some((pharmacy) => pharmacy.id === pharmacyId)) return allBranches

    const candidates = this.memberships.filter((membership) => membership.pharmacy_id === pharmacyId)
    if (candidates.some((membership) => membership.branch_id === null)) return allBranches
    const allowedIds = new Set(candidates.map((membership) => membership.branch_id).filter(Boolean))
    return allBranches.filter((branch) => allowedIds.has(branch.id))
  }

  pickBranch(
    pharmacyId: string | null,
    allBranches: BranchSummary[],
    requestedBranchId?: string | null,
    strictRequested = false,
  ): BranchSummary | null {
    const visible = this.visibleBranches(pharmacyId, allBranches)
    if (requestedBranchId) {
      const requested = visible.find((branch) => branch.id === requestedBranchId) ?? null
      if (requested || strictRequested) return requested
    }

    const preferredMembership = this.membershipFor(pharmacyId, null)
      ?? this.memberships.find((membership) => membership.pharmacy_id === pharmacyId)
    return visible.find((branch) => branch.id === preferredMembership?.branch_id)
      ?? visible.find((branch) => branch.is_default)
      ?? visible[0]
      ?? null
  }

  static normalizeMembershipRole(role: string | null | undefined): MedicalRole {
    return normalizeRole(role)
  }
}
