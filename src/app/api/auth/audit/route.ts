import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const { action, email, metadata } = await request.json()
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from("pharmacy_user_sessions").insert({
      user_id: user?.id ?? email,
      pharmacy_id: metadata?.pharmacy_id ?? null,
      token: `audit_${Date.now()}`,
      ip_address: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
      user_agent: request.headers.get("user-agent") ?? null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      last_active_at: new Date().toISOString(),
      is_revoked: action === "logout",
    }).maybeSingle()

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false }, { status: 200 })
  }
}
