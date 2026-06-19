import { createBrowserClient } from "@supabase/ssr"

const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co"
const FALLBACK_SUPABASE_ANON_KEY = "placeholder-anon-key"

export function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY,
    isConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  }
}

export function createClient() {
  const config = getSupabaseConfig()
  return createBrowserClient(config.url, config.anonKey)
}
