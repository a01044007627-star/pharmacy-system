import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getServerAuthScope } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/auth/permissions"
import { canReadSettingsNamespace, canWriteSettingsNamespace } from "@/features/settings/lib/settings-permissions"
import {
  SETTINGS_DEFAULTS,
  flattenDefaultSettings,
  settingKey,
  splitSettingKey,
  type SettingsNamespace,
} from "@/features/settings/lib/settings-keys"

const TABLE = "pharmacy_settings"
const GLOBAL_NAMESPACES = new Set<SettingsNamespace>(["system"])
const TENANT_WRITE_ROLES = new Set(["developer", "owner", "admin", "manager"])

type SettingsRow = {
  id: string
  pharmacy_id: string | null
  key: string
  value: string
  description?: string | null
  created_at?: string
  updated_at?: string
}

type SettingsPayload = {
  namespace?: SettingsNamespace
  pharmacyId?: string | null
  branchId?: string | null
  settings?: Record<string, unknown>
}

async function getDb(): Promise<SupabaseClient> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient() as SupabaseClient
  }
  return (await createServerClient()) as SupabaseClient
}

function isNamespace(value: string | null | undefined): value is SettingsNamespace {
  return Boolean(value && value in SETTINGS_DEFAULTS)
}

function isGlobalNamespace(namespace?: SettingsNamespace | null): boolean {
  return Boolean(namespace && GLOBAL_NAMESPACES.has(namespace))
}

function localKeysForNamespace(namespace: SettingsNamespace): Set<string> {
  return new Set(Object.keys(SETTINGS_DEFAULTS[namespace] ?? {}))
}

function normalizeKey(namespace: SettingsNamespace | undefined, rawKey: string): string {
  if (!namespace) return rawKey
  const split = splitSettingKey(rawKey)
  if (split.namespace === namespace) return rawKey
  return settingKey(namespace, rawKey)
}

function localKey(namespace: SettingsNamespace, dbKey: string): string | null {
  const split = splitSettingKey(dbKey)
  const allowed = localKeysForNamespace(namespace)

  if (split.namespace === namespace && allowed.has(split.key)) return split.key
  if (!split.namespace && allowed.has(split.key)) return split.key
  return null
}

function applyRowsToFlatMap(map: Record<string, string>, rows: SettingsRow[]) {
  for (const row of rows) {
    map[row.key] = row.value
  }
}

function applyRowsToNamespaceMap(namespace: SettingsNamespace, map: Record<string, string>, rows: SettingsRow[]) {
  for (const row of rows) {
    const key = localKey(namespace, row.key)
    if (key) map[key] = row.value
  }
}


type PharmacyProfileRow = {
  id: string
  name?: string | null
  legal_name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  currency?: string | null
  timezone?: string | null
  country?: string | null
}

function applyPharmacyProfileToProjectSettings(map: Record<string, string>, pharmacy: PharmacyProfileRow | null) {
  if (!pharmacy) return
  if (pharmacy.name) map.name = pharmacy.name
  if (pharmacy.legal_name) map.legalName = pharmacy.legal_name
  if (pharmacy.address) map.address = pharmacy.address
  if (pharmacy.phone) map.phone = pharmacy.phone
  if (pharmacy.email) map.email = pharmacy.email
  if (pharmacy.currency) map.currency = pharmacy.currency
  if (pharmacy.timezone) map.timezone = pharmacy.timezone
  if (pharmacy.country) map.country = pharmacy.country
}

function projectSettingsToPharmacyUpdate(settings: Record<string, string>) {
  const update: Record<string, string> = {}
  const map: Record<string, string> = {
    "project.name": "name",
    "project.legalName": "legal_name",
    "project.address": "address",
    "project.phone": "phone",
    "project.email": "email",
    "project.currency": "currency",
    "project.timezone": "timezone",
    "project.country": "country",
  }

  for (const [setting, column] of Object.entries(map)) {
    if (settings[setting] !== undefined) update[column] = settings[setting]
  }

  return update
}

async function readPharmacyProfile(db: SupabaseClient, pharmacyId: string | null): Promise<PharmacyProfileRow | null> {
  if (!pharmacyId) return null
  const { data, error } = await db
    .from("pharmacies")
    .select("id, name, legal_name, address, phone, email, currency, timezone, country")
    .eq("id", pharmacyId)
    .maybeSingle()
  if (error) throw error
  return data as PharmacyProfileRow | null
}

async function syncProjectSettingsToPharmacy(db: SupabaseClient, pharmacyId: string | null, settings: Record<string, string>) {
  if (!pharmacyId) return
  const update = projectSettingsToPharmacyUpdate(settings)
  if (Object.keys(update).length === 0) return
  const { error } = await db
    .from("pharmacies")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", pharmacyId)
  if (error) throw error
}

function validateIncomingSettings(namespace: SettingsNamespace | undefined, settings: Record<string, unknown> | undefined) {
  if (!settings || typeof settings !== "object") return {}

  const output: Record<string, string> = {}
  const allowedKeys = namespace ? localKeysForNamespace(namespace) : null

  for (const [rawKey, rawValue] of Object.entries(settings)) {
    if (rawValue === undefined || rawValue === null) continue
    const value = String(rawValue)

    if (namespace) {
      const split = splitSettingKey(rawKey)
      const key = split.namespace === namespace ? split.key : rawKey
      if (!allowedKeys?.has(key)) continue
      output[normalizeKey(namespace, key)] = value
      continue
    }

    const split = splitSettingKey(rawKey)
    if (split.namespace && SETTINGS_DEFAULTS[split.namespace]?.[split.key] !== undefined) {
      output[rawKey] = value
    }
  }

  return output
}

async function upsertSetting(db: SupabaseClient, pharmacyId: string | null, key: string, value: string) {
  const now = new Date().toISOString()
  let readQuery = db.from(TABLE).select("id").eq("key", key).limit(1)
  readQuery = pharmacyId ? readQuery.eq("pharmacy_id", pharmacyId) : readQuery.is("pharmacy_id", null)

  const { data: existing, error: readError } = await readQuery.maybeSingle()
  if (readError) throw readError

  if (existing?.id) {
    const { error } = await db.from(TABLE).update({ value, updated_at: now }).eq("id", existing.id)
    if (error) throw error
    return
  }

  const { error } = await db.from(TABLE).insert({ pharmacy_id: pharmacyId, key, value, updated_at: now })
  if (error) throw error
}

function activeMembershipPermissions(scope: Awaited<ReturnType<typeof getServerAuthScope>>): string[] {
  return scope.memberships.find((membership) => membership.pharmacy_id === scope.activePharmacyId)?.permissions ?? []
}

function activeMembershipDeniedPermissions(scope: Awaited<ReturnType<typeof getServerAuthScope>>): string[] {
  return scope.memberships.find((membership) => membership.pharmacy_id === scope.activePharmacyId)?.denied_permissions ?? []
}

function canReadSettings(scope: Awaited<ReturnType<typeof getServerAuthScope>>, pharmacyId: string | null, namespace?: SettingsNamespace) {
  if (!scope.user) return false
  if (!namespace) return hasPermission(scope.role, "settings:read", activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope)) || scope.isDeveloper
  if (isGlobalNamespace(namespace)) return canReadSettingsNamespace(scope.role, scope.isDeveloper, namespace, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
  if (!pharmacyId) return false
  if (scope.activePharmacyId !== pharmacyId && !scope.isDeveloper) return false
  return canReadSettingsNamespace(scope.role, scope.isDeveloper, namespace, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
}

function canWriteSettings(scope: Awaited<ReturnType<typeof getServerAuthScope>>, pharmacyId: string | null, namespace?: SettingsNamespace) {
  if (!scope.user) return false
  if (!namespace) return hasPermission(scope.role, "settings:write", activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope)) || scope.isDeveloper
  if (isGlobalNamespace(namespace)) return canWriteSettingsNamespace(scope.role, scope.isDeveloper, namespace, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
  if (!pharmacyId) return false
  if (scope.activePharmacyId !== pharmacyId && !scope.isDeveloper) return false
  if (!TENANT_WRITE_ROLES.has(scope.role) && !scope.isDeveloper) return false
  return canWriteSettingsNamespace(scope.role, scope.isDeveloper, namespace, activeMembershipPermissions(scope), activeMembershipDeniedPermissions(scope))
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const namespaceParam = url.searchParams.get("namespace")
    const mode = url.searchParams.get("mode") ?? "namespace"
    const requestedPharmacyId = url.searchParams.get("pharmacy_id")
    const requestedBranchId = url.searchParams.get("branch_id")

    if (namespaceParam && !isNamespace(namespaceParam)) {
      return jsonError("قسم الإعدادات غير صحيح", 422)
    }

    const namespace = namespaceParam as SettingsNamespace | undefined
    const scope = await getServerAuthScope({ requestedPharmacyId, requestedBranchId })
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)

    const pharmacyId = isGlobalNamespace(namespace) ? null : (requestedPharmacyId || scope.activePharmacyId)
    if (!canReadSettings(scope, pharmacyId, namespace)) {
      return jsonError("ليست لديك صلاحية قراءة هذه الإعدادات", 403)
    }

    const db = await getDb()
    const globalQuery = db
      .from(TABLE)
      .select("*")
      .is("pharmacy_id", null)
      .order("key", { ascending: true })

    const { data: globalRowsData, error: globalError } = await globalQuery
    if (globalError) throw globalError
    const globalRows = (globalRowsData ?? []) as SettingsRow[]

    if (mode === "rows") {
      if (isGlobalNamespace(namespace)) {
        return NextResponse.json({ rows: globalRows, pharmacyId: null, role: scope.role, isDeveloper: scope.isDeveloper })
      }

      if (!pharmacyId) return NextResponse.json({ rows: [], pharmacyId: null, role: scope.role, isDeveloper: scope.isDeveloper })

      const { data: scopedRowsData, error: scopedError } = await db
        .from(TABLE)
        .select("*")
        .eq("pharmacy_id", pharmacyId)
        .order("key", { ascending: true })

      if (scopedError) throw scopedError
      return NextResponse.json({ rows: scopedRowsData ?? [], pharmacyId, role: scope.role, isDeveloper: scope.isDeveloper })
    }

    if (mode === "all") {
      const merged = flattenDefaultSettings()
      applyRowsToFlatMap(merged, globalRows)

      if (pharmacyId) {
        const { data: scopedRowsData, error: scopedError } = await db
          .from(TABLE)
          .select("*")
          .eq("pharmacy_id", pharmacyId)
          .order("key", { ascending: true })

        if (scopedError) throw scopedError
        applyRowsToFlatMap(merged, (scopedRowsData ?? []) as SettingsRow[])
      }

      return NextResponse.json({ settings: merged, pharmacyId, role: scope.role, isDeveloper: scope.isDeveloper })
    }

    if (!namespace) return jsonError("قسم الإعدادات مطلوب", 422)

    const merged = { ...SETTINGS_DEFAULTS[namespace] }
    applyRowsToNamespaceMap(namespace, merged, globalRows)

    if (!isGlobalNamespace(namespace) && pharmacyId) {
      if (namespace === "project") {
        applyPharmacyProfileToProjectSettings(merged, await readPharmacyProfile(db, pharmacyId))
      }

      const { data: scopedRowsData, error: scopedError } = await db
        .from(TABLE)
        .select("*")
        .eq("pharmacy_id", pharmacyId)
        .order("key", { ascending: true })

      if (scopedError) throw scopedError
      applyRowsToNamespaceMap(namespace, merged, (scopedRowsData ?? []) as SettingsRow[])
    }

    return NextResponse.json({ settings: merged, pharmacyId, role: scope.role, isDeveloper: scope.isDeveloper })
  } catch (error) {
    console.error("settings GET failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل تحميل الإعدادات", 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SettingsPayload
    const namespace = body.namespace

    if (namespace && !isNamespace(namespace)) return jsonError("قسم الإعدادات غير صحيح", 422)

    const scope = await getServerAuthScope({ requestedPharmacyId: body.pharmacyId ?? null, requestedBranchId: body.branchId ?? null })
    if (!scope.user) return jsonError("غير مسجل الدخول", 401)

    const pharmacyId = isGlobalNamespace(namespace) ? null : (body.pharmacyId || scope.activePharmacyId)
    if (!canWriteSettings(scope, pharmacyId, namespace)) {
      return jsonError(
        isGlobalNamespace(namespace)
          ? "إعدادات النظام الأساسية متاحة للمطور فقط"
          : "ليست لديك صلاحية حفظ إعدادات هذه الصيدلية",
        403,
      )
    }

    if (!isGlobalNamespace(namespace) && !pharmacyId) {
      return jsonError("اختر الصيدلية أولًا قبل حفظ هذه الإعدادات", 400)
    }

    const settings = validateIncomingSettings(namespace, body.settings)
    const entries = Object.entries(settings)

    if (entries.length === 0) {
      return NextResponse.json({ ok: true, saved: 0, pharmacyId })
    }

    const db = await getDb()
    for (const [key, value] of entries) {
      await upsertSetting(db, pharmacyId, key, value)
    }

    if (namespace === "project") {
      await syncProjectSettingsToPharmacy(db, pharmacyId, settings)
    }

    return NextResponse.json({ ok: true, saved: entries.length, pharmacyId })
  } catch (error) {
    console.error("settings PATCH failed", error)
    return jsonError(error instanceof Error ? error.message : "فشل حفظ الإعدادات", 500)
  }
}
