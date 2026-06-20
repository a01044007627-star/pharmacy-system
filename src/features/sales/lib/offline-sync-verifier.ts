import type { SupabaseClient } from "@supabase/supabase-js"
import type { SaleLineSnapshot } from "@/domain/sales/sales-line-factory"

export async function verifyOfflineSale(
  db: SupabaseClient,
  operationId: string,
  snapshot: SaleLineSnapshot,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const { data: item, error: itemError } = await db
      .from("pharmacy_items")
      .select("id, status, manage_inventory, track_batch, has_expiry, expiry_date")
      .eq("id", snapshot.itemId)
      .maybeSingle()

    if (itemError) throw itemError
    if (!item) return { valid: false, error: "الصنف غير موجود في قاعدة البيانات" }
    if (String(item.status) !== "active") return { valid: false, error: "الصنف غير نشط" }

    const { data: units, error: unitsError } = await db
      .from("pharmacy_item_units")
      .select("id, unit_name, factor, barcode, sell_price, sale_enabled")
      .eq("item_id", snapshot.itemId)

    if (unitsError) throw unitsError

    const matchedUnit = units?.find((u) => String(u.id) === snapshot.unitId)
    if (!matchedUnit) return { valid: false, error: "الوحدة المبيعة غير موجودة أو أُزيلت" }
    if (matchedUnit.sale_enabled === false) return { valid: false, error: "الوحدة غير مسموح بيعها" }

    if (Number(matchedUnit.factor) !== snapshot.conversionToBase) {
      return {
        valid: false,
        error: `معامل تحويل الوحدة تغير منذ البيع المحلي (المسجل: ${snapshot.conversionToBase}، الحالي: ${matchedUnit.factor})`,
      }
    }

    const { data: existingSales, error: existingError } = await db
      .from("pharmacy_sales")
      .select("id")
      .eq("client_request_id", operationId)
      .limit(1)

    if (existingError) throw existingError
    if (existingSales && existingSales.length > 0) {
      return { valid: false, error: "تم تطبيق عملية البيع هذه بالفعل" }
    }

    return { valid: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطأ في التحقق من البيع"
    return { valid: false, error: message }
  }
}
