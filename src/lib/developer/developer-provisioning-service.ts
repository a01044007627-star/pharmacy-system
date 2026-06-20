import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"
import { SUPER_ADMIN_ROLE } from "@/config/super-admin"
import { createAdminClient } from "@/lib/supabase/admin"
import { isDeveloperBootstrapEmail } from "./bootstrap-authority"

/**
 * Server-only application service for the one-time developer bootstrap.
 * Runtime authorization still comes exclusively from developer_users.
 */
export class DeveloperProvisioningService {
  private constructor(private readonly admin: SupabaseClient) {}

  static fromEnvironment(): DeveloperProvisioningService {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("تعذر تهيئة حساب المطور: مفتاح Service Role غير متاح")
    }
    return new DeveloperProvisioningService(createAdminClient() as SupabaseClient)
  }

  isBootstrapCandidate(user: Pick<User, "email">): boolean {
    return isDeveloperBootstrapEmail(user.email)
  }

  async provisionIfConfigured(user: User): Promise<boolean> {
    if (!this.isBootstrapCandidate(user)) return false
    await this.provision(user)
    return true
  }

  async provision(user: User): Promise<void> {
    const email = user.email ?? ""
    const metadata = user.user_metadata ?? {}
    const fullName = String(
      metadata.full_name ?? metadata.display_name ?? email.split("@")[0] ?? "Platform Developer",
    )

    const { error: developerError } = await this.admin.from("developer_users").upsert({
      user_id: user.id,
      role: "super_admin",
      is_active: true,
      permissions: ["system:all"],
    }, { onConflict: "user_id" })
    if (developerError) throw developerError

    const { error: profileError } = await this.admin.from("user_profiles").upsert({
      user_id: user.id,
      email,
      full_name: fullName,
      global_role: SUPER_ADMIN_ROLE,
      is_active: true,
    }, { onConflict: "user_id" })
    if (profileError) throw profileError

    // A developer is a platform principal, never a pharmacy/branch member.
    const { error: membershipError } = await this.admin
      .from("pharmacy_profiles")
      .delete()
      .eq("user_id", user.id)
    if (membershipError) throw membershipError

    const { error: metadataError } = await this.admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        full_name: fullName,
        display_name: fullName,
        role: SUPER_ADMIN_ROLE,
      },
    })
    if (metadataError) throw metadataError
  }
}
