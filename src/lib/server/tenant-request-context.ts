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

type TenantRequestContextOptions = {
  permission: Permission
  forbiddenMessage?: string
  missingPharmacyMessage?: string
}

export class TenantRequestContext {
  readonly url: URL
  readonly scope: AuthScope
  readonly db: SupabaseClient
  readonly pharmacyId: string
  readonly branchId: string | null

  private constructor(params: {
    url: URL
    scope: AuthScope
    db: SupabaseClient
    pharmacyId: string
    branchId: string | null
  }) {
    this.url = params.url
    this.scope = params.scope
    this.db = params.db
    this.pharmacyId = params.pharmacyId
    this.branchId = params.branchId
  }

  static async from(request: Request, options: TenantRequestContextOptions) {
    const url = new URL(request.url)
    const requestedBranchId = url.searchParams.get("branch_id")
    const scope = await getServerAuthScope({
      requestedPharmacyId: url.searchParams.get("pharmacy_id"),
      requestedBranchId: requestedBranchId === "all" ? null : requestedBranchId,
    })

    if (!scope.user) throw new RouteHttpError("غير مسجل الدخول", 401, "AUTH_REQUIRED")
    if (!scope.activePharmacyId) {
      throw new RouteHttpError(options.missingPharmacyMessage ?? "اختر صيدلية أولًا", 400, "PHARMACY_REQUIRED")
    }
    if (!scopeCan(scope, options.permission)) {
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
    })
  }

  text(name: string) {
    return (this.url.searchParams.get(name) ?? "").trim()
  }

  search(name = "query") {
    return this.text(name).replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
  }

  integer(name: string, fallback: number, min: number, max: number) {
    const parsed = Math.trunc(Number(this.url.searchParams.get(name)))
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }

  pagination(defaultPageSize = 25) {
    const page = this.integer("page", 1, 1, 100_000)
    const pageSize = this.integer("page_size", defaultPageSize, 10, 100)
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
