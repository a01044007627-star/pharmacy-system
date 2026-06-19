import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function GET() {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })

    const supabase = await createClient()
    const db = getDbClient(supabase)

    if (scope.isDeveloper) {
      const { data, error } = await db
        .from("pharmacies")
        .select("id, owner_id, name, legal_name, status, plan, currency, timezone, phone, email, address, created_at, updated_at")
        .order("created_at", { ascending: false })
      if (error) throw error
      return NextResponse.json({ pharmacies: data ?? [] })
    }

    const pharmacyIds = new Set<string>()
    if (scope.activePharmacyId) pharmacyIds.add(scope.activePharmacyId)
    for (const membership of scope.memberships) pharmacyIds.add(membership.pharmacy_id)

    if (pharmacyIds.size === 0) return NextResponse.json({ pharmacies: [] })

    const { data, error } = await db
      .from("pharmacies")
      .select("id, owner_id, name, legal_name, status, plan, currency, timezone, phone, email, address, created_at, updated_at")
      .in("id", Array.from(pharmacyIds))
      .order("created_at", { ascending: false })
    if (error) throw error

    return NextResponse.json({ pharmacies: data ?? [] })
  } catch (error) {
    console.error("pharmacies GET failed", error)
    return NextResponse.json({ error: "فشل تحميل بيانات الصيدليات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.isDeveloper && scope.role !== "owner") {
      return NextResponse.json({ error: "ليست لديك صلاحية إنشاء صيدلية" }, { status: 403 })
    }

    const body = await request.json()
    const supabase = await createClient()
    const db = getDbClient(supabase)
    const ownerId = scope.isDeveloper && body.owner_id ? body.owner_id : scope.user.id

    const { data: pharmacy, error } = await db
      .from("pharmacies")
      .insert({
        owner_id: ownerId,
        name: body.name,
        legal_name: body.legal_name ?? body.name,
        tax_id: body.tax_id ?? null,
        commercial_registry: body.commercial_registry ?? null,
        status: body.status ?? "active",
        plan: body.plan ?? "trial",
        currency: body.currency ?? "EGP",
        country: body.country ?? "EG",
        timezone: body.timezone ?? "Africa/Cairo",
        phone: body.phone ?? null,
        email: body.email ?? null,
        address: body.address ?? null,
      })
      .select("*")
      .single()
    if (error) throw error

    const { data: branch, error: branchError } = await db
      .from("pharmacy_branches")
      .insert({
        pharmacy_id: pharmacy.id,
        code: "MAIN",
        name: "الفرع الرئيسي",
        address: body.address ?? null,
        phone: body.phone ?? null,
        is_default: true,
        status: "active",
      })
      .select("*")
      .single()
    if (branchError) throw branchError

    await db.from("pharmacy_profiles").upsert({
      pharmacy_id: pharmacy.id,
      branch_id: branch.id,
      user_id: ownerId,
      role: "owner",
      is_active: true,
      permissions: [],
    }, { onConflict: "pharmacy_id,user_id" })

    return NextResponse.json({ pharmacy, branch }, { status: 201 })
  } catch (error) {
    console.error("pharmacies POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء الصيدلية"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
