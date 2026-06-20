import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { SUPER_ADMIN_ROLE } from "@/config/super-admin"
import { DeveloperProvisioningService } from "@/lib/developer/developer-provisioning-service"
import { isDeveloperBootstrapEmail } from "@/lib/developer/bootstrap-authority"
import { getServerAuthScope } from "@/lib/auth/session"

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: "البريد الإلكتروني وكلمة المرور مطلوبين" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return NextResponse.json({ error: error.message }, { status: 401 })

    const meta = data.user.user_metadata ?? {}
    if (isDeveloperBootstrapEmail(data.user.email)) {
      await DeveloperProvisioningService.fromEnvironment().provision(data.user)
    }
    const scope = await getServerAuthScope()

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: meta.display_name ?? meta.full_name ?? scope.profile?.full_name ?? null,
        role: scope.isDeveloper ? SUPER_ADMIN_ROLE : scope.role,
        pharmacyId: scope.activePharmacyId,
        branchId: scope.activeBranchId,
      },
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in,
        token_type: data.session.token_type,
      } : null,
    })
  } catch (error) {
    console.error("login failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "طلب غير صالح" }, { status: 400 })
  }
}
