"use client"

import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { ROUTES } from "@/config/routes"
import type { AuthResult } from "@/types"
import { apiClient } from "@/lib/http/api-client"

type BrowserSessionPayload = Pick<Session, "access_token" | "refresh_token"> | null | undefined

async function syncBrowserSession(session: BrowserSessionPayload) {
  if (!session?.access_token || !session.refresh_token) return
  const supabase = createClient()
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const result = await apiClient.post<AuthResult>(ROUTES.api.login, { email, password }, {
    fallbackMessage: "فشل تسجيل الدخول",
  })
  await syncBrowserSession(result.session)
  return result
}

export async function signupUser(
  email: string,
  password: string,
  fullName: string,
  projectName: string,
  currency: string,
  options?: {
    phone?: string
    country?: string
    city?: string
    timezone?: string
    username?: string
  },
): Promise<AuthResult> {
  const result = await apiClient.post<AuthResult>(ROUTES.api.signup, {
    email,
    password,
    displayName: fullName,
    projectName,
    currency,
    ...options,
  }, {
    fallbackMessage: "فشل إنشاء الحساب",
  })
  await syncBrowserSession(result.session)
  return result
}

export async function logoutUser(): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.auth.signOut()

  apiClient.post("/api/auth/audit", {
    action: "logout",
    email: user?.email,
    metadata: {},
  }).catch(() => {})
}

export async function resetPassword(email: string): Promise<void> {
  await apiClient.post(ROUTES.api.forgotPassword, { email }, {
    fallbackMessage: "فشل إرسال رابط استعادة كلمة المرور",
  })
}

export async function updatePassword(password: string): Promise<void> {
  await apiClient.post(ROUTES.api.updatePassword, { password }, {
    fallbackMessage: "فشل تحديث كلمة المرور",
  })
}
