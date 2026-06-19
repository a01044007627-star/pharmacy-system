import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { ROUTES, AUTH_ROUTES } from "@/config/routes"
import { isSuperAdmin, SUPER_ADMIN_ROLE } from "@/config/super-admin"

const staticPaths = ["/_next/static", "/_next/image", "/favicon.ico", "/manifest.json", "/sounds", "/icons", "/pharmacy-hero.png", "/sw.js", "/sql-wasm.wasm"]

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl
  const isStatic = staticPaths.some((p) => pathname.startsWith(p))
  const isHome = pathname === "/"
  const isApi = pathname.startsWith("/api")
  const isAuthRoute = AUTH_ROUTES.some((p) => pathname.startsWith(p))

  if (isStatic || isHome || isApi) return NextResponse.next()

  if (!hasSupabaseEnv()) {
    // لا نوقع الموقع كله لو متغيرات Supabase ناقصة على Vercel/Preview.
    // صفحات الدخول تفتح، وباقي اللوحة تتحول للدخول بدل 500.
    if (isAuthRoute) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = ROUTES.login
    return NextResponse.redirect(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const role = user.user_metadata?.role as string | undefined
    const email = user.email

    if (isSuperAdmin(email) && role !== SUPER_ADMIN_ROLE) {
      await supabase.auth.updateUser({ data: { ...user.user_metadata, role: SUPER_ADMIN_ROLE } })
    }

    if (isAuthRoute) {
      const url = request.nextUrl.clone()
      url.pathname = ROUTES.dashboard
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  }

  if (!isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = ROUTES.login
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sounds|icons|pharmacy-hero.png|sw.js|sql-wasm.wasm).*)"],
}
