import { NextResponse } from "next/server"
import { getServerAuthScope } from "@/lib/auth/session"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id"),
    })

    if (!scope.user) {
      return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: scope.user.id,
        email: scope.user.email,
        user_metadata: scope.user.user_metadata,
      },
      profile: scope.profile,
      role: scope.role,
      isDeveloper: scope.isDeveloper,
      isOwner: scope.isOwner,
      activePharmacyId: scope.activePharmacyId,
      activeBranchId: scope.activeBranchId,
      activePharmacy: scope.activePharmacy,
      activeBranch: scope.activeBranch,
      memberships: scope.memberships,
      branches: scope.branches,
    })
  } catch (error) {
    console.error("auth/me failed", error)
    return NextResponse.json({ error: "فشل قراءة بيانات المستخدم والصلاحيات" }, { status: 500 })
  }
}
