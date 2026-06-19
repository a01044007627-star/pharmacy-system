"use client"

import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { ROUTES } from "@/config/routes"
import type { AuthResult } from "@/types"

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error ?? "حدث خطأ غير متوقع")
  return data as T
}

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
  const response = await fetch(ROUTES.api.login, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const result = await readJson<AuthResult>(response)
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
  const response = await fetch(ROUTES.api.signup, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: fullName, projectName, currency, ...options }),
  })
  const result = await readJson<AuthResult>(response)
  await syncBrowserSession(result.session)
  return result
}

export async function logoutUser(): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.auth.signOut()

  fetch("/api/auth/audit", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logout", email: user?.email, metadata: {} }),
  }).catch(() => {})
}

export async function resetPassword(email: string): Promise<void> {
  const res = await fetch(ROUTES.api.forgotPassword, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
  await readJson(res)
}

export async function updatePassword(password: string): Promise<void> {
  const res = await fetch(ROUTES.api.updatePassword, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
  await readJson(res)
}
