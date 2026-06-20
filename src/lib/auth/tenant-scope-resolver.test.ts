import { TenantScopeResolver } from "@/lib/auth/tenant-scope-resolver"
import type { BranchSummary, PharmacyMembership, PharmacySummary } from "@/types"

const pharmacy = (id: string, ownerId: string): PharmacySummary => ({
  id, owner_id: ownerId, name: `صيدلية ${id}`, legal_name: null, status: "active",
  plan: "standard", currency: "EGP", timezone: "Africa/Cairo",
})
const branch = (id: string, pharmacyId: string, isDefault = false): BranchSummary => ({
  id, pharmacy_id: pharmacyId, code: id, name: `فرع ${id}`, is_default: isDefault, status: "active",
})
const membership = (pharmacyId: string, branchId: string | null, role = "cashier"): PharmacyMembership => ({
  id: `${pharmacyId}-${branchId ?? "all"}`, pharmacy_id: pharmacyId, branch_id: branchId,
  user_id: "staff-user", role: role as PharmacyMembership["role"], is_active: true,
  permissions: [], denied_permissions: [], pharmacy: pharmacy(pharmacyId, "owner-user"),
  branch: branchId ? branch(branchId, pharmacyId) : null,
})

describe("TenantScopeResolver", () => {
  test("developer can select any platform pharmacy without becoming its owner", () => {
    const resolver = new TenantScopeResolver([], [], [pharmacy("p1", "o1"), pharmacy("p2", "o2")], true)
    expect(resolver.pickPharmacy("p2", true)?.id).toBe("p2")
    expect(resolver.roleFor("p2")).toBe("developer")
  })
  test("owner can access only owned pharmacies", () => {
    const resolver = new TenantScopeResolver([], [pharmacy("owned", "owner-user")], [], false)
    expect(resolver.pickPharmacy("owned", true)?.id).toBe("owned")
    expect(resolver.pickPharmacy("foreign", true)).toBeNull()
    expect(resolver.roleFor("owned")).toBe("owner")
  })
  test("branch-scoped employee sees only assigned branches", () => {
    const resolver = new TenantScopeResolver([membership("p1", "b2")], [], [], false)
    const branches = [branch("b1", "p1", true), branch("b2", "p1")]
    expect(resolver.visibleBranches("p1", branches).map((item) => item.id)).toEqual(["b2"])
    expect(resolver.pickBranch("p1", branches, "b1", true)).toBeNull()
    expect(resolver.pickBranch("p1", branches, "b2", true)?.id).toBe("b2")
  })
  test("pharmacy-wide employee can see all branches", () => {
    const resolver = new TenantScopeResolver([membership("p1", null, "manager")], [], [], false)
    const branches = [branch("b1", "p1", true), branch("b2", "p1")]
    expect(resolver.visibleBranches("p1", branches)).toHaveLength(2)
    expect(resolver.roleFor("p1", "b2")).toBe("manager")
  })
})
