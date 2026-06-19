import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { item_ids?: string[]; action?: string; pharmacy_id?: string }
    const { item_ids: itemIds, action } = body
    if (!itemIds?.length) return NextResponse.json({ error: "اختر صنف واحد على الأقل" }, { status: 400 })
    if (!action || !["delete", "restore", "archive", "activate", "deactivate"].includes(action)) {
      return NextResponse.json({ error: "إجراء غير مدعوم" }, { status: 400 })
    }

    const scope = await getServerAuthScope({ requestedPharmacyId: body.pharmacy_id ?? null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "لا توجد صيدلية نشطة" }, { status: 400 })

    const permissionByAction = {
      delete: "inventory:delete",
      restore: "inventory:restore",
      archive: "inventory:archive",
      activate: "inventory:update",
      deactivate: "inventory:update",
    } as const
    const permission = permissionByAction[action as keyof typeof permissionByAction]
    if (!scopeCan(scope, permission)) {
      return NextResponse.json({ error: "ليست لديك صلاحية تنفيذ هذا الإجراء على الأصناف" }, { status: 403 })
    }

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const statusByAction: Record<string, string> = {
      delete: "deleted",
      restore: "active",
      archive: "archived",
      activate: "active",
      deactivate: "inactive",
    }

    const update: Record<string, unknown> = {
      status: statusByAction[action],
      updated_at: new Date().toISOString(),
    }

    if (action === "delete") {
      update.deleted_at = new Date().toISOString()
      update.deleted_by = scope.user.id
    }
    if (action === "restore") {
      update.deleted_at = null
      update.deleted_by = null
      update.delete_reason = null
    }

    const { data: updatedRows, error } = await db
      .from("pharmacy_items")
      .update(update)
      .eq("pharmacy_id", pharmacyId)
      .in("id", itemIds)
      .select("id")

    if (error) {
      if (/deleted_at|deleted_by|delete_reason/i.test(error.message)) {
        const baseUpdate: Record<string, unknown> = {
          status: statusByAction[action],
          updated_at: new Date().toISOString(),
        }
        const { data: retryRows, error: retryError } = await db
          .from("pharmacy_items")
          .update(baseUpdate)
          .eq("pharmacy_id", pharmacyId)
          .in("id", itemIds)
          .select("id")
        if (retryError) throw retryError
        return NextResponse.json({ success: true, updated: retryRows?.length ?? 0 })
      }
      throw error
    }

    return NextResponse.json({ success: true, updated: updatedRows?.length ?? 0 })
  } catch (error) {
    console.error("batch-status POST failed", error)
    const message = error instanceof Error ? error.message : "فشل تحديث الحالة للأصناف المحددة"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
