export const PLATFORM_PLANS = ["trial", "starter", "professional", "enterprise"] as const
export const PHARMACY_STATUSES = ["active", "suspended", "closed"] as const

export type PlatformPlan = (typeof PLATFORM_PLANS)[number]
export type PharmacyStatus = (typeof PHARMACY_STATUSES)[number]

export type PharmacyLifecycleUpdate = {
  status?: PharmacyStatus
  plan?: PlatformPlan
  trial_ends_at?: string | null
  subscription_ends_at?: string | null
  max_branches?: number
  max_users?: number
  developer_notes?: string | null
  updated_at: string
}

function optionalDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  if (typeof value !== "string") throw new Error(`${label} غير صالح`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} غير صالح`)
  return date.toISOString()
}

function optionalLimit(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
    throw new Error(`${label} يجب أن يكون رقمًا صحيحًا موجبًا`)
  }
  return parsed
}

export function parsePharmacyLifecycleUpdate(
  input: Record<string, unknown>,
  now = new Date(),
): PharmacyLifecycleUpdate {
  const update: PharmacyLifecycleUpdate = { updated_at: now.toISOString() }

  if (input.status !== undefined) {
    if (!PHARMACY_STATUSES.includes(input.status as PharmacyStatus)) throw new Error("حالة الصيدلية غير مدعومة")
    update.status = input.status as PharmacyStatus
  }
  if (input.plan !== undefined) {
    if (!PLATFORM_PLANS.includes(input.plan as PlatformPlan)) throw new Error("خطة الاشتراك غير مدعومة")
    update.plan = input.plan as PlatformPlan
  }

  const trialEndsAt = optionalDate(input.trial_ends_at, "تاريخ انتهاء الفترة التجريبية")
  if (trialEndsAt !== undefined) update.trial_ends_at = trialEndsAt
  const subscriptionEndsAt = optionalDate(input.subscription_ends_at, "تاريخ انتهاء الاشتراك")
  if (subscriptionEndsAt !== undefined) update.subscription_ends_at = subscriptionEndsAt
  const maxBranches = optionalLimit(input.max_branches, "حد الفروع")
  if (maxBranches !== undefined) update.max_branches = maxBranches
  const maxUsers = optionalLimit(input.max_users, "حد المستخدمين")
  if (maxUsers !== undefined) update.max_users = maxUsers

  if (input.developer_notes !== undefined) {
    if (input.developer_notes !== null && typeof input.developer_notes !== "string") throw new Error("ملاحظات المطور غير صالحة")
    const notes = typeof input.developer_notes === "string" ? input.developer_notes.trim() : ""
    update.developer_notes = notes || null
  }

  if (Object.keys(update).length === 1) throw new Error("لا توجد تغييرات للحفظ")
  return update
}

export function normalizeFeatureFlagName(value: unknown): string {
  if (typeof value !== "string") throw new Error("اسم الميزة مطلوب")
  const name = value.trim().toLowerCase().replace(/\s+/g, "_")
  if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(name)) {
    throw new Error("اسم الميزة يجب أن يبدأ بحرف إنجليزي ويحتوي حروفًا وأرقامًا ونقاطًا أو شرطات فقط")
  }
  return name
}

export function safeDeveloperAction(value: unknown) {
  const allowed = [
    "onboard_client", "update_pharmacy", "upsert_feature_flag", "resolve_error", "publish_release",
    "start_support_session", "end_support_session", "record_health_check",
  ] as const
  if (!allowed.includes(value as (typeof allowed)[number])) throw new Error("إجراء المطور غير مدعوم")
  return value as (typeof allowed)[number]
}

export function isFeatureFlagEnabled(
  flag: { enabled: boolean; conditions?: Record<string, unknown> | null },
  context: { pharmacyId?: string | null; plan?: string | null },
) {
  if (!flag.enabled) return false
  const conditions = flag.conditions ?? {}
  const pharmacyIds = Array.isArray(conditions.pharmacy_ids) ? conditions.pharmacy_ids.filter((v): v is string => typeof v === "string") : []
  const excludedIds = Array.isArray(conditions.exclude_pharmacy_ids) ? conditions.exclude_pharmacy_ids.filter((v): v is string => typeof v === "string") : []
  const plans = Array.isArray(conditions.plans) ? conditions.plans.filter((v): v is string => typeof v === "string") : []

  if (context.pharmacyId && excludedIds.includes(context.pharmacyId)) return false
  if (pharmacyIds.length > 0 && (!context.pharmacyId || !pharmacyIds.includes(context.pharmacyId))) return false
  if (plans.length > 0 && (!context.plan || !plans.includes(context.plan))) return false
  return true
}
