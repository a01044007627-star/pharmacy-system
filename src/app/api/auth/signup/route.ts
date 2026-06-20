import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { SUPER_ADMIN_ROLE } from "@/config/super-admin"
import { isDeveloperBootstrapEmail } from "@/lib/developer/bootstrap-authority"
import { DeveloperProvisioningService } from "@/lib/developer/developer-provisioning-service"

function getWriteClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      email,
      password,
      displayName,
      projectName,
      currency = "EGP",
      phone = null,
      country = "EG",
      city = null,
      timezone = "Africa/Cairo",
      username = null,
    } = body

    const developerBootstrap = isDeveloperBootstrapEmail(email)
    if (!email || !password || !displayName || (!developerBootstrap && !projectName)) {
      return NextResponse.json({ error: "بيانات إنشاء الحساب غير مكتملة" }, { status: 400 })
    }

    const supabase = await createClient()
    const role = developerBootstrap ? "no-access" : "owner"

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: displayName,
          display_name: displayName,
          project_name: projectName,
          currency,
          phone,
          country,
          city,
          timezone,
          username,
          role,
        },
      },
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data.user) return NextResponse.json({ user: null })

    if (developerBootstrap) {
      await DeveloperProvisioningService.fromEnvironment().provision(data.user)
      const meta = data.user.user_metadata ?? {}
      return NextResponse.json({
        user: {
          id: data.user.id,
          email: data.user.email,
          displayName: meta.display_name ?? meta.full_name ?? displayName,
          role: SUPER_ADMIN_ROLE,
          pharmacyId: null,
          branchId: null,
        },
        session: data.session ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
          token_type: data.session.token_type,
        } : null,
      })
    }

    const admin = getWriteClient(supabase)

    await admin.from("user_profiles").upsert({
      user_id: data.user.id,
      email,
      full_name: displayName,
      phone,
      username,
      global_role: role,
      is_active: true,
    }, { onConflict: "user_id" })

    const { data: pharmacy, error: pharmacyError } = await admin
      .from("pharmacies")
      .upsert({
        owner_id: data.user.id,
        name: projectName,
        legal_name: projectName,
        currency,
        country,
        timezone,
        phone,
        email,
        address: city,
        status: "active",
        plan: "trial",
      }, { onConflict: "owner_id" })
      .select("id")
      .single()

    if (pharmacyError) throw pharmacyError

    const { data: branch, error: branchError } = await admin
      .from("pharmacy_branches")
      .upsert({
        pharmacy_id: pharmacy.id,
        code: "MAIN",
        name: "الفرع الرئيسي",
        address: city,
        phone,
        is_default: true,
        status: "active",
      }, { onConflict: "pharmacy_id,code" })
      .select("id")
      .single()

    if (branchError) throw branchError

    await admin.from("pharmacy_profiles").upsert({
      pharmacy_id: pharmacy.id,
      branch_id: branch.id,
      user_id: data.user.id,
      email,
      full_name: displayName,
      role: "owner",
      is_active: true,
      permissions: [],
    }, { onConflict: "pharmacy_id,user_id" })

    const meta = data.user.user_metadata ?? {}
    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: meta.display_name ?? meta.full_name ?? displayName,
        role,
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
    console.error("signup failed", error)
    const message = error instanceof Error ? error.message : "فشل إنشاء حساب الصيدلية"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
