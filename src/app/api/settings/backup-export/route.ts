import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"

const EXPORT_TABLES = [
  "pharmacy_branches",
  "pharmacy_partners",
  "pharmacy_customer_addresses",
  "pharmacy_item_groups",
  "pharmacy_item_brands",
  "pharmacy_units",
  "pharmacy_items",
  "pharmacy_item_barcodes",
  "pharmacy_item_units",
  "pharmacy_item_variants",
  "pharmacy_item_warranties",
  "pharmacy_item_alternatives",
  "pharmacy_item_batches",
  "pharmacy_stock_balances",
  "pharmacy_stock_movements",
  "pharmacy_stock_transfers",
  "pharmacy_damaged_stock",
  "pharmacy_stock_counts",
  "pharmacy_sales",
  "pharmacy_sale_lines",
  "pharmacy_sales_returns",
  "pharmacy_sales_return_lines",
  "pharmacy_suspended_invoices",
  "pharmacy_invoice_drafts",
  "pharmacy_purchases",
  "pharmacy_purchase_lines",
  "pharmacy_purchase_returns",
  "pharmacy_purchase_return_lines",
  "pharmacy_purchase_orders",
  "pharmacy_expense_categories",
  "pharmacy_expenses",
  "pharmacy_payments",
  "pharmacy_payment_allocations",
  "pharmacy_chart_of_accounts",
  "pharmacy_journal_entries",
  "pharmacy_journal_lines",
  "pharmacy_account_balances",
  "pharmacy_financial_movements",
  "pharmacy_shifts",
  "pharmacy_cash_registers",
  "pharmacy_register_transactions",
  "pharmacy_coupons",
  "pharmacy_bundles",
  "pharmacy_loyalty_points",
  "pharmacy_loyalty_transactions",
  "pharmacy_loyalty_balances",
  "pharmacy_employees",
  "pharmacy_attendance",
  "pharmacy_leave",
  "pharmacy_employee_shifts",
  "pharmacy_prescriptions",
  "pharmacy_partner_communications",
  "pharmacy_price_groups",
  "pharmacy_settings",
  "pharmacy_tax_rates",
  "pharmacy_tax_groups",
  "pharmacy_invoice_designs",
  "pharmacy_barcode_paper_settings",
  "pharmacy_receipt_printers",
  "pharmacy_notification_templates",
] as const

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

async function readAll(db: SupabaseClient, table: string, pharmacyId: string) {
  const rows: unknown[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
    offset += pageSize
    if (offset >= 500000) throw new Error(`تجاوز جدول ${table} الحد الآمن للتصدير من الواجهة`)
  }
  return rows
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const scope = await getServerAuthScope({ requestedPharmacyId: url.searchParams.get("pharmacy_id") })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "settings:backup.write")) return NextResponse.json({ error: "ليست لديك صلاحية تصدير نسخة تشغيلية" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const exportedAt = new Date().toISOString()
    const data: Record<string, unknown[]> = {}
    const rowCounts: Record<string, number> = {}
    const warnings: Array<{ table: string; message: string }> = []

    for (const table of EXPORT_TABLES) {
      try {
        const rows = await readAll(db, table, scope.activePharmacyId)
        data[table] = rows
        rowCounts[table] = rows.length
      } catch (error) {
        const message = error instanceof Error ? error.message : "تعذر قراءة الجدول"
        warnings.push({ table, message })
      }
    }

    const payload = {
      format: "logixa-pharmacy-operational-export",
      version: 1,
      exported_at: exportedAt,
      pharmacy_id: scope.activePharmacyId,
      row_counts: rowCounts,
      warnings,
      data,
    }
    const body = JSON.stringify(payload, null, 2)
    const bytes = Buffer.byteLength(body, "utf8")
    const checksum = createHash("sha256").update(body).digest("hex")
    const datePart = exportedAt.slice(0, 19).replace(/[:T]/g, "-")
    const filename = `pharmacy-backup-${datePart}.json`

    const { data: backupRow, error: backupError } = await db
      .from("pharmacy_backups")
      .insert({
        pharmacy_id: scope.activePharmacyId,
        name: `تصدير تشغيلي ${new Date(exportedAt).toLocaleString("ar-EG")}`,
        file_size: bytes,
        type: "manual",
        status: warnings.length ? "created_with_warnings" : "created",
        metadata: { format: payload.format, version: payload.version, row_counts: rowCounts, warnings, sha256: checksum },
        created_by: scope.user.id,
      })
      .select("id")
      .maybeSingle()
    if (backupError) throw backupError

    await writeAuditLog(db, {
      pharmacyId: scope.activePharmacyId,
      actorId: scope.user.id,
      eventType: "backup.exported",
      source: "settings",
      description: "تم تصدير نسخة تشغيلية فعلية من بيانات الصيدلية",
      metadata: { backup_id: backupRow?.id, file_size: bytes, sha256: checksum, warnings_count: warnings.length, row_counts: rowCounts },
    })

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes),
        "X-Backup-SHA256": checksum,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("backup export failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تصدير النسخة التشغيلية" }, { status: 500 })
  }
}
