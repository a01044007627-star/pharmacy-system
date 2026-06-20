import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"
import { assertBranchScope, scopeCan } from "@/lib/auth/server-permissions"
import { adjustOpeningStock } from "@/lib/inventory/opening-stock"
import { cleanItemText, finiteNonNegative, normalizeBarcodeInputs, normalizeItemName, postgresErrorMessage } from "@/features/inventory/lib/item-input"

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

export async function GET(request: Request, context: Context) {
  try {
    const { itemId } = await context.params
    const requestedPharmacyId = clean(new URL(request.url).searchParams.get("pharmacy_id")) || null
    const scope = await getServerAuthScope({ requestedPharmacyId })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:read")) return NextResponse.json({ error: "ليست لديك صلاحية عرض الأصناف" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase

    const { data: item, error } = await db.from("pharmacy_items").select("*,group:pharmacy_item_groups(id,name),brand:pharmacy_item_brands(id,name)").eq("id", itemId).eq("pharmacy_id", scope.activePharmacyId).maybeSingle()
    if (error) throw error
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })
    if (item.branch_id) assertBranchScope(scope, item.branch_id as string)

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
    const scope = await getServerAuthScope({ requestedPharmacyId: cleanItemText(body.pharmacy_id) || null })
    if (!scope.user) return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 })
    if (!scope.activePharmacyId) return NextResponse.json({ error: "اختر صيدلية أولاً" }, { status: 400 })
    if (!scopeCan(scope, "inventory:update")) return NextResponse.json({ error: "ليست لديك صلاحية تعديل الأصناف" }, { status: 403 })

    const supabase = await createClient()
    const db = getDbClient() ?? supabase
    const pharmacyId = scope.activePharmacyId

    const { data: oldItem, error: oldError } = await db
      .from("pharmacy_items")
      .select("*")
      .eq("id", itemId)
      .eq("pharmacy_id", pharmacyId)
      .maybeSingle()
    if (oldError) throw oldError
    if (!oldItem) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    if (oldItem.branch_id) assertBranchScope(scope, oldItem.branch_id as string)

    const requestedName = "name_ar" in body ? cleanItemText(body.name_ar) : cleanItemText(oldItem.name_ar)
    if (!requestedName) return NextResponse.json({ error: "اسم الصنف مطلوب" }, { status: 400 })

    const { data: sameNames, error: sameNameError } = await db
      .from("pharmacy_items")
      .select("id,name_ar")
      .eq("pharmacy_id", pharmacyId)
      .neq("id", itemId)
      .neq("status", "deleted")
      .ilike("name_ar", requestedName)
      .limit(20)
    if (sameNameError) throw sameNameError
    const duplicateName = (sameNames ?? []).find((row) => normalizeItemName(row.name_ar) === normalizeItemName(requestedName))
    if (duplicateName) return NextResponse.json({ error: `يوجد صنف بنفس الاسم: ${duplicateName.name_ar}` }, { status: 409 })

    const hasBarcodes = Array.isArray(body.barcodes)
    const hasUnits = Array.isArray(body.units)
    const normalizedRelations = normalizeBarcodeInputs(
      hasBarcodes ? body.barcodes as Array<{ barcode?: unknown; is_primary?: boolean }> : [],
      hasUnits ? body.units as Array<Record<string, unknown>> : [],
    )
    if ((hasBarcodes || hasUnits) && normalizedRelations.duplicates.length > 0) {
      return NextResponse.json({ error: `الباركود مكرر داخل الصنف: ${normalizedRelations.duplicates.join("، ")}` }, { status: 409 })
    }

    if ((hasBarcodes || hasUnits) && normalizedRelations.all.length > 0) {
      const [{ data: mainRows, error: mainError }, { data: unitRows, error: unitError }] = await Promise.all([
        db.from("pharmacy_item_barcodes").select("barcode,item_id").eq("pharmacy_id", pharmacyId).neq("item_id", itemId).in("barcode", normalizedRelations.all),
        db.from("pharmacy_item_units").select("barcode,item_id").eq("pharmacy_id", pharmacyId).neq("item_id", itemId).in("barcode", normalizedRelations.all),
      ])
      if (mainError) throw mainError
      if (unitError) throw unitError
      const used = [...(mainRows ?? []), ...(unitRows ?? [])].map((row) => row.barcode).filter(Boolean)
      if (used.length > 0) return NextResponse.json({ error: `الباركود مستخدم بالفعل: ${used.join("، ")}` }, { status: 409 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const textFields = [
      "name_ar", "name_en", "sku", "group_id", "brand_id", "unit", "item_type", "manufacturer_name", "manufacturer_country",
      "pharmacy_type", "generic_name", "active_ingredient", "therapeutic_class", "dosage_form", "strength", "package_size",
      "route_of_administration", "registration_number", "storage_condition", "notes", "image_url",
      "branch_id", "status", "expiry_date", "category", "sub_category", "barcode_type", "expiry_period_unit", "tax_name",
      "selling_price_tax_type", "product_type", "variation_name", "opening_stock_location", "rack", "shelf_row", "position",
      "product_description", "custom_field_1", "custom_field_2", "custom_field_3", "custom_field_4",
    ]
    const nullableIds = new Set(["group_id", "brand_id", "branch_id"])
    for (const field of textFields) {
      if (!(field in body)) continue
      const value = cleanItemText(body[field])
      updates[field] = value || (nullableIds.has(field) || field !== "name_ar" ? null : value)
    }

    const numberFields = [
      "buy_price", "sell_price", "old_sell_price", "min_stock", "max_stock", "opening_stock", "expiry_period_value",
      "tax_percent", "purchase_price_including_tax", "purchase_price_excluding_tax", "profit_margin", "weight",
    ]
    for (const field of numberFields) if (field in body) updates[field] = finiteNonNegative(body[field])

    const booleanFields = [
      "manage_inventory", "not_for_sale", "has_expiry", "track_batch", "is_controlled", "requires_prescription", "serial_tracking_enabled",
    ]
    for (const field of booleanFields) if (field in body) updates[field] = Boolean(body[field])

    for (const field of ["variation_values", "variation_skus", "product_locations"]) {
      if (field in body) updates[field] = Array.isArray(body[field]) ? (body[field] as unknown[]).map(cleanItemText).filter(Boolean) : []
    }

    const { data: item, error: updateError } = await db
      .from("pharmacy_items")
      .update(updates)
      .eq("id", itemId)
      .eq("pharmacy_id", pharmacyId)
      .select("*")
      .maybeSingle()
    if (updateError) throw updateError
    if (!item) return NextResponse.json({ error: "الصنف غير موجود" }, { status: 404 })

    let variants: Array<Record<string, unknown>> | null = null
    if (Array.isArray(body.variation_values)) {
      const values = (body.variation_values as unknown[]).map(cleanItemText).filter(Boolean)
      const skus = Array.isArray(body.variation_skus) ? (body.variation_skus as unknown[]).map(cleanItemText) : []
      variants = (cleanItemText(body.product_type) || cleanItemText(item.product_type) || "single") === "variable"
        ? values.map((value, index) => ({
            name: cleanItemText(body.variation_name) || cleanItemText(item.variation_name) || "Variation",
            value,
            sku: skus[index] || null,
            purchase_price: finiteNonNegative(body.purchase_price_excluding_tax ?? item.buy_price),
            sell_price: finiteNonNegative(item.sell_price),
            metadata: { source: "item_edit_form" },
          }))
        : []
    }

    if (hasBarcodes || hasUnits || variants !== null) {
      const relationResult = await db.rpc("pharmacy_replace_item_relations", {
        p_pharmacy_id: pharmacyId,
        p_item_id: itemId,
        p_barcodes: hasBarcodes ? normalizedRelations.barcodes : null,
        p_units: hasUnits ? normalizedRelations.units : null,
        p_variants: variants,
      })
      if (relationResult.error) throw relationResult.error
    }

    if ("opening_stock" in body && item.manage_inventory !== false) {
      const delta = num(item.opening_stock) - num(oldItem.opening_stock)
      if (delta !== 0) {
        await adjustOpeningStock(db, {
          pharmacyId,
          itemId,
          branchId: cleanItemText(body.opening_stock_branch_id) || cleanItemText(item.branch_id) || scope.activeBranchId,
          fallbackBranchId: cleanItemText(oldItem.branch_id) || scope.activeBranchId,
          actorId: scope.user.id,
          quantity: Math.abs(delta),
          delta,
          unitPrice: item.buy_price,
          unit: item.unit,
          batchNumber: cleanItemText(body.batch_number) || null,
          expiryDate: cleanItemText(body.expiry_date) || null,
          trackBatch: Boolean(item.track_batch),
          hasExpiry: Boolean(item.has_expiry),
        })
      }
    }

    const [barcodes, units, itemVariants] = await Promise.all([
      db.from("pharmacy_item_barcodes").select("id,barcode,is_primary").eq("item_id", itemId).eq("pharmacy_id", pharmacyId),
      db.from("pharmacy_item_units").select("id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw").eq("item_id", itemId).eq("pharmacy_id", pharmacyId),
      db.from("pharmacy_item_variants").select("id,name,value,sku,sell_price,purchase_price").eq("item_id", itemId).eq("pharmacy_id", pharmacyId).order("created_at"),
    ])

    return NextResponse.json({ item, barcodes: barcodes.data ?? [], units: units.data ?? [], variants: itemVariants.data ?? [] })
  } catch (error) {
    console.error("item PATCH failed", error)
    const message = postgresErrorMessage(error, "فشل تعديل الصنف")
    return NextResponse.json({ error: message }, { status: /مستخدم بالفعل|مكرر/.test(message) ? 409 : 400 })
  }
}
