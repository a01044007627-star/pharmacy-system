import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { scopeCan, assertBranchScope } from "@/lib/auth/server-permissions"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { Money } from "@/domain/shared/decimal-value"
import { ItemQuantityPolicyRepository } from "@/features/inventory/server/item-quantity-policy-repository"
import { CashierSaleService, cashierErrorResponse } from "@/features/sales/server/cashier-sale-service"


type CashierItemRow = {
  id: string
  group_id?: string | null
  brand_id?: string | null
  sku?: string | null
  expiry_date?: string | null
  sell_price?: number | string | null
  old_sell_price?: number | string | null
  buy_price?: number | string | null
  [key: string]: unknown
}

type ItemBarcodeRow = { item_id: string; barcode: string; is_primary?: boolean | null }
type StockBalanceRow = { item_id: string; branch_id?: string | null; quantity?: number | string | null }
type NamedLookupRow = { id: string; name: string }
type ItemBatchRow = {
  id: string
  item_id: string
  branch_id?: string | null
  batch_number?: string | null
  expiry_date?: string | null
  remaining_quantity?: number | string | null
}
type QueryResult<T> = { data?: T[] | null; error?: { message: string } | null }

function getDbClient(fallbackClient: Awaited<ReturnType<typeof createClient>>) {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : fallbackClient
}

function n(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeLimit(value: unknown, fallback = 80) {
  const parsed = Math.trunc(n(value, fallback))
  return Math.min(500, Math.max(1, parsed))
}

function safeOffset(value: unknown) {
  return Math.max(0, Math.trunc(n(value)))
}

function safeSearchTerm(value: string) {
  return value
    .replace(/[,%().]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function getScopeFromRequest(request: Request) {
  const url = new URL(request.url)
  const requestedPharmacyId = url.searchParams.get("pharmacy_id")
  const requestedBranchId = url.searchParams.get("branch_id")
  return getServerAuthScope({ requestedPharmacyId, requestedBranchId: requestedBranchId === "all" ? null : requestedBranchId })
}

async function loadProducts(db: SupabaseClient, pharmacyId: string, branchId: string | null, query: string, limit = 80, offset = 0) {
  const needle = query.trim()
  const rowLimit = safeLimit(limit, needle ? 80 : 120)
  const rowOffset = needle ? 0 : safeOffset(offset)
  let itemsQuery = db
    .from("pharmacy_items")
    .select("id, pharmacy_id, branch_id, group_id, brand_id, name_ar, name_en, sku, category, unit, manufacturer_name, item_type, sell_price, old_sell_price, buy_price, manage_inventory, not_for_sale, min_stock, opening_stock, has_expiry, track_batch, expiry_date, image_url, is_controlled, requires_prescription, status, updated_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active")
    .or("not_for_sale.is.null,not_for_sale.eq.false")
    .range(rowOffset, rowOffset + rowLimit - 1)

  if (branchId) itemsQuery = itemsQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)
  if (needle) {
    const q = safeSearchTerm(needle)
    itemsQuery = itemsQuery.or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%,manufacturer_name.ilike.%${q}%,search_text.ilike.%${q}%`)
  }
  itemsQuery = itemsQuery.order("updated_at", { ascending: false })

  const { data: items, error } = await itemsQuery
  if (error) throw error
  const rows = [...((items ?? []) as CashierItemRow[])]

  if (needle) {
    const barcodeNeedle = needle.replace(/[% ,().]/g, "")
    const { data: barcodeRows, error: barcodeError } = await db
      .from("pharmacy_item_barcodes")
      .select("item_id, barcode")
      .eq("pharmacy_id", pharmacyId)
      .ilike("barcode", `%${barcodeNeedle}%`)
      .limit(Math.min(rowLimit, 120))
    if (barcodeError) throw barcodeError
    const existingIds = new Set(rows.map((row) => row.id))
    const ids = Array.from(new Set(((barcodeRows ?? []) as ItemBarcodeRow[]).map((row) => row.item_id).filter(Boolean))).filter((id) => !existingIds.has(id))
    if (ids.length > 0) {
      let barcodeItemsQuery = db
        .from("pharmacy_items")
        .select("id, pharmacy_id, branch_id, group_id, brand_id, name_ar, name_en, sku, category, unit, manufacturer_name, item_type, sell_price, old_sell_price, buy_price, manage_inventory, not_for_sale, min_stock, opening_stock, has_expiry, track_batch, expiry_date, image_url, is_controlled, requires_prescription, status, updated_at")
        .eq("pharmacy_id", pharmacyId)
        .eq("status", "active")
        .or("not_for_sale.is.null,not_for_sale.eq.false")
        .in("id", ids)
      if (branchId) barcodeItemsQuery = barcodeItemsQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)
      const { data: barcodeItems, error: barcodeItemsError } = await barcodeItemsQuery
      if (barcodeItemsError) throw barcodeItemsError
      rows.push(...((barcodeItems ?? []) as CashierItemRow[]))
    }
  }

  const limitedRows = rows.slice(0, rowLimit)
  const itemIds = limitedRows.map((item) => item.id)
  const groupIds = Array.from(new Set(limitedRows.map((item) => item.group_id).filter((id): id is string => Boolean(id))))
  const brandIds = Array.from(new Set(limitedRows.map((item) => item.brand_id).filter((id): id is string => Boolean(id))))

  const [barcodes, balances, groups, brands, batches] = itemIds.length ? await Promise.all([
    db.from("pharmacy_item_barcodes").select("item_id, barcode, is_primary").eq("pharmacy_id", pharmacyId).in("item_id", itemIds),
    db.from("pharmacy_stock_balances").select("item_id, branch_id, quantity").eq("pharmacy_id", pharmacyId).in("item_id", itemIds),
    groupIds.length ? db.from("pharmacy_item_groups").select("id, name").eq("pharmacy_id", pharmacyId).in("id", groupIds) : Promise.resolve({ data: [], error: null }),
    brandIds.length ? db.from("pharmacy_item_brands").select("id, name").eq("pharmacy_id", pharmacyId).in("id", brandIds) : Promise.resolve({ data: [], error: null }),
    db
      .from("pharmacy_item_batches")
      .select("id, item_id, branch_id, batch_number, expiry_date, remaining_quantity")
      .eq("pharmacy_id", pharmacyId)
      .in("item_id", itemIds)
      .gt("remaining_quantity", 0)
      .gte("expiry_date", new Date().toISOString().slice(0, 10))
      .order("expiry_date", { ascending: true }),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const barcodeResult = barcodes as QueryResult<ItemBarcodeRow>
  const balanceResult = balances as QueryResult<StockBalanceRow>
  const groupResult = groups as QueryResult<NamedLookupRow>
  const brandResult = brands as QueryResult<NamedLookupRow>
  const batchResult = batches as QueryResult<ItemBatchRow>

  for (const result of [barcodeResult, balanceResult, groupResult, brandResult, batchResult]) {
    if (result.error) throw result.error
  }

  const barcodesByItem = new Map<string, ItemBarcodeRow[]>()
  for (const row of barcodeResult.data ?? []) {
    const list = barcodesByItem.get(row.item_id) ?? []
    list.push(row)
    barcodesByItem.set(row.item_id, list)
  }
  const qtyByItem = new Map<string, number>()
  for (const row of balanceResult.data ?? []) {
    if (branchId && row.branch_id !== branchId) continue
    qtyByItem.set(row.item_id, (qtyByItem.get(row.item_id) ?? 0) + n(row.quantity))
  }

  const groupMap = new Map<string, string>((groupResult.data ?? []).map((group) => [group.id, group.name]))
  const brandMap = new Map<string, string>((brandResult.data ?? []).map((brand) => [brand.id, brand.name]))
  const batchesByItem = new Map<string, ItemBatchRow[]>()
  for (const row of batchResult.data ?? []) {
    if (branchId && row.branch_id && row.branch_id !== branchId) continue
    const list = batchesByItem.get(row.item_id) ?? []
    list.push(row)
    batchesByItem.set(row.item_id, list)
  }

  return limitedRows.map((item) => {
    const itemBarcodes = barcodesByItem.get(item.id) ?? []
    const itemBatches = batchesByItem.get(item.id) ?? []
    const nearestBatch = itemBatches[0] ?? null
    return {
      ...item,
      sell_price: n(item.sell_price),
      old_sell_price: n(item.old_sell_price),
      buy_price: n(item.buy_price),
      available_qty: qtyByItem.get(item.id) ?? 0,
      barcode: itemBarcodes.find((b) => b.is_primary)?.barcode ?? itemBarcodes[0]?.barcode ?? item.sku ?? "",
      barcodes: itemBarcodes,
      group_name: item.group_id ? groupMap.get(item.group_id) ?? null : null,
      brand_name: item.brand_id ? brandMap.get(item.brand_id) ?? null : null,
      nearest_batch_id: nearestBatch?.id ?? null,
      nearest_batch_number: nearestBatch?.batch_number ?? null,
      nearest_expiry: nearestBatch?.expiry_date ?? item.expiry_date ?? null,
      active_batches_count: itemBatches.length,
    }
  })
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const query = clean(url.searchParams.get("query"))
    const limit = safeLimit(url.searchParams.get("limit"), query ? 80 : 120)
    const offset = safeOffset(url.searchParams.get("offset"))
    const scope = await getScopeFromRequest(request)
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:read") && !scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية الكاشير" }, { status: 403 })

    const branchId = url.searchParams.get("branch_id") && url.searchParams.get("branch_id") !== "all"
      ? url.searchParams.get("branch_id")
      : scope.activeBranchId
    assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const products = await loadProducts(db, scope.activePharmacyId, branchId, query, limit, offset)

    let recentSalesQuery = db
      .from("pharmacy_sales")
      .select("id, invoice_number, customer_name, total, paid_amount, payment_method, sale_date")
      .eq("pharmacy_id", scope.activePharmacyId)
      .order("sale_date", { ascending: false })
      .limit(10)
    if (branchId) recentSalesQuery = recentSalesQuery.eq("branch_id", branchId)
    const { data: recentSales } = await recentSalesQuery

    return NextResponse.json({
      products,
      recentSales: recentSales ?? [],
      pharmacyId: scope.activePharmacyId,
      branchId,
      hasMore: !query && products.length === limit,
      nextOffset: !query && products.length === limit ? offset + products.length : null,
    })
  } catch (error) {
    console.error("cashier GET failed", error)
    const message = error instanceof Error ? error.message : "فشل تحميل بيانات الكاشير"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const scope = await getServerAuthScope({ requestedPharmacyId: body.pharmacy_id ?? null, requestedBranchId: body.branch_id ?? null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولًا" }, { status: 400 })
    if (!scopeCan(scope, "sales:write")) return NextResponse.json({ error: "ليست لديك صلاحية تنفيذ البيع" }, { status: 403 })

    const branchId = clean(body.branch_id) || scope.activeBranchId
    if (!branchId) return NextResponse.json({ error: "اختر فرعًا قبل البيع" }, { status: 400 })
    assertBranchScope(scope, branchId)

    const supabase = await createClient()
    const db = getDbClient(supabase) as SupabaseClient
    const pharmacyId = scope.activePharmacyId
    const rawLines = Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []
    const quantityPolicies = new ItemQuantityPolicyRepository(db, pharmacyId)
    const lines = await quantityPolicies.normalizeTransactionLines(rawLines, { label: "كمية البيع" })
    const shiftId = clean(body.shift_id)
    if (!shiftId) throw new Error("لازم تفتح جلسة الكاشير وتكتب نقدية الدرج قبل البيع")
    const clientRequestId = clean(body.client_request_id) || crypto.randomUUID()
    const invoiceDiscount = scopeCan(scope, "sales:discount") ? Math.max(0, n(body.discount_total)) : 0
    const couponCode = clean(body.coupon_code) || null
    const patientId = clean(body.patient_id) || null
    let partnerId = clean(body.customer_id || body.partner_id) || null
    let patientName = clean(body.patient_name) || null
    if (patientId) {
      const { data: patient, error: patientError } = await db
        .from("pharmacy_patients")
        .select("id,partner_id,name,status")
        .eq("id", patientId)
        .eq("pharmacy_id", pharmacyId)
        .maybeSingle()
      if (patientError) throw patientError
      if (!patient || patient.status === "archived") throw new Error("ملف المريض غير موجود أو مؤرشف")
      patientName = patient.name
      partnerId = partnerId || patient.partner_id || null
    }
    if (partnerId) {
      const { data: partner, error: partnerError } = await db
        .from("pharmacy_partners")
        .select("id,name,status,type")
        .eq("id", partnerId)
        .eq("pharmacy_id", pharmacyId)
        .maybeSingle()
      if (partnerError) throw partnerError
      if (!partner || partner.status !== "active" || !["customer", "both"].includes(partner.type)) throw new Error("العميل غير موجود أو غير نشط")
    }
    const doctorName = clean(body.doctor_name) || null
    const prescriptionNumber = clean(body.prescription_number) || null

    const itemIds = Array.from(new Set(lines.map((line: Record<string, unknown>) => clean(line.item_id)).filter(Boolean)))
    if (itemIds.length !== lines.length && itemIds.length === 0) throw new Error("بيانات أصناف الفاتورة غير صالحة")
    const { data: regulatedItems, error: regulatedError } = await db
      .from("pharmacy_items")
      .select("id,name_ar,is_controlled,requires_prescription")
      .eq("pharmacy_id", pharmacyId)
      .in("id", itemIds)
      .or("is_controlled.eq.true,requires_prescription.eq.true")
    if (regulatedError) throw regulatedError
    const regulatedRows = (regulatedItems ?? []) as Array<{ id: string; name_ar: string | null; is_controlled: boolean | null; requires_prescription: boolean | null }>
    if (regulatedRows.length > 0) {
      const names = regulatedRows.map((item) => item.name_ar).filter(Boolean).join("، ")
      if (!patientId) throw new Error(`يجب اختيار ملف مريض قبل صرف: ${names}`)
      if (!doctorName) throw new Error(`اسم الطبيب مطلوب لصرف: ${names}`)
      if (!prescriptionNumber) throw new Error(`رقم الوصفة مطلوب لصرف: ${names}`)
      if (regulatedRows.some((item) => item.is_controlled)) {
        const { data: patientIdentity, error: identityError } = await db
          .from("pharmacy_patients")
          .select("id,id_number")
          .eq("id", patientId)
          .eq("pharmacy_id", pharmacyId)
          .maybeSingle()
        if (identityError) throw identityError
        if (!patientIdentity?.id_number) throw new Error("رقم هوية المريض مطلوب لصرف دواء مراقب")
      }
    }

    const saleService = new CashierSaleService(db)
    const result = await saleService.create({
      p_pharmacy_id: pharmacyId,
      p_branch_id: branchId,
      p_shift_id: shiftId,
      p_actor_id: scope.user.id,
      p_client_request_id: clientRequestId,
      p_customer_name: clean(body.customer_name) || "زبون نقدي",
      p_payment_method: clean(body.payment_method) || "cash",
      p_paid_amount: Money.nonNegative(body.paid_amount).toNumber(),
      p_invoice_discount: Money.nonNegative(invoiceDiscount).toNumber(),
      p_tax_total: Money.nonNegative(body.tax_total).toNumber(),
      p_shipping_fee: Money.nonNegative(body.shipping_fee).toNumber(),
      p_rounding_adj: Money.from(body.rounding_adj as number).toNumber(),
      p_notes: clean(body.notes) || null,
      p_coupon_code: couponCode,
      p_patient_name: patientName,
      p_doctor_name: doctorName,
      p_prescription_number: prescriptionNumber,
      p_lines: lines,
      p_patient_id: patientId,
      p_partner_id: partnerId,
    })

    const finalization = (result.finalization ?? null) as Record<string, unknown> | null

    await writeAuditLog(db, {
      pharmacyId,
      branchId,
      actorId: scope.user.id,
      eventType: result.duplicate ? "sale.duplicate_ignored" : "sale.created",
      source: "sales",
      description: result.duplicate ? "تم تجاهل طلب بيع مكرر بنفس رقم الطلب" : "تم إنشاء فاتورة بيع من الكاشير",
      metadata: {
        sale_id: result.sale?.id,
        invoice_number: result.sale?.invoice_number,
        total: result.sale?.total,
        paid_amount: result.sale?.paid_amount,
        payment_method: result.sale?.payment_method ?? clean(body.payment_method),
        lines_count: lines.length,
        client_request_id: clientRequestId,
        patient_id: patientId,
        customer_id: partnerId,
        finalization,
      },
    })
    return NextResponse.json({ ...result, finalization }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("cashier POST failed", error)
    const failure = cashierErrorResponse(error)
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status })
  }
}
