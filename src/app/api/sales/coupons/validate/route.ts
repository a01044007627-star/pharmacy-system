import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthScope } from "@/lib/auth/session"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const pharmacyId = url.searchParams.get("pharmacy_id")
    const subtotal = Number(url.searchParams.get("subtotal")) || 0

    if (!code || !pharmacyId) {
      return NextResponse.json({ valid: false, error: "بيانات غير كاملة" }, { status: 400 })
    }

    const scope = await getServerAuthScope({ requestedPharmacyId: pharmacyId })
    if (!scope.user || !scope.activePharmacyId) {
      return NextResponse.json({ valid: false, error: "غير مسجل الدخول" }, { status: 401 })
    }

    const supabase = await createClient()

    const { data: coupon, error } = await supabase
      .from("pharmacy_coupons")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .eq("code", code.toUpperCase())
      .eq("is_active", true)
      .maybeSingle()

    if (error || !coupon) {
      return NextResponse.json({ valid: false, error: "الكوبون غير صالح" })
    }

    // Check max uses
    if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json({ valid: false, error: "تم استخدام الكوبون لأقصى عدد مرات مسموح" })
    }

    // Check dates
    const now = new Date()
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return NextResponse.json({ valid: false, error: "الكوبون لم يبدأ بعد" })
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return NextResponse.json({ valid: false, error: "الكوبون منتهي الصلاحية" })
    }

    // Check min purchase
    if (subtotal < (coupon.min_purchase || 0)) {
      return NextResponse.json({ valid: false, error: `الحد الأدنى للشراء هو ${coupon.min_purchase}` })
    }

    // Calculate discount
    let discount = 0
    if (coupon.discount_type === "percentage") {
      discount = Math.round(subtotal * coupon.discount_value / 100 * 100) / 100
    } else {
      discount = coupon.discount_value
    }
    discount = Math.min(discount, Math.max(0, subtotal))

    return NextResponse.json({
      valid: true,
      discount,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      code: coupon.code,
    })
  } catch (error) {
    console.error("coupon validation failed", error)
    return NextResponse.json({ valid: false, error: "فشل التحقق من الكوبون" }, { status: 500 })
  }
}
