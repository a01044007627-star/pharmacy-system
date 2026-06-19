import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"

async function handleLogout(request: NextRequest) {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch {
    // ignore
  }

  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()
  const origin = request.nextUrl?.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  const response = NextResponse.redirect(new URL("/auth/login", origin))

  for (const cookie of allCookies) {
    response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 })
  }

  return response
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}

export async function POST(request: NextRequest) {
  return handleLogout(request)
}
