import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { developerReviewConfig } from "@/config/developer-review"

export async function POST() {
  if (!developerReviewConfig.enabled) {
    return NextResponse.json({ error: "تسجيل دخول المطور غير مفعل" }, { status: 403 })
  }

  if (!developerReviewConfig.email || !developerReviewConfig.password) {
    return NextResponse.json({ error: "بيانات المطور غير مكتملة في الإعدادات" }, { status: 500 })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: developerReviewConfig.email,
      password: developerReviewConfig.password,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 401 })

    const scope = await getServerAuthScope()
    if (!scope.isDeveloper) {
      await supabase.auth.signOut()
      return NextResponse.json({ error: "الحساب غير مسجل كمطور فعال في المنصة" }, { status: 403 })
    }

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: developerReviewConfig.name,
        role: "developer",
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
  } catch (err) {
    console.error("developer-login failed", err)
    return NextResponse.json({ error: "فشل تسجيل دخول المطور" }, { status: 500 })
  }
}
