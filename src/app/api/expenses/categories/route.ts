import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:read")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pharmacy_expense_categories")
      .select("id,pharmacy_id,name,parent_id,sort_order")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(200)
    if (error) throw error
    return NextResponse.json({ categories: data ?? [] })
  } catch (error) {
    console.error("expense categories GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل التصنيفات" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: clean(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "financials:write")) return NextResponse.json({ error: "ليست لديك صلاحية" }, { status: 403 })

    const name = clean(body.name)
    if (!name) return NextResponse.json({ error: "أدخل اسم التصنيف" }, { status: 400 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pharmacy_expense_categories")
      .upsert({
        pharmacy_id: scope.activePharmacyId,
        name,
        parent_id: clean(body.parent_id) || null,
        sort_order: Math.max(0, Number(body.sort_order) || 0),
      }, { onConflict: "pharmacy_id,name" })
      .select("id,name,parent_id,sort_order")
      .single()
    if (error) throw error
    await writeAuditLog(supabase, {
      pharmacyId: scope.activePharmacyId, actorId: scope.user.id,
      eventType: "expense.category_saved", source: "expenses",
      description: "تم حفظ تصنيف مصروف", metadata: { category_id: data.id, name },
    })
    return NextResponse.json({ category: data }, { status: 201 })
  } catch (error) {
    console.error("expense categories POST failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل إضافة التصنيف" }, { status: 400 })
  }
}
