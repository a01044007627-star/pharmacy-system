import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { permissionErrorResponse } from "@/lib/auth/server-permissions"
import { requireDeveloperControlPlane, writeDeveloperAudit } from "@/lib/developer/server"
import { normalizeFeatureFlagName, parsePharmacyLifecycleUpdate, safeDeveloperAction } from "@/features/developer/control-plane"

type CountRow = { pharmacy_id: string | null }

function countByPharmacy(rows: CountRow[] | null) {
  const counts = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row.pharmacy_id) counts.set(row.pharmacy_id, (counts.get(row.pharmacy_id) ?? 0) + 1)
  }
  return counts
}

async function loadControlPlane(db: SupabaseClient) {
  const results = await Promise.all([
    db.from("pharmacies").select("id,owner_id,name,legal_name,status,plan,currency,timezone,email,phone,trial_ends_at,subscription_ends_at,max_branches,max_users,developer_notes,created_at,updated_at").order("created_at", { ascending: false }),
    db.from("pharmacy_branches").select("pharmacy_id").neq("status", "closed"),
    db.from("pharmacy_profiles").select("pharmacy_id").eq("is_active", true),
    db.from("developer_feature_flags").select("*").order("name"),
    db.from("developer_release_versions").select("*").order("created_at", { ascending: false }).limit(20),
    db.from("developer_error_events").select("id,pharmacy_id,level,message,url,resolved_at,created_at").order("created_at", { ascending: false }).limit(30),
    db.from("developer_audit_events").select("id,pharmacy_id,event_type,severity,description,metadata,created_at").order("created_at", { ascending: false }).limit(40),
    db.from("developer_health_checks").select("*").order("checked_at", { ascending: false }).limit(30),
    db.from("developer_impersonation_sessions").select("id,pharmacy_id,impersonated_user_id,reason,started_at,ended_at").is("ended_at", null).order("started_at", { ascending: false }),
  ])
  const [pharmaciesResult, branchesResult, usersResult, flagsResult, releasesResult, errorsResult, auditsResult, healthResult, supportResult] = results
  for (const result of results) if (result.error) throw result.error

  const branchCounts = countByPharmacy(branchesResult.data)
  const userCounts = countByPharmacy(usersResult.data)
  const pharmacies = (pharmaciesResult.data ?? []).map((pharmacy) => ({
    ...pharmacy,
    branches_count: branchCounts.get(pharmacy.id) ?? 0,
    users_count: userCounts.get(pharmacy.id) ?? 0,
  }))
  const now = Date.now()

  return {
    summary: {
      pharmacies: pharmacies.length,
      active: pharmacies.filter((row) => row.status === "active").length,
      suspended: pharmacies.filter((row) => row.status === "suspended").length,
      trials: pharmacies.filter((row) => row.plan === "trial").length,
      expiring_soon: pharmacies.filter((row) => {
        const raw = row.plan === "trial" ? row.trial_ends_at : row.subscription_ends_at
        const remaining = raw ? new Date(raw).getTime() - now : -1
        return remaining >= 0 && remaining <= 14 * 86400000
      }).length,
      open_errors: (errorsResult.data ?? []).filter((row) => !row.resolved_at).length,
      active_support_sessions: (supportResult.data ?? []).length,
    },
    pharmacies,
    featureFlags: flagsResult.data ?? [],
    releases: releasesResult.data ?? [],
    errors: errorsResult.data ?? [],
    audits: auditsResult.data ?? [],
    healthChecks: healthResult.data ?? [],
    supportSessions: supportResult.data ?? [],
    environment: {
      node: process.version,
      vercel: Boolean(process.env.VERCEL),
      region: process.env.VERCEL_REGION ?? null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      uploadConfigured: Boolean(process.env.UPLOADTHING_TOKEN || process.env.UPLOADTHING_SECRET),
    },
    generatedAt: new Date().toISOString(),
  }
}

export async function GET() {
  try {
    const { db } = await requireDeveloperControlPlane()
    return NextResponse.json(await loadControlPlane(db))
  } catch (error) {
    const permissionResponse = permissionErrorResponse(error)
    if (permissionResponse) return permissionResponse
    console.error("developer control plane GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل لوحة المنصة" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = safeDeveloperAction(body.action)
    const { db, developer, scope } = await requireDeveloperControlPlane()

    if (action === "onboard_client") {
      const payload = body.payload ?? {}
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
      const ownerName = typeof payload.owner_name === "string" ? payload.owner_name.trim() : ""
      const pharmacyName = typeof payload.pharmacy_name === "string" ? payload.pharmacy_name.trim() : ""
      const password = typeof payload.password === "string" ? payload.password.trim() : ""
      const plan = typeof payload.plan === "string" ? payload.plan : "trial"
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ownerName || !pharmacyName) {
        return NextResponse.json({ error: "اسم المالك واسم الصيدلية وبريد صالح مطلوبون" }, { status: 400 })
      }
      const lifecycle = parsePharmacyLifecycleUpdate({
        status: "active", plan,
        max_branches: payload.max_branches ?? 3,
        max_users: payload.max_users ?? 10,
        trial_ends_at: plan === "trial" ? (payload.trial_ends_at ?? new Date(Date.now() + 14 * 86400000).toISOString()) : null,
        subscription_ends_at: payload.subscription_ends_at ?? null,
        developer_notes: payload.developer_notes ?? null,
      })

      let createdUserId: string | null = null
      try {
        const authResult = password
          ? await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: ownerName, role: "owner" } })
          : await db.auth.admin.inviteUserByEmail(email, { data: { full_name: ownerName, role: "owner" } })
        if (authResult.error) throw authResult.error
        createdUserId = authResult.data.user.id

        const { data: pharmacy, error: pharmacyError } = await db.from("pharmacies").insert({
          owner_id: createdUserId,
          name: pharmacyName,
          legal_name: typeof payload.legal_name === "string" ? payload.legal_name.trim() || pharmacyName : pharmacyName,
          currency: typeof payload.currency === "string" ? payload.currency : "EGP",
          country: typeof payload.country === "string" ? payload.country : "EG",
          timezone: typeof payload.timezone === "string" ? payload.timezone : "Africa/Cairo",
          phone: typeof payload.phone === "string" ? payload.phone.trim() || null : null,
          email,
          address: typeof payload.address === "string" ? payload.address.trim() || null : null,
          ...lifecycle,
        }).select("*").single()
        if (pharmacyError) throw pharmacyError

        const { data: branch, error: branchError } = await db.from("pharmacy_branches").insert({
          pharmacy_id: pharmacy.id, code: "MAIN", name: "الفرع الرئيسي",
          address: pharmacy.address, phone: pharmacy.phone, is_default: true, status: "active",
        }).select("*").single()
        if (branchError) throw branchError

        const profileResults = await Promise.all([
          db.from("user_profiles").upsert({
            user_id: createdUserId, email, full_name: ownerName, global_role: "owner", is_active: true,
          }, { onConflict: "user_id" }),
          db.from("pharmacy_profiles").upsert({
            pharmacy_id: pharmacy.id, branch_id: branch.id, user_id: createdUserId,
            email, full_name: ownerName, role: "owner", is_active: true, permissions: [],
            invite_status: password ? "created" : "invited",
            invitation_sent_at: password ? null : new Date().toISOString(),
            invited_by: scope.user!.id,
          }, { onConflict: "pharmacy_id,user_id" }),
        ])
        const profileError = profileResults.find((result) => result.error)?.error
        if (profileError) throw profileError

        await writeDeveloperAudit(db, {
          developerId: developer.id, pharmacyId: pharmacy.id,
          eventType: "platform.client.onboarded",
          description: `تم إنشاء عميل جديد: ${pharmacyName}`,
          metadata: { owner_user_id: createdUserId, email, plan, invitation: !password }, request,
        })
        return NextResponse.json({ pharmacy, branch, ownerUserId: createdUserId }, { status: 201 })
      } catch (error) {
        if (createdUserId) await db.auth.admin.deleteUser(createdUserId).catch(() => undefined)
        throw error
      }
    }

    if (action === "update_pharmacy") {
      if (!body.pharmacy_id) return NextResponse.json({ error: "معرف الصيدلية مطلوب" }, { status: 400 })
      const updates = parsePharmacyLifecycleUpdate(body.payload ?? {})
      const { data, error } = await db.from("pharmacies").update(updates).eq("id", body.pharmacy_id).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, {
        developerId: developer.id, pharmacyId: body.pharmacy_id,
        eventType: "platform.pharmacy.updated",
        severity: updates.status === "suspended" || updates.status === "closed" ? "warning" : "info",
        description: `تم تحديث دورة العميل ${data.name}`,
        metadata: { updates, actor_user_id: scope.user!.id }, request,
      })
      return NextResponse.json({ pharmacy: data })
    }

    if (action === "upsert_feature_flag") {
      const name = normalizeFeatureFlagName(body.payload?.name)
      const payload = {
        name,
        description: typeof body.payload?.description === "string" ? body.payload.description.trim() || null : null,
        enabled: Boolean(body.payload?.enabled),
        conditions: body.payload?.conditions && typeof body.payload.conditions === "object" ? body.payload.conditions : {},
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await db.from("developer_feature_flags").upsert(payload, { onConflict: "name" }).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, { developerId: developer.id, eventType: "platform.feature-flag.updated", description: `تم تحديث مفتاح الميزة ${name}`, metadata: payload, request })
      return NextResponse.json({ featureFlag: data })
    }

    if (action === "resolve_error") {
      if (!body.error_id) return NextResponse.json({ error: "معرف الخطأ مطلوب" }, { status: 400 })
      const { data, error } = await db.from("developer_error_events")
        .update({ resolved_at: new Date().toISOString(), resolved_by: developer.id })
        .eq("id", body.error_id).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, { developerId: developer.id, pharmacyId: data.pharmacy_id, eventType: "platform.error.resolved", description: "تم إغلاق خطأ من لوحة المنصة", metadata: { error_id: data.id }, request })
      return NextResponse.json({ errorEvent: data })
    }

    if (action === "publish_release") {
      const version = typeof body.payload?.version === "string" ? body.payload.version.trim() : ""
      const title = typeof body.payload?.title === "string" ? body.payload.title.trim() : ""
      if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version) || !title) {
        return NextResponse.json({ error: "رقم إصدار SemVer وعنوان الإصدار مطلوبان" }, { status: 400 })
      }
      if (body.payload?.is_active) await db.from("developer_release_versions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("is_active", true)
      const { data, error } = await db.from("developer_release_versions").insert({
        version, title,
        changelog: typeof body.payload?.changelog === "string" ? body.payload.changelog.trim() || null : null,
        min_app_version: typeof body.payload?.min_app_version === "string" ? body.payload.min_app_version.trim() || null : null,
        is_required: Boolean(body.payload?.is_required),
        is_active: Boolean(body.payload?.is_active),
        published_at: body.payload?.is_active ? new Date().toISOString() : null,
      }).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, { developerId: developer.id, eventType: "platform.release.published", description: `تم إنشاء الإصدار ${version}`, metadata: { release_id: data.id, active: data.is_active }, request })
      return NextResponse.json({ release: data }, { status: 201 })
    }

    if (action === "start_support_session") {
      const pharmacyId = typeof body.pharmacy_id === "string" ? body.pharmacy_id : ""
      const reason = typeof body.reason === "string" ? body.reason.trim() : ""
      if (!pharmacyId || reason.length < 8) return NextResponse.json({ error: "الصيدلية وسبب دعم واضح مطلوبان" }, { status: 400 })
      await db.from("developer_impersonation_sessions").update({ ended_at: new Date().toISOString() }).eq("developer_id", developer.id).is("ended_at", null)
      const { data, error } = await db.from("developer_impersonation_sessions").insert({
        developer_id: developer.id,
        impersonated_user_id: scope.user!.id,
        pharmacy_id: pharmacyId,
        reason,
      }).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, { developerId: developer.id, pharmacyId, eventType: "platform.support-session.started", severity: "warning", description: "تم فتح سياق دعم لصيدلية", metadata: { session_id: data.id, reason }, request })
      return NextResponse.json({ supportSession: data })
    }

    if (action === "end_support_session") {
      if (!body.session_id) return NextResponse.json({ error: "معرف جلسة الدعم مطلوب" }, { status: 400 })
      const { data, error } = await db.from("developer_impersonation_sessions").update({ ended_at: new Date().toISOString() })
        .eq("id", body.session_id).eq("developer_id", developer.id).select("*").single()
      if (error) throw error
      await writeDeveloperAudit(db, { developerId: developer.id, pharmacyId: data.pharmacy_id, eventType: "platform.support-session.ended", description: "تم إنهاء سياق دعم الصيدلية", metadata: { session_id: data.id }, request })
      return NextResponse.json({ supportSession: data })
    }

    const service = typeof body.payload?.service === "string" ? body.payload.service.trim() : "application"
    const metric = typeof body.payload?.metric === "string" ? body.payload.metric.trim() : "manual_check"
    const value = Number(body.payload?.value ?? 1)
    const status = ["healthy", "warning", "critical"].includes(body.payload?.status) ? body.payload.status : "healthy"
    if (!service || !metric || !Number.isFinite(value)) return NextResponse.json({ error: "بيانات فحص الصحة غير صالحة" }, { status: 400 })
    const { data, error } = await db.from("developer_health_checks").insert({ service, metric, value, unit: body.payload?.unit ?? "", status }).select("*").single()
    if (error) throw error
    await writeDeveloperAudit(db, { developerId: developer.id, eventType: "platform.health-check.recorded", severity: status === "critical" ? "critical" : status === "warning" ? "warning" : "info", description: `تم تسجيل فحص ${service}/${metric}`, metadata: { value, status }, request })
    return NextResponse.json({ healthCheck: data }, { status: 201 })
  } catch (error) {
    const permissionResponse = permissionErrorResponse(error)
    if (permissionResponse) return permissionResponse
    console.error("developer control plane POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تنفيذ إجراء المطور" }, { status: 400 })
  }
}
