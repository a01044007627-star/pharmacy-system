import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { adjustOpeningStock } from "@/lib/inventory/opening-stock"

type Context = { params: Promise<{ itemId: string }> }

function getDbClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(_request: Request, context: Context) {
  try {
    const { itemId } = await context.params
    const scope = await getServerAuthScope()
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض الأصناف" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase

    const { data: item, error } = await db.from("pharmacy_items").select("*,group:pharmacy_item_groups(id,name),brand:pharmacy_item_brands(id,name)").eq("id", itemId).eq("pharmacy_id", scope.activePharmacyId).maybeSingle()
    if (error) throw error
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    const [barcodes, units, variants] = await Promise.all([
      db.from("pharmacy_item_barcodes").select("id,barcode,is_primary").eq("item_id", itemId).eq("pharmacy_id", scope.activePharmacyId),
      db.from("pharmacy_item_units").select("id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw").eq("item_id", itemId).eq("pharmacy_id", scope.activePharmacyId),
      db.from("pharmacy_item_variants").select("id,name,value,sku,sell_price,purchase_price").eq("item_id", itemId).eq("pharmacy_id", scope.activePharmacyId).order("created_at"),
    ])

    return NextResponse.json({ item, barcodes: barcodes.data ?? [], units: units.data ?? [], variants: variants.data ?? [] })
  } catch (error) {
    console.error("item detail GET failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تحميل الصنف" }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { itemId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = await getServerAuthScope({ requestedPharmacyId: String(body.pharmacy_id ?? "") || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل الأصناف" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId

    const { data: oldItem, error: oldError } = await db
      .from("pharmacy_items")
      .select("id, opening_stock, branch_id, manage_inventory, buy_price, unit, track_batch, has_expiry")
      .eq("id", itemId)
      .eq("pharmacy_id", pharmacyId)
      .maybeSingle()
    if (oldError) throw oldError
    if (!oldItem) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const fields = [
      "name_ar","name_en","sku","group_id","brand_id","unit","item_type","manufacturer_name","buy_price","sell_price","old_sell_price",
      "manage_inventory","not_for_sale","min_stock","max_stock","opening_stock","has_expiry","track_batch","is_controlled","requires_prescription",
      "notes","image_url","branch_id","status","expiry_date","category","sub_category","barcode_type","expiry_period_value","expiry_period_unit",
      "tax_name","tax_percent","selling_price_tax_type","product_type","variation_name","variation_values","variation_skus","purchase_price_including_tax",
      "purchase_price_excluding_tax","profit_margin","opening_stock_location","serial_tracking_enabled","weight","rack","shelf_row","position",
      "product_description","custom_field_1","custom_field_2","custom_field_3","custom_field_4","product_locations",
    ]
    for (const field of fields) {
      if (field in body) updates[field] = body[field]
    }

    const { data: item, error } = await db.from("pharmacy_items").update(updates).eq("id", itemId).eq("pharmacy_id", pharmacyId).select("*").maybeSingle()
    if (error) throw error
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    if ("opening_stock" in body && item.manage_inventory !== false) {
      const delta = num(item.opening_stock) - num((oldItem as { opening_stock?: unknown }).opening_stock)
      if (delta !== 0) {
        await adjustOpeningStock(db, {
          pharmacyId,
          itemId,
          branchId: clean(body.opening_stock_branch_id) || clean(item.branch_id) || scope.activeBranchId,
          fallbackBranchId: clean((oldItem as { branch_id?: unknown }).branch_id) || scope.activeBranchId,
          actorId: scope.user.id,
          quantity: Math.abs(delta),
          delta,
          unitPrice: item.buy_price,
          unit: item.unit,
          batchNumber: clean(body.batch_number) || null,
          expiryDate: clean(body.expiry_date) || null,
          trackBatch: Boolean(item.track_batch),
          hasExpiry: Boolean(item.has_expiry),
        })
      }
    }

    if (Array.isArray(body.variation_values)) {
      const variationValues = (body.variation_values as unknown[]).map(clean).filter(Boolean)
      const variationSkus = Array.isArray(body.variation_skus) ? (body.variation_skus as unknown[]).map(clean).filter(Boolean) : []
      const { error: deleteVariantsError } = await db.from("pharmacy_item_variants").delete().eq("item_id", itemId).eq("pharmacy_id", pharmacyId)
      if (deleteVariantsError) throw deleteVariantsError
      if ((clean(body.product_type) || clean(item.product_type) || "single") === "variable" && variationValues.length > 0) {
        const rows = variationValues.map((value, index) => ({
          pharmacy_id: pharmacyId,
          item_id: itemId,
          name: clean(body.variation_name) || clean(item.variation_name) || "Variation",
          value,
          sku: variationSkus[index] || null,
          purchase_price: Math.max(0, Number(body.purchase_price_excluding_tax || item.buy_price) || 0),
          sell_price: Math.max(0, Number(item.sell_price) || 0),
          metadata: { source: "item_edit_form" },
        }))
        const { error: variantError } = await db.from("pharmacy_item_variants").insert(rows)
        if (variantError) throw variantError
      }
    }

    const [barcodes, units] = await Promise.all([
      Array.isArray(body.barcodes)
        ? db.from("pharmacy_item_barcodes").delete().eq("item_id", itemId).eq("pharmacy_id", pharmacyId)
          .then(async ({ error: deleteError }) => {
            if (deleteError) throw deleteError
            const rows = (body.barcodes as Array<{ barcode?: string; is_primary?: boolean }>)
              .map((barcode, index) => ({ pharmacy_id: pharmacyId, item_id: itemId, barcode: clean(barcode.barcode), is_primary: barcode.is_primary ?? index === 0 }))
              .filter((barcode) => barcode.barcode)
            if (rows.length === 0) return { data: [], error: null }
            return db.from("pharmacy_item_barcodes").insert(rows).select("id,barcode,is_primary")
          })
        : db.from("pharmacy_item_barcodes").select("id,barcode,is_primary").eq("item_id", itemId).eq("pharmacy_id", pharmacyId),
      Array.isArray(body.units)
        ? db.from("pharmacy_item_units").delete().eq("item_id", itemId).eq("pharmacy_id", pharmacyId)
          .then(async ({ error: deleteError }) => {
            if (deleteError) throw deleteError
            const rows = (body.units as Array<{ unit_name?: string; factor?: number; barcode?: string; sell_price?: number; is_base?: boolean; main_unit?: string; sub_unit?: string; qty_per_main_unit?: number; unit_raw?: string }>)
              .map((unit) => ({
                pharmacy_id: pharmacyId,
                item_id: itemId,
                unit_name: clean(unit.unit_name),
                factor: Math.max(0.001, num(unit.factor) || 1),
                barcode: clean(unit.barcode) || null,
                sell_price: Number.isFinite(Number(unit.sell_price)) ? Number(unit.sell_price) : null,
                is_base: Boolean(unit.is_base),
                main_unit: clean(unit.main_unit) || null,
                sub_unit: clean(unit.sub_unit) || null,
                qty_per_main_unit: Math.max(0, num(unit.qty_per_main_unit) || 0),
                unit_raw: clean(unit.unit_raw) || null,
              }))
              .filter((unit) => unit.unit_name)
            if (rows.length === 0) return { data: [], error: null }
            return db.from("pharmacy_item_units").insert(rows).select("id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw")
          })
        : db.from("pharmacy_item_units").select("id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw").eq("item_id", itemId).eq("pharmacy_id", pharmacyId),
    ])
    if ((barcodes as { error?: { message?: string } | null }).error) throw (barcodes as { error: Error }).error
    if ((units as { error?: { message?: string } | null }).error) throw (units as { error: Error }).error

    return NextResponse.json({ item, barcodes: (barcodes as { data?: unknown[] }).data ?? [], units: (units as { data?: unknown[] }).data ?? [] })
  } catch (error) {
    console.error("item PATCH failed", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "فشل تعديل الصنف" }, { status: 400 })
  }
}
