import "server-only"

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, isBranchScoped, PermissionError, scopeCan } from "@/lib/auth/server-permissions"
import type { Permission } from "@/lib/auth/permissions"
import type { AuthScope } from "@/types"

export class RouteHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = "RouteHttpError"
  }
}

export type TenantRequestContextOptions = {
  permission?: Permission
  anyPermissions?: Permission[]
  forbiddenMessage?: string
  missingPharmacyMessage?: string
}

export class TenantRequestContext {
  readonly url: URL
  readonly scope: AuthScope
  readonly db: SupabaseClient
  readonly pharmacyId: string
  readonly branchId: string | null
  readonly actorId: string

  private constructor(params: {
    url: URL
    scope: AuthScope
    db: SupabaseClient
    pharmacyId: string
    branchId: string | null
    actorId: string
  }) {
    this.url = params.url
    this.scope = params.scope
    this.db = params.db
    this.pharmacyId = params.pharmacyId
    this.branchId = params.branchId
    this.actorId = params.actorId
  }

  static async from(request: Request, options: TenantRequestContextOptions) {
    const url = new URL(request.url)
    return TenantRequestContext.create({
      url,
      options,
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: url.searchParams.get("branch_id"),
    })
  }

  static async forMutation(
    request: Request,
    body: Record<string, unknown>,
    options: TenantRequestContextOptions,
  ) {
    const url = new URL(request.url)
    const value = (key: string) => typeof body[key] === "string" ? String(body[key]).trim() : null
    return TenantRequestContext.create({
      url,
      options,
      requestedPharmacyId: value("pharmacy_id") ?? url.searchParams.get("pharmacy_id"),
      requestedBranchId: value("branch_id") ?? url.searchParams.get("branch_id"),
    })
  }

  private static async create(params: {
    url: URL
    options: TenantRequestContextOptions
    requestedPharmacyId: string | null
    requestedBranchId: string | null
  }) {
    const { url, options } = params
    const requestedBranchId = params.requestedBranchId
    const scope = await getServerAuthScope({
      requestedPharmacyId: params.requestedPharmacyId,
      requestedBranchId: requestedBranchId === "all" ? null : requestedBranchId,
    })

    if (!scope.user) throw new RouteHttpError("غير مسجل الدخول", 401, "AUTH_REQUIRED")
    if (!scope.activePharmacyId) {
      throw new RouteHttpError(options.missingPharmacyMessage ?? "اختر صيدلية أولًا", 400, "PHARMACY_REQUIRED")
    }
    const requiredPermissions = [
      ...(options.permission ? [options.permission] : []),
      ...(options.anyPermissions ?? []),
    ]
    if (requiredPermissions.length === 0) {
      throw new Error("TenantRequestContext requires at least one permission")
    }
    if (!requiredPermissions.some((permission) => scopeCan(scope, permission))) {
      throw new RouteHttpError(options.forbiddenMessage ?? "ليست لديك صلاحية تنفيذ هذه العملية", 403, "FORBIDDEN")
    }

    const sessionClient = await createClient()
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient() as SupabaseClient
      : sessionClient as SupabaseClient

    let branchId = requestedBranchId && requestedBranchId !== "all" ? requestedBranchId : null
    if (branchId) assertBranchScope(scope, branchId)
    if (!branchId && isBranchScoped(scope)) {
      branchId = scope.memberships.find((row) => row.pharmacy_id === scope.activePharmacyId)?.branch_id
        ?? scope.activeBranchId
        ?? null
    }

    return new TenantRequestContext({
      url,
      scope,
      db,
      pharmacyId: scope.activePharmacyId,
      branchId,
      actorId: scope.user.id,
    })
  }

  text(name: string) {
    return (this.url.searchParams.get(name) ?? "").trim()
  }

  search(name = "query") {
    return this.text(name).replace(/[,%.()'"]/g, " ").replace(/\s+/g, " ").trim()
  }

  integer(name: string, fallback: number, min: number, max: number) {
    const parsed = Math.trunc(Number(this.url.searchParams.get(name)))
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }

  pagination(defaultPageSize = 25, maxPageSize = 100) {
    const page = this.integer("page", 1, 1, 100_000)
    const pageSize = this.integer("page_size", defaultPageSize, 10, maxPageSize)
    return { page, pageSize, offset: (page - 1) * pageSize }
  }
}

export function operationalErrorResponse(error: unknown, logLabel: string, fallbackMessage: string, fallbackStatus = 500) {
  if (error instanceof RouteHttpError || error instanceof PermissionError) {
    return NextResponse.json(
      { error: error.message, code: error instanceof RouteHttpError ? error.code : "FORBIDDEN" },
      { status: error.status },
    )
  }

  console.error(logLabel, error)
  return NextResponse.json(
    {
      error: fallbackMessage,
      ...(process.env.NODE_ENV === "development" && error instanceof Error ? { details: error.message } : {}),
    },
    { status: fallbackStatus },
  )
}
