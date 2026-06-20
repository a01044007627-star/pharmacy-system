import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { isFeatureFlagEnabled } from "@/features/developer/control-plane"

export async function GET() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "إعدادات المنصة غير مكتملة" }, { status: 503 })

    const db = createAdminClient()
    const [{ data: flags, error: flagsError }, { data: release, error: releaseError }] = await Promise.all([
      db.from("developer_feature_flags").select("name,enabled,conditions").order("name"),
      db.from("developer_release_versions").select("version,title,changelog,min_app_version,is_required,published_at").eq("is_active", true).order("published_at", { ascending: false }).limit(1).maybeSingle(),
    ])
    if (flagsError) throw flagsError
    if (releaseError) throw releaseError

    const context = { pharmacyId: scope.activePharmacyId, plan: scope.activePharmacy?.plan }
    const featureFlags = Object.fromEntries((flags ?? []).map((flag) => [
      flag.name,
      isFeatureFlagEnabled(flag, context),
    ]))

    return NextResponse.json({
      featureFlags,
      release: release ?? null,
      pharmacyStatus: scope.activePharmacy?.status ?? null,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, max-age=60" } })
  } catch (error) {
    console.error("platform config GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل إعدادات المنصة" }, { status: 500 })
  }
}
