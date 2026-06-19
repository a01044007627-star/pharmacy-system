import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    return NextResponse.json({
      user: {
        id: scope.user.id,
        email: scope.user.email ?? null,
        metadata: scope.user.user_metadata ?? {},
      },
      profile: scope.profile,
      role: scope.role,
      activePharmacy: scope.activePharmacy,
      activeBranch: scope.activeBranch,
      memberships: scope.memberships,
    })
  } catch (error) {
    console.error("profile GET failed", error)
    return NextResponse.json({ error: "فشل تحميل الملف الشخصي" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const fullName = clean(body.full_name)
    const username = clean(body.username).toLowerCase().replace(/[^a-z0-9_.-]/g, "")
    const phone = clean(body.phone)
    const avatarUrl = clean(body.avatar_url)

    const supabase = await createClient()
    const db = getDbClient(supabase)

    const payload = {
      user_id: scope.user.id,
      email: scope.user.email ?? (clean(body.email) || null),
      username: username || null,
      full_name: fullName || null,
      phone: phone || null,
      avatar_url: avatarUrl || null,
      global_role: scope.role,
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    const { data: profile, error } = await db
      .from("user_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .maybeSingle()
    if (error) throw error

    try {
      const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
      if (admin) {
        await admin.auth.admin.updateUserById(scope.user.id, {
          user_metadata: {
            ...(scope.user.user_metadata ?? {}),
            username: username || scope.user.user_metadata?.username,
            full_name: fullName || scope.user.user_metadata?.full_name,
            phone: phone || scope.user.user_metadata?.phone,
            avatar_url: avatarUrl || scope.user.user_metadata?.avatar_url,
          },
        })
      }
    } catch (metadataError) {
      console.warn("profile metadata update skipped", metadataError)
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error("profile PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ الملف الشخصي"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
