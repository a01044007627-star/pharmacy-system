import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

type PharmacyRouteContext = { params: Promise<{ pharmacyId: string }> }

async function getPharmacyId(params: Promise<{ pharmacyId: string }>) {
  return (await params).pharmacyId
}

export async function GET(_request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) {
      return NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 })
    }
    if (!scopeCan(scope, "branches:read")) {
      return NextResponse.json({ error: "ليست لديك صلاحية عرض الفروع" }, { status: 403 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { data, error } = await db
      .from("pharmacy_branches")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
    if (error) throw error
    return NextResponse.json({ branches: data ?? [] })
  } catch (error) {
    console.error("branches GET failed", error)
    return NextResponse.json({ error: "فشل تحميل الفروع" }, { status: 500 })
  }
}

export async function POST(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) {
      return NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 })
    }
    if (!scopeCan(scope, "branches:write")) {
      return NextResponse.json({ error: "ليست لديك صلاحية إدارة الفروع" }, { status: 403 })
    }

    const body = await request.json()
    const supabase = await createClient()
    const db = getDbClient(supabase)

    if (body.is_default) {
      await db.from("pharmacy_branches").update({ is_default: false }).eq("pharmacy_id", pharmacyId)
    }

    const { data, error } = await db
      .from("pharmacy_branches")
      .insert({
        pharmacy_id: pharmacyId,
        code: body.code,
        name: body.name,
        address: body.address ?? null,
        phone: body.phone ?? null,
        manager_name: body.manager_name ?? null,
        is_default: Boolean(body.is_default),
        status: body.status ?? "active",
      })
      .select("*")
      .single()
    if (error) throw error

    return NextResponse.json({ branch: data }, { status: 201 })
  } catch (error) {
    console.error("branches POST failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء الفرع"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) {
      return NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 })
    }
    if (!scopeCan(scope, "branches:write")) {
      return NextResponse.json({ error: "ليست لديك صلاحية تعديل الفروع" }, { status: 403 })
    }

    const body = await request.json()
    if (!body.id) return NextResponse.json({ error: "معرف الفرع مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase)

    if (body.is_default === true) {
      await db.from("pharmacy_branches").update({ is_default: false }).eq("pharmacy_id", pharmacyId)
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    for (const key of ["code", "name", "address", "phone", "manager_name", "status"] as const) {
      if (key in body) updates[key] = body[key]
    }
    if ("is_default" in body) updates.is_default = Boolean(body.is_default)

    const { data, error } = await db
      .from("pharmacy_branches")
      .update(updates)
      .eq("pharmacy_id", pharmacyId)
      .eq("id", body.id)
      .select("*")
      .single()
    if (error) throw error

    return NextResponse.json({ branch: data })
  } catch (error) {
    console.error("branches PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل الفرع"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) {
      return NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 })
    }
    if (!scopeCan(scope, "branches:delete")) {
      return NextResponse.json({ error: "ليست لديك صلاحية إيقاف الفروع" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get("branch_id")
    if (!branchId) return NextResponse.json({ error: "معرف الفرع مطلوب" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { data, error } = await db
      .from("pharmacy_branches")
      .update({ status: "closed", is_default: false, updated_at: new Date().toISOString() })
      .eq("pharmacy_id", pharmacyId)
      .eq("id", branchId)
      .select("*")
      .single()
    if (error) throw error

    return NextResponse.json({ branch: data })
  } catch (error) {
    console.error("branches DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل إيقاف الفرع"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
