import "server-only"

import { createClient } from "@/lib/supabase/server"

export async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/**
 * Lightweight server auth helper used by App Router pages.
 * The project is Supabase-based, not NextAuth-based, so this keeps old imports
 * like `import { auth } from "@/lib/auth"` safe without changing every page.
 */
export async function auth() {
  const user = await getAuthenticatedUser()
  return user ? { user } : null
}
