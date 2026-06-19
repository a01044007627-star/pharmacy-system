import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSuperAdmin, SUPER_ADMIN_ROLE } from "@/config/super-admin"
import { normalizeRole } from "@/lib/auth/permissions"
import type { AuthScope, BranchSummary, MedicalRole, PharmacyMembership, PharmacySummary, UserProfile } from "@/types"

type DbClient = SupabaseClient

type MembershipRow = {
  id: string
  pharmacy_id: string
  branch_id: string | null
  user_id: string
  role: string
  is_active: boolean
  permissions: unknown
  denied_permissions?: unknown
  pharmacy?: PharmacySummary | PharmacySummary[] | null
  branch?: BranchSummary | BranchSummary[] | null
}

function getServiceClient(): DbClient | null {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
    return createAdminClient() as DbClient
  } catch {
    return null
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  return []
}

function emptyScope(user: User | null = null): AuthScope {
  return {
    user,
    profile: null,
    role: "no-access",
    isDeveloper: false,
    isOwner: false,
    activePharmacyId: null,
    activeBranchId: null,
    activePharmacy: null,
    activeBranch: null,
    memberships: [],
    branches: [],
  }
}

async function ensureUserProfile(client: DbClient, user: User, role: MedicalRole): Promise<UserProfile | null> {
  const email = user.email ?? ""
  const meta = user.user_metadata ?? {}
  const fullName = (meta.full_name ?? meta.display_name ?? email.split("@")[0] ?? null) as string | null
  const phone = (meta.phone ?? meta.mobile ?? null) as string | null
  const avatarUrl = (meta.avatar_url ?? null) as string | null

  const { data: existing } = await client
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()

  if (existing) return existing as UserProfile

  const { data } = await client
    .from("user_profiles")
    .insert({
      user_id: user.id,
      email,
      full_name: fullName,
      phone,
      avatar_url: avatarUrl,
      global_role: role,
      is_active: true,
    })
    .select("*")
    .maybeSingle()

  return (data ?? null) as UserProfile | null
}

async function readMemberships(client: DbClient, userId: string): Promise<PharmacyMembership[]> {
  const { data } = await client
    .from("pharmacy_profiles")
    .select(`
      id,
      pharmacy_id,
      branch_id,
      user_id,
      role,
      is_active,
      permissions,
      denied_permissions,
      pharmacy:pharmacies(id, owner_id, name, legal_name, status, plan, currency, timezone),
      branch:pharmacy_branches(id, pharmacy_id, code, name, is_default, status)
    `)
    .eq("user_id", userId)
    .eq("is_active", true)

  return ((data ?? []) as unknown as MembershipRow[]).map((row) => {
    const pharmacy = Array.isArray(row.pharmacy) ? (row.pharmacy[0] ?? null) : (row.pharmacy ?? null)
    const branch = Array.isArray(row.branch) ? (row.branch[0] ?? null) : (row.branch ?? null)

    return {
      id: row.id,
      pharmacy_id: row.pharmacy_id,
      branch_id: row.branch_id,
      user_id: row.user_id,
      role: normalizeRole(row.role),
      is_active: row.is_active,
      permissions: toStringArray(row.permissions),
      denied_permissions: toStringArray(row.denied_permissions),
      pharmacy,
      branch,
    }
  })
}

async function readOwnedPharmacies(client: DbClient, userId: string): Promise<PharmacySummary[]> {
  const { data } = await client
    .from("pharmacies")
    .select("id, owner_id, name, legal_name, status, plan, currency, timezone")
    .eq("owner_id", userId)
    .neq("status", "closed")

  return (data ?? []) as PharmacySummary[]
}

async function readDeveloperPharmacies(client: DbClient): Promise<PharmacySummary[]> {
  const { data } = await client
    .from("pharmacies")
    .select("id, owner_id, name, legal_name, status, plan, currency, timezone")
    .order("created_at", { ascending: false })

  return (data ?? []) as PharmacySummary[]
}

async function readBranches(client: DbClient, pharmacyId: string | null): Promise<BranchSummary[]> {
  if (!pharmacyId) return []
  const { data } = await client
    .from("pharmacy_branches")
    .select("id, pharmacy_id, code, name, is_default, status")
    .eq("pharmacy_id", pharmacyId)
    .neq("status", "closed")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })

  return (data ?? []) as BranchSummary[]
}

function pickActivePharmacy(
  requestedPharmacyId: string | null | undefined,
  memberships: PharmacyMembership[],
  owned: PharmacySummary[],
  developerPharmacies: PharmacySummary[],
): PharmacySummary | null {
  const all = [
    ...owned,
    ...memberships.map((m) => m.pharmacy).filter(Boolean) as PharmacySummary[],
    ...developerPharmacies,
  ]
  const unique = new Map(all.map((pharmacy) => [pharmacy.id, pharmacy]))
  if (requestedPharmacyId && unique.has(requestedPharmacyId)) return unique.get(requestedPharmacyId) ?? null
  return owned[0] ?? memberships[0]?.pharmacy ?? developerPharmacies[0] ?? null
}

function resolveActiveRole(
  isDeveloper: boolean,
  activePharmacyId: string | null,
  memberships: PharmacyMembership[],
  ownedPharmacies: PharmacySummary[],
): MedicalRole {
  if (isDeveloper) return SUPER_ADMIN_ROLE
  if (!activePharmacyId) return "no-access"
  if (ownedPharmacies.some((pharmacy) => pharmacy.id === activePharmacyId)) return "owner"
  const activeMembership = memberships.find((membership) => membership.pharmacy_id === activePharmacyId)
  return activeMembership?.role ?? "no-access"
}

export async function getServerAuthScope(params?: {
  requestedPharmacyId?: string | null
  requestedBranchId?: string | null
}): Promise<AuthScope> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return emptyScope()

  const adminClient = getServiceClient()
  const db = adminClient ?? (supabase as DbClient)

  const email = user.email ?? null
  const developerByEmail = isSuperAdmin(email)

  const { data: developerRecord } = await db
    .from("developer_users")
    .select("id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle()

  const isDeveloper = developerByEmail || Boolean(developerRecord)
  const baseRole: MedicalRole = isDeveloper ? "developer" : normalizeRole(user.user_metadata?.role as string | undefined)
  const profile = await ensureUserProfile(db, user, baseRole)

  if (profile && profile.is_active === false && !isDeveloper) {
    return {
      ...emptyScope(user),
      profile,
      role: "no-access",
    }
  }

  const [memberships, ownedPharmacies, developerPharmacies] = await Promise.all([
    readMemberships(db, user.id),
    readOwnedPharmacies(db, user.id),
    isDeveloper ? readDeveloperPharmacies(db) : Promise.resolve([]),
  ])

  const activePharmacy = pickActivePharmacy(
    params?.requestedPharmacyId,
    memberships,
    ownedPharmacies,
    developerPharmacies,
  )
  const branches = await readBranches(db, activePharmacy?.id ?? null)
  const membershipForActive = memberships.find((membership) => membership.pharmacy_id === activePharmacy?.id)
  const activeBranch = branches.find((branch) => branch.id === params?.requestedBranchId)
    ?? branches.find((branch) => branch.id === membershipForActive?.branch_id)
    ?? branches.find((branch) => branch.is_default)
    ?? branches[0]
    ?? null

  const role = resolveActiveRole(isDeveloper, activePharmacy?.id ?? null, memberships, ownedPharmacies)
  const isOwner = role === "owner"

  return {
    user,
    profile,
    role,
    isDeveloper,
    isOwner,
    activePharmacyId: activePharmacy?.id ?? null,
    activeBranchId: activeBranch?.id ?? null,
    activePharmacy,
    activeBranch,
    memberships,
    branches,
  }
}
