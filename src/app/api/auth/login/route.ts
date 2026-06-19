import { NextResponse } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSuperAdmin, SUPER_ADMIN_ROLE } from "@/config/super-admin"
import { getServerAuthScope } from "@/lib/auth/session"

function getAdminClient(): SupabaseClient | null {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
    return createAdminClient() as SupabaseClient
  } catch {
    return null
  }
}

async function ensureDeveloperAccess(user: User) {
  if (!isSuperAdmin(user.email)) return

  const admin = getAdminClient()
  if (!admin) return

  const email = user.email ?? ""
  const meta = user.user_metadata ?? {}
  const fullName = (meta.full_name ?? meta.display_name ?? "Mostafa Falcon") as string

  await Promise.allSettled([
    admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...meta,
        full_name: fullName,
        display_name: fullName,
        role: SUPER_ADMIN_ROLE,
      },
    }),
    admin.from("user_profiles").upsert({
      user_id: user.id,
      email,
      full_name: fullName,
      global_role: SUPER_ADMIN_ROLE,
      is_active: true,
    }, { onConflict: "user_id" }),
    admin.from("developer_users").upsert({
      user_id: user.id,
      role: "super_admin",
      is_active: true,
      permissions: ["system:all"],
    }, { onConflict: "user_id" }),
  ])
}

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
    const role = isSuperAdmin(data.user.email) ? SUPER_ADMIN_ROLE : (meta.role ?? "no-access")

    if (role === SUPER_ADMIN_ROLE && meta.role !== SUPER_ADMIN_ROLE) {
      await supabase.auth.updateUser({ data: { ...meta, role: SUPER_ADMIN_ROLE } })
    }

    await ensureDeveloperAccess(data.user)

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
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 })
  }
}
