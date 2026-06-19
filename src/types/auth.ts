import type { User, Session } from "@supabase/supabase-js"
import type { UUID, Timestamp } from "@/types/common"

export type MedicalRole =
  | "developer"
  | "owner"
  | "admin"
  | "manager"
  | "accountant"
  | "pharmacist"
  | "cashier"
  | "technician"
  | "worker"
  | "viewer"
  | "no-access"

export type AppRole = MedicalRole

export interface UserProfile {
  id: UUID
  user_id: UUID
  email: string
  username?: string | null
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  global_role: MedicalRole
  is_active: boolean
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PharmacySummary {
  id: UUID
  owner_id: UUID
  name: string
  legal_name: string | null
  status: "active" | "suspended" | "closed" | string
  plan: string
  currency: string
  timezone: string
}

export interface BranchSummary {
  id: UUID
  pharmacy_id: UUID
  code: string
  name: string
  is_default: boolean
  status: string
}

export interface PharmacyMembership {
  id: UUID
  pharmacy_id: UUID
  branch_id: UUID | null
  user_id: UUID
  role: MedicalRole
  is_active: boolean
  permissions: string[]
  denied_permissions?: string[]
  pharmacy?: PharmacySummary | null
  branch?: BranchSummary | null
}

export interface AuthScope {
  user: User | null
  session?: Session | null
  profile: UserProfile | null
  role: MedicalRole
  isDeveloper: boolean
  isOwner: boolean
  activePharmacyId: UUID | null
  activeBranchId: UUID | null
  activePharmacy: PharmacySummary | null
  activeBranch: BranchSummary | null
  memberships: PharmacyMembership[]
  branches: BranchSummary[]
}

export interface AuthResult {
  user: {
    id: string
    email: string | null
    displayName: string | null
    role: MedicalRole
    pharmacyId?: string | null
    branchId?: string | null
  } | null
  session?: Pick<Session, "access_token" | "refresh_token" | "expires_at" | "expires_in" | "token_type"> | null
}
