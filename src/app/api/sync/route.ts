import { NextResponse } from "next/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "sync:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const online = url.searchParams.get("status") !== "0"
    return NextResponse.json({
      status: online ? "online" : "offline",
      last_sync: new Date().toISOString(),
      pending_changes: 0,
      tables: { items: true, sales: true, purchases: true, inventory: true },
      note: "المزامنة المحلية تتم من المتصفح نفسه، ومبيعات الكاشير الأوفلاين تتم مزامنتها تلقائيًا من شاشة الكاشير عند رجوع الاتصال.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حالة المزامنة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scopeCan(scope, "sync:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    return NextResponse.json({
      message: "الخادم جاهز. مزامنة مبيعات الكاشير الأوفلاين تتم تلقائيًا من شاشة الكاشير عند رجوع الاتصال.",
      synced_at: new Date().toISOString(),
      tables: ["items", "sales", "purchases", "inventory"],
      duration_ms: 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشلت المزامنة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
