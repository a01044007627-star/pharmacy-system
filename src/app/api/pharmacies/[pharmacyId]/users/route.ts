import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, scopeCan } from "@/lib/auth/server-permissions"
import { normalizeRole, sanitizePermissionList, type Permission } from "@/lib/auth/permissions"
import type { MedicalRole } from "@/types"

const assignableRoles: MedicalRole[] = ["admin", "manager", "accountant", "pharmacist", "cashier", "technician", "worker", "viewer", "no-access"]

type PharmacyRouteContext = { params: Promise<{ pharmacyId: string }> }

type MembershipRow = {
  id: string
  pharmacy_id: string
  branch_id: string | null
  user_id: string
  role: string
  is_active: boolean
  permissions: unknown
  denied_permissions?: unknown
  email: string | null
  full_name: string | null
  phone: string | null
  title: string | null
  disabled_reason?: string | null
  created_at: string
  updated_at: string
  branch?: { id?: string | null; name?: string | null; code?: string | null; status?: string | null } | Array<{ id?: string | null; name?: string | null; code?: string | null; status?: string | null }> | null
}

type UserProfileRow = {
  user_id: string
  email: string
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  global_role: string
  is_active: boolean
}

type UserBody = {
  user_id?: string
  email?: string | null
  password?: string | null
  full_name?: string | null
  phone?: string | null
  title?: string | null
  branch_id?: string | null
  role?: string | null
  is_active?: boolean
  permissions?: unknown
  denied_permissions?: unknown
  send_invite?: boolean
  disabled_reason?: string | null
}

async function getPharmacyId(params: Promise<{ pharmacyId: string }>) {
  return (await params).pharmacyId
}

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function sanitizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return []
  return sanitizePermissionList(value.filter((permission): permission is string => typeof permission === "string"))
}

function canManageUsers(scope: Awaited<ReturnType<typeof getServerAuthScope>>) {
  return scope.isDeveloper || scope.isOwner || scopeCan(scope, "users:write")
}

function canDeleteUsers(scope: Awaited<ReturnType<typeof getServerAuthScope>>) {
  return scope.isDeveloper || scope.isOwner || scopeCan(scope, "users:delete")
}

function normalizeBranch(branch: MembershipRow["branch"]) {
  if (Array.isArray(branch)) return branch[0] ?? null
  return branch ?? null
}

async function assertBranchInPharmacy(db: ReturnType<typeof getDbClient>, pharmacyId: string, branchId: string | null | undefined) {
  if (!branchId) return
  const { data, error } = await db
    .from("pharmacy_branches")
    .select("id")
    .eq("pharmacy_id", pharmacyId)
    .eq("id", branchId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("الفرع المحدد غير تابع لهذه الصيدلية")
}

async function writeAudit(
  db: ReturnType<typeof getDbClient>,
  input: { pharmacyId: string; actorId: string; event: string; description: string; metadata?: Record<string, unknown> },
) {
  await db.from("pharmacy_audit_events").insert({
    pharmacy_id: input.pharmacyId,
    actor_id: input.actorId,
    event_type: input.event,
    severity: "info",
    source: "users",
    description: input.description,
    metadata: input.metadata ?? {},
  }).then(() => undefined, () => undefined)
}

async function notifyUserManagers(
  db: ReturnType<typeof getDbClient>,
  input: { pharmacyId: string; actorId: string; title: string; description: string; href?: string },
) {
  const { data } = await db
    .from("pharmacy_profiles")
    .select("user_id, role, is_active")
    .eq("pharmacy_id", input.pharmacyId)
    .eq("is_active", true)
    .in("role", ["owner", "admin", "manager"])

  const rows = Array.from(new Set(((data ?? []) as Array<{ user_id?: string | null }>).map((row) => row.user_id).filter(Boolean)))
    .filter((userId): userId is string => Boolean(userId) && userId !== input.actorId)
    .map((userId) => ({
      user_id: userId,
      title: input.title,
      description: input.description,
      notif_type: "info",
      href: input.href ?? "/dashboard/users",
    }))

  if (rows.length > 0) {
    await db.from("pharmacy_inapp_notifications").insert(rows).then(() => undefined, () => undefined)
  }
}

async function readProfile(db: ReturnType<typeof getDbClient>, userId: string): Promise<UserProfileRow | null> {
  const { data, error } = await db
    .from("user_profiles")
    .select("user_id, email, full_name, phone, avatar_url, global_role, is_active")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as UserProfileRow | null
}

async function upsertUserProfile(db: ReturnType<typeof getDbClient>, userId: string, body: UserBody, role: MedicalRole, fallbackEmail?: string | null) {
  const email = cleanText(body.email) ?? fallbackEmail ?? null
  if (!email) return
  const existing = await readProfile(db, userId)
  const { error } = await db.from("user_profiles").upsert({
    user_id: userId,
    email,
    full_name: cleanText(body.full_name) ?? existing?.full_name ?? null,
    phone: cleanText(body.phone) ?? existing?.phone ?? null,
    global_role: role,
    is_active: body.is_active ?? existing?.is_active ?? true,
  }, { onConflict: "user_id" })
  if (error) throw error
}

async function resolveScope(pharmacyId: string) {
  const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
  if (!scope.user) return { scope, response: NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 }) }
  if (!scope.isDeveloper && scope.activePharmacyId !== pharmacyId) {
    return { scope, response: NextResponse.json({ error: "لا تملك صلاحية على هذه الصيدلية" }, { status: 403 }) }
  }
  return { scope, response: null }
}

export async function GET(_request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const { scope, response } = await resolveScope(pharmacyId)
    if (response) return response
    if (!scopeCan(scope, "users:read")) {
      return NextResponse.json({ error: "ليست لديك صلاحية عرض المستخدمين" }, { status: 403 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { data: memberships, error } = await db
      .from("pharmacy_profiles")
      .select(`
        id, pharmacy_id, branch_id, user_id, role, is_active, permissions, denied_permissions, email, full_name, phone, title, disabled_reason, created_at, updated_at,
        branch:pharmacy_branches(id, name, code, status)
      `)
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: true })
    if (error) throw error

    let membershipRows = (memberships ?? []) as MembershipRow[]
    if (isBranchScoped(scope)) {
      membershipRows = membershipRows.filter((membership) => !membership.branch_id || membership.branch_id === scope.activeBranchId || membership.user_id === scope.user!.id)
    }
    const userIds = Array.from(new Set(membershipRows.map((membership) => membership.user_id).filter(Boolean)))
    const { data: profiles, error: profilesError } = userIds.length
      ? await db.from("user_profiles").select("user_id, email, full_name, phone, avatar_url, global_role, is_active").in("user_id", userIds)
      : { data: [], error: null }
    if (profilesError) throw profilesError

    const profilesByUserId = new Map(((profiles ?? []) as UserProfileRow[]).map((profile) => [profile.user_id, profile]))
    const users = membershipRows.map((membership) => ({
      ...membership,
      role: normalizeRole(membership.role),
      permissions: sanitizePermissions(membership.permissions),
      denied_permissions: sanitizePermissions(membership.denied_permissions),
      branch: normalizeBranch(membership.branch),
      user_profile: profilesByUserId.get(membership.user_id) ?? null,
    }))

    return NextResponse.json({ users })
  } catch (error) {
    console.error("pharmacy users GET failed", error)
    return NextResponse.json({ error: "فشل تحميل مستخدمي الصيدلية" }, { status: 500 })
  }
}

export async function POST(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const { scope, response } = await resolveScope(pharmacyId)
    if (response) return response
    if (!canManageUsers(scope)) {
      return NextResponse.json({ error: "ليست لديك صلاحية إضافة المستخدمين" }, { status: 403 })
    }

    const body = (await request.json()) as UserBody
    const role = normalizeRole(body.role)
    if (!assignableRoles.includes(role)) {
      return NextResponse.json({ error: "الدور المطلوب غير مسموح داخل الصيدلية" }, { status: 400 })
    }

    const branchId = cleanText(body.branch_id)
    const supabase = await createClient()
    const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
    const db = getDbClient(supabase)
    assertBranchScope(scope, branchId)
    await assertBranchInPharmacy(db, pharmacyId, branchId)

    let userId = cleanText(body.user_id) ?? undefined
    const email = cleanText(body.email)
    const password = cleanText(body.password)

    if (!userId && admin) {
      if (!email) {
        return NextResponse.json({ error: "البريد الإلكتروني مطلوب لإرسال الدعوة أو إنشاء مستخدم جديد" }, { status: 400 })
      }

      if (password) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: cleanText(body.full_name),
            phone: cleanText(body.phone),
            role,
            pharmacy_id: pharmacyId,
            branch_id: branchId,
          },
        })
        if (createError) throw createError
        userId = created.user.id
      } else {
        const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name: cleanText(body.full_name),
            phone: cleanText(body.phone),
            role,
            pharmacy_id: pharmacyId,
            branch_id: branchId,
          },
        })
        if (inviteError) throw inviteError
        userId = invited.user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "إضافة مستخدم جديد أو دعوته تحتاج Service Role أو أرسل user_id لمستخدم موجود" }, { status: 400 })
    }

    await upsertUserProfile(db, userId, body, role, email)

    const { data, error } = await db
      .from("pharmacy_profiles")
      .upsert({
        pharmacy_id: pharmacyId,
        branch_id: branchId,
        user_id: userId,
        email,
        full_name: cleanText(body.full_name),
        phone: cleanText(body.phone),
        title: cleanText(body.title),
        role,
        is_active: body.is_active ?? true,
        permissions: sanitizePermissions(body.permissions),
        denied_permissions: sanitizePermissions(body.denied_permissions),
        invite_status: password ? "created" : (email ? "invited" : "linked"),
        invitation_sent_at: !password && email ? new Date().toISOString() : null,
        disabled_reason: body.is_active === false ? "disabled_by_admin" : null,
        invited_by: scope.user!.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "pharmacy_id,user_id" })
      .select("*")
      .single()
    if (error) throw error

    await writeAudit(db, { pharmacyId, actorId: scope.user!.id, event: "users.created", description: "تم إضافة أو دعوة مستخدم", metadata: { user_id: userId, role, branch_id: branchId } })
    await notifyUserManagers(db, { pharmacyId, actorId: scope.user!.id, title: "مستخدم جديد", description: `تم إضافة أو دعوة ${cleanText(body.full_name) ?? email ?? userId}` })

    return NextResponse.json({ user: data }, { status: 201 })
  } catch (error) {
    console.error("pharmacy users POST failed", error)
    const message = error instanceof Error ? error.message : "فشل حفظ مستخدم الصيدلية"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const { scope, response } = await resolveScope(pharmacyId)
    if (response) return response
    if (!canManageUsers(scope)) {
      return NextResponse.json({ error: "ليست لديك صلاحية تعديل المستخدمين" }, { status: 403 })
    }

    const body = (await request.json()) as UserBody
    const userId = cleanText(body.user_id)
    if (!userId) return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 })

    const role = body.role ? normalizeRole(body.role) : null
    if (role && !assignableRoles.includes(role)) {
      return NextResponse.json({ error: "الدور المطلوب غير مسموح داخل الصيدلية" }, { status: 400 })
    }

    const branchId = "branch_id" in body ? cleanText(body.branch_id) : undefined
    const supabase = await createClient()
    const db = getDbClient(supabase)
    if (branchId !== undefined) assertBranchScope(scope, branchId)
    await assertBranchInPharmacy(db, pharmacyId, branchId)

    const { data: existing, error: existingError } = await db
      .from("pharmacy_profiles")
      .select("user_id, role, email, full_name, phone, branch_id")
      .eq("pharmacy_id", pharmacyId)
      .eq("user_id", userId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "المستخدم غير موجود داخل هذه الصيدلية" }, { status: 404 })
    assertBranchScope(scope, (existing as { branch_id?: string | null }).branch_id)
    const existingRole = normalizeRole((existing as { role?: string }).role)
    if (!scope.isDeveloper && ["owner", "developer"].includes(existingRole)) {
      return NextResponse.json({ error: "لا يمكن تعديل صاحب الصيدلية أو المطور" }, { status: 403 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (role) updates.role = role
    if (branchId !== undefined) updates.branch_id = branchId
    if ("email" in body) updates.email = cleanText(body.email)
    if ("full_name" in body) updates.full_name = cleanText(body.full_name)
    if ("phone" in body) updates.phone = cleanText(body.phone)
    if ("title" in body) updates.title = cleanText(body.title)
    if ("is_active" in body) {
      updates.is_active = Boolean(body.is_active)
      updates.disabled_reason = body.is_active === false ? (cleanText(body.disabled_reason) ?? "disabled_by_admin") : null
    }
    if ("permissions" in body) updates.permissions = sanitizePermissions(body.permissions)
    if ("denied_permissions" in body) updates.denied_permissions = sanitizePermissions(body.denied_permissions)

    await upsertUserProfile(db, userId, body, role ?? existingRole, cleanText(body.email) ?? (existing as { email?: string | null }).email ?? null)

    const { data, error } = await db
      .from("pharmacy_profiles")
      .update(updates)
      .eq("pharmacy_id", pharmacyId)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) throw error

    await writeAudit(db, { pharmacyId, actorId: scope.user!.id, event: "users.updated", description: "تم تعديل مستخدم", metadata: { user_id: userId, updates: Object.keys(updates) } })
    await notifyUserManagers(db, { pharmacyId, actorId: scope.user!.id, title: "تعديل مستخدم", description: `تم تعديل بيانات أو صلاحيات ${cleanText(body.full_name) ?? (existing as { full_name?: string | null }).full_name ?? userId}` })

    return NextResponse.json({ user: data })
  } catch (error) {
    console.error("pharmacy users PATCH failed", error)
    const message = error instanceof Error ? error.message : "فشل تعديل مستخدم الصيدلية"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request, context: PharmacyRouteContext) {
  try {
    const pharmacyId = await getPharmacyId(context.params)
    const { scope, response } = await resolveScope(pharmacyId)
    if (response) return response
    if (!canDeleteUsers(scope)) {
      return NextResponse.json({ error: "ليست لديك صلاحية إيقاف المستخدمين" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("user_id")
    if (!userId) return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 })
    if (userId === scope.user!.id && !scope.isDeveloper) {
      return NextResponse.json({ error: "لا يمكن إيقاف حسابك من نفس الجلسة" }, { status: 400 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase)
    const { data: existing, error: existingError } = await db
      .from("pharmacy_profiles")
      .select("role, branch_id")
      .eq("pharmacy_id", pharmacyId)
      .eq("user_id", userId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "المستخدم غير موجود داخل هذه الصيدلية" }, { status: 404 })
    assertBranchScope(scope, (existing as { branch_id?: string | null }).branch_id)
    const existingRole = normalizeRole((existing as { role?: string }).role)
    if (!scope.isDeveloper && ["owner", "developer"].includes(existingRole)) {
      return NextResponse.json({ error: "لا يمكن إيقاف صاحب الصيدلية أو المطور" }, { status: 403 })
    }

    const { data, error } = await db
      .from("pharmacy_profiles")
      .update({ is_active: false, disabled_reason: "disabled_by_admin", updated_at: new Date().toISOString() })
      .eq("pharmacy_id", pharmacyId)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) throw error

    await writeAudit(db, { pharmacyId, actorId: scope.user!.id, event: "users.disabled", description: "تم إيقاف مستخدم", metadata: { user_id: userId } })
    await notifyUserManagers(db, { pharmacyId, actorId: scope.user!.id, title: "إيقاف مستخدم", description: "تم إيقاف عضوية مستخدم داخل الصيدلية" })

    return NextResponse.json({ user: data })
  } catch (error) {
    console.error("pharmacy users DELETE failed", error)
    const message = error instanceof Error ? error.message : "فشل إيقاف مستخدم الصيدلية"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
