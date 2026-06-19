import type { MedicalRole } from "@/types"
import type { Permission } from "@/lib/auth/permissions"

export type UserStatusFilter = "all" | "active" | "inactive"

export type PharmacyUser = {
  id: string
  pharmacy_id: string
  branch_id: string | null
  user_id: string
  email: string | null
  full_name: string | null
  phone: string | null
  title: string | null
  role: MedicalRole
  is_active: boolean
  disabled_reason?: string | null
  permissions: Permission[]
  denied_permissions: Permission[]
  created_at?: string
  updated_at?: string
  branch?: { id?: string | null; name?: string | null; code?: string | null; status?: string | null } | null
  pharmacy?: { id?: string | null; name?: string | null; legal_name?: string | null } | null
  user_profile?: {
    email?: string | null
    full_name?: string | null
    phone?: string | null
    avatar_url?: string | null
    global_role?: string | null
    is_active?: boolean | null
  } | null
}

export type UserFormValues = {
  user_id?: string
  email: string
  password: string
  full_name: string
  phone: string
  title: string
  role: MedicalRole
  branch_id: string | null
  is_active: boolean
  permissions: Permission[]
  denied_permissions: Permission[]
}
