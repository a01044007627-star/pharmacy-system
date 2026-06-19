import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })

    const supabase = await createClient()
    const page = safeNumber(url.searchParams.get("page"), 1, 1, 100000)
    const pageSize = safeNumber(url.searchParams.get("page_size"), 50, 5, 200)
    const offset = (page - 1) * pageSize
    const completed = url.searchParams.get("completed")
    const search = clean(url.searchParams.get("query"))

    let query = supabase
      .from("pharmacy_tasks")
      .select("id,title,completed,priority,due_date,notes,created_at,updated_at,created_by", { count: "exact" })
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (completed === "true") query = query.eq("completed", true)
    else if (completed === "false") query = query.eq("completed", false)
    if (search) query = query.ilike("title", `%${search}%`)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      tasks: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    })
  } catch (error) {
    console.error("tasks GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل المهام" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })

    const title = clean(body.title)
    if (!title) return NextResponse.json({ error: "أدخل نص المهمة" }, { status: 400 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pharmacy_tasks")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        branch_id: clean(body.branch_id) || scope.activeBranchId || null,
        title,
        completed: false,
        assigned_to: clean(body.assigned_to) || null,
        due_date: clean(body.due_date) || null,
        priority: ["low", "medium", "high", "urgent"].includes(clean(body.priority)) ? clean(body.priority) : "medium",
        notes: clean(body.notes) || null,
        created_by: scope.user.id,
      })
      .select("id,title,completed,priority,due_date,notes,created_at")
      .single()
    if (error) throw error
    return NextResponse.json({ task: data }, { status: 201 })
  } catch (error) {
    console.error("tasks POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة المهمة" }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const taskId = clean(body.task_id)
    if (!taskId) return NextResponse.json({ error: "معرف المهمة مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })

    const supabase = await createClient()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ("completed" in body) updates.completed = Boolean(body.completed)
    if ("title" in body) updates.title = clean(body.title)
    if ("priority" in body && ["low", "medium", "high", "urgent"].includes(clean(body.priority))) updates.priority = clean(body.priority)
    if ("due_date" in body) updates.due_date = clean(body.due_date) || null
    if ("notes" in body) updates.notes = clean(body.notes) || null

    const { data, error } = await supabase
      .from("pharmacy_tasks")
      .update(updates)
      .eq("id", taskId)
      .eq("pharmacy_id", scope.activePharmacyId)
      .select("id,title,completed,priority,due_date,notes,created_at,updated_at")
      .single()
    if (error) throw error
    return NextResponse.json({ task: data })
  } catch (error) {
    console.error("tasks PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحديث المهمة" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const taskId = clean(url.searchParams.get("task_id"))
    if (!taskId) return NextResponse.json({ error: "معرف المهمة مطلوب" }, { status: 400 })

    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })

    const supabase = await createClient()
    const { error } = await supabase
      .from("pharmacy_tasks")
      .delete()
      .eq("id", taskId)
      .eq("pharmacy_id", scope.activePharmacyId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("tasks DELETE failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل حذف المهمة" }, { status: 400 })
  }
}
