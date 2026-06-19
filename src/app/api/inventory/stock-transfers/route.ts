import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function safeSearch(value: string) {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim()
}

type TransferLineInput = { item_id?: unknown; quantity?: unknown; unit?: unknown; item_name?: unknown }
type TransferLine = { item_id: string; item_name?: string; quantity: number; unit: string | null }
type TransferRow = { id: string; pharmacy_id: string; branch_id?: string | null; lines?: TransferLine[] | null; status?: string | null; transfer_number?: string | null }
type ItemMini = { id: string; name_ar: string; sku: string | null; unit: string | null }

function normalizeLines(lines: unknown): TransferLine[] {
  if (!Array.isArray(lines)) return []
  return lines
    .map((rawLine) => {
      const line = rawLine as TransferLineInput
      return {
        item_id: clean(line.item_id),
        item_name: clean(line.item_name) || undefined,
        quantity: Math.max(0, Number(line.quantity) || 0),
        unit: clean(line.unit) || null,
      }
    })
    .filter((line) => line.item_id && line.quantity > 0)
}

async function enrichTransferLines(db: SupabaseClient, pharmacyId: string, rows: Array<Record<string, unknown>>) {
  const itemIds = Array.from(new Set(rows.flatMap((row) => normalizeLines(row.lines).map((line) => line.item_id))))
  if (itemIds.length === 0) return rows

  const { data, error } = await db
    .from("pharmacy_items")
    .select("id,name_ar,sku,unit")
    .eq("pharmacy_id", pharmacyId)
    .in("id", itemIds)
  if (error) throw error

  const itemMap = new Map((data ?? []).map((item: ItemMini) => [item.id, item]))
  return rows.map((row) => ({
    ...row,
    lines: normalizeLines(row.lines).map((line) => {
      const item = itemMap.get(line.item_id)
      return {
        ...line,
        item_name: line.item_name ?? item?.name_ar ?? "صنف غير معروف",
        sku: item?.sku ?? null,
        unit: line.unit ?? item?.unit ?? null,
      }
    }),
  }))
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(url.searchParams.get("pharmacy_id")) || null,
      requestedBranchId: clean(url.searchParams.get("branch_id")) && clean(url.searchParams.get("branch_id")) !== "all" ? clean(url.searchParams.get("branch_id")) : null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 25, 10, 100)
    const offset = (page - 1) * pageSize
    const status = clean(url.searchParams.get("status"))
    const query = safeSearch(clean(url.searchParams.get("query")))
    const branchId = clean(url.searchParams.get("branch_id"))
    if (branchId && branchId !== "all") assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    let dbQuery = db
      .from("pharmacy_stock_transfers")
      .select("*,from_branch:pharmacy_branches!from_branch_id(id,name,code),to_branch:pharmacy_branches!to_branch_id(id,name,code)", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (status && status !== "all") dbQuery = dbQuery.eq("status", status)
    if (branchId && branchId !== "all") dbQuery = dbQuery.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
    if (query) dbQuery = dbQuery.or(`transfer_number.ilike.%${query}%,notes.ilike.%${query}%`)

    const { data, error, count } = await dbQuery
    if (error) throw error
    const records = await enrichTransferLines(db, scope.activePharmacyId, (data ?? []) as Array<Record<string, unknown>>)

    return NextResponse.json({
      records,
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    })
  } catch (error) {
    console.error("stock-transfers GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل التحويلات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const fromBranchId = clean(body.from_branch_id)
    const toBranchId = clean(body.to_branch_id)
    const scope = await getServerAuthScope({
      requestedPharmacyId: clean(body.pharmacy_id) || null,
      requestedBranchId: fromBranchId || null,
    })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:transfer.write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    if (!fromBranchId || !toBranchId) return NextResponse.json({ error: "اختر فرع المصدر والوجهة" }, { status: 400 })
    if (fromBranchId === toBranchId) return NextResponse.json({ error: "فرع المصدر والوجهة متطابقان" }, { status: 400 })
    assertBranchScope(scope, fromBranchId)
    assertBranchScope(scope, toBranchId)

    const validLines = normalizeLines(body.lines)
    if (validLines.length === 0) return NextResponse.json({ error: "أضف على الأقل صنفًا واحدًا بكمية صحيحة" }, { status: 400 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const now = new Date().toISOString()
    const transferNumber = `TRF-${Date.now().toString(36).toUpperCase()}`

    const itemIds = Array.from(new Set(validLines.map((line) => line.item_id)))
    const { data: items, error: itemError } = await db
      .from("pharmacy_items")
      .select("id,name_ar,unit,manage_inventory,status")
      .eq("pharmacy_id", pharmacyId)
      .in("id", itemIds)
      .neq("status", "deleted")
    if (itemError) throw itemError
    const itemMap = new Map((items ?? []).map((item: { id: string; name_ar: string; unit: string | null }) => [item.id, item]))
    const missingId = itemIds.find((id) => !itemMap.has(id))
    if (missingId) return NextResponse.json({ error: "يوجد صنف غير موجود داخل التحويل" }, { status: 400 })

    const lines = validLines.map((line) => ({
      item_id: line.item_id,
      item_name: line.item_name ?? itemMap.get(line.item_id)?.name_ar ?? null,
      quantity: line.quantity,
      unit: line.unit ?? itemMap.get(line.item_id)?.unit ?? null,
    }))

    const autoComplete = body.auto_complete !== false
    const { data, error } = await db.from("pharmacy_stock_transfers").insert({
      pharmacy_id: pharmacyId,
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      transfer_number: transferNumber,
      lines,
      total_items: lines.reduce((sum, line) => sum + line.quantity, 0),
      status: autoComplete ? "pending" : "draft",
      notes: clean(body.notes) || null,
      created_by: scope.user.id,
      created_at: now,
      updated_at: now,
    }).select("*,from_branch:pharmacy_branches!from_branch_id(id,name,code),to_branch:pharmacy_branches!to_branch_id(id,name,code)").maybeSingle()

    if (error) throw error
    if (!data) throw new Error("فشل إنشاء التحويل")

    let result: unknown = null
    let record = data as TransferRow
    if (autoComplete) {
      const { data: rpcData, error: rpcError } = await db.rpc("complete_stock_transfer", {
        p_pharmacy_id: pharmacyId,
        p_transfer_id: record.id,
        p_actor_id: scope.user.id,
        p_notes: clean(body.approval_notes) || null,
      })
      if (rpcError) throw rpcError
      result = rpcData
      const { data: refreshed } = await db
        .from("pharmacy_stock_transfers")
        .select("*,from_branch:pharmacy_branches!from_branch_id(id,name,code),to_branch:pharmacy_branches!to_branch_id(id,name,code)")
        .eq("id", record.id)
        .maybeSingle()
      if (refreshed) record = refreshed as TransferRow
    }

    await writeAuditLog(db, {
      pharmacyId,
      actorId: scope.user.id,
      branchId: fromBranchId,
      eventType: autoComplete ? "stock_transfer.completed" : "stock_transfer.created",
      source: "inventory",
      description: autoComplete ? "تم إنشاء وتنفيذ تحويل مخزني" : "تم إنشاء تحويل مخزني كمسودة",
      metadata: { transfer_id: record.id, transfer_number: record.transfer_number, from_branch_id: fromBranchId, to_branch_id: toBranchId, lines_count: lines.length },
    })

    const [enriched] = await enrichTransferLines(db, pharmacyId, [record as unknown as Record<string, unknown>])
    return NextResponse.json({ record: enriched, result }, { status: 201 })
  } catch (error) {
    console.error("stock-transfers POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إنشاء التحويل" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = clean(body.action)
    const transferId = clean(body.transfer_id)
    if (!transferId) return NextResponse.json({ error: "معرف التحويل مطلوب" }, { status: 400 })
    if (!["complete", "cancel"].includes(action)) return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 })

    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر الصيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "inventory:transfer.write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId

    const { data: existing, error: existingError } = await db
      .from("pharmacy_stock_transfers")
      .select("id,pharmacy_id,from_branch_id,to_branch_id,status,transfer_number")
      .eq("pharmacy_id", pharmacyId)
      .eq("id", transferId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: "التحويل غير موجود" }, { status: 404 })
    assertBranchScope(scope, String(existing.from_branch_id))
    assertBranchScope(scope, String(existing.to_branch_id))

    if (action === "complete") {
      const { data, error } = await db.rpc("complete_stock_transfer", {
        p_pharmacy_id: pharmacyId,
        p_transfer_id: transferId,
        p_actor_id: scope.user.id,
        p_notes: clean(body.notes) || null,
      })
      if (error) throw error
      await writeAuditLog(db, {
        pharmacyId,
        actorId: scope.user.id,
        branchId: String(existing.from_branch_id),
        eventType: "stock_transfer.completed",
        source: "inventory",
        description: "تم تنفيذ تحويل مخزني",
        metadata: { transfer_id: transferId, transfer_number: existing.transfer_number, result: data },
      })
      return NextResponse.json({ result: data })
    }

    if (existing.status === "completed") return NextResponse.json({ error: "لا يمكن إلغاء تحويل مكتمل" }, { status: 400 })
    const { data, error } = await db
      .from("pharmacy_stock_transfers")
      .update({ status: "cancelled", notes: clean(body.notes) || null, updated_at: new Date().toISOString() })
      .eq("pharmacy_id", pharmacyId)
      .eq("id", transferId)
      .neq("status", "completed")
      .select("*")
      .maybeSingle()
    if (error) throw error
    await writeAuditLog(db, {
      pharmacyId,
      actorId: scope.user.id,
      branchId: String(existing.from_branch_id),
      eventType: "stock_transfer.cancelled",
      source: "inventory",
      description: "تم إلغاء تحويل مخزني",
      metadata: { transfer_id: transferId, transfer_number: existing.transfer_number },
    })
    return NextResponse.json({ record: data })
  } catch (error) {
    console.error("stock-transfers PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل التحويل" }, { status: 400 })
  }
}
