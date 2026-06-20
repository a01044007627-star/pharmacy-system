"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { hasPermission, normalizeRole, type Permission } from "@/lib/auth/permissions"
import type { AuthScope, BranchSummary, MedicalRole, PharmacyMembership, PharmacySummary, UserProfile } from "@/types"
import { apiRequest } from "@/lib/api-client"
import { network } from "@/lib/network"
import { localDB } from "@/lib/sync/local-db"

interface ClientAuthScope extends Omit<AuthScope, "user" | "session"> {
  user: User | null
  session: Session | null
}

interface AuthState extends ClientAuthScope {
  loading: boolean
  error: string | null
  can: (permission: Permission) => boolean
  refreshAuth: (scope?: { pharmacyId?: string | null; branchId?: string | null }) => Promise<void>
  setActiveScope: (scope: { pharmacyId?: string | null; branchId?: string | null }) => Promise<void>
  signOut: () => void
}

type ApiAuthResponse = {
  user: Partial<User> & { id: string; email?: string | null; user_metadata?: Record<string, unknown> }
  profile: UserProfile | null
  role: MedicalRole
  isDeveloper: boolean
  isOwner: boolean
  activePharmacyId: string | null
  activeBranchId: string | null
  activePharmacy: PharmacySummary | null
  activeBranch: BranchSummary | null
  memberships: PharmacyMembership[]
  branches: BranchSummary[]
}

type CachedAuthScope = Omit<ClientAuthScope, "user" | "session"> & {
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }
  savedAt: number
}

const AUTH_CACHE_KEY = "pharmacy-auth-scope-v2"
const AUTH_CACHE_TTL = 30 * 24 * 60 * 60 * 1000
const defaultCan = () => false

const emptyScope: ClientAuthScope = {
  user: null,
  session: null,
  profile: null,
  role: "no-access",
  isDeveloper: false,
  isOwner: false,
  activePharmacyId: null,
  activeBranchId: null,
  activePharmacy: null,
  activeBranch: null,
  memberships: [],
  branches: [],
}

const AuthContext = createContext<AuthState>({
  ...emptyScope,
  loading: true,
  error: null,
  can: defaultCan,
  refreshAuth: async () => {},
  setActiveScope: async () => {},
  signOut: () => {},
})

function readStoredScope() {
  if (typeof window === "undefined") return { pharmacyId: null, branchId: null }
  return { pharmacyId: localStorage.getItem("active-pharmacy-id"), branchId: localStorage.getItem("active-branch-id") }
}

function persistScope(pharmacyId: string | null, branchId: string | null) {
  if (typeof window === "undefined") return
  const maxAge = 60 * 60 * 24 * 30
  if (pharmacyId) {
    localStorage.setItem("active-pharmacy-id", pharmacyId)
    document.cookie = `active-pharmacy-id=${encodeURIComponent(pharmacyId)}; path=/; max-age=${maxAge}; samesite=lax`
  } else {
    localStorage.removeItem("active-pharmacy-id")
    document.cookie = "active-pharmacy-id=; path=/; max-age=0; samesite=lax"
  }
  if (branchId) {
    localStorage.setItem("active-branch-id", branchId)
    document.cookie = `active-branch-id=${encodeURIComponent(branchId)}; path=/; max-age=${maxAge}; samesite=lax`
  } else {
    localStorage.removeItem("active-branch-id")
    document.cookie = "active-branch-id=; path=/; max-age=0; samesite=lax"
  }
}

function clearCachedAuth() {
  if (typeof window !== "undefined") localStorage.removeItem(AUTH_CACHE_KEY)
}

function cacheAuth(scope: ClientAuthScope) {
  if (typeof window === "undefined" || !scope.user) return
  const cached: CachedAuthScope = {
    user: { id: scope.user.id, email: scope.user.email, user_metadata: scope.user.user_metadata },
    profile: scope.profile,
    role: scope.role,
    isDeveloper: scope.isDeveloper,
    isOwner: scope.isOwner,
    activePharmacyId: scope.activePharmacyId,
    activeBranchId: scope.activeBranchId,
    activePharmacy: scope.activePharmacy,
    activeBranch: scope.activeBranch,
    memberships: scope.memberships,
    branches: scope.branches,
    savedAt: Date.now(),
  }
  localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cached))
}

function readCachedAuth(expectedUserId?: string | null): ClientAuthScope | null {
  if (typeof window === "undefined") return null
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) ?? "null") as CachedAuthScope | null
    if (!parsed?.user?.id || Date.now() - Number(parsed.savedAt ?? 0) > AUTH_CACHE_TTL) return null
    if (expectedUserId && parsed.user.id !== expectedUserId) return null
    return { ...parsed, user: parsed.user as User, session: null }
  } catch {
    return null
  }
}

function buildLocalFallback(user: User | null, session: Session | null): ClientAuthScope {
  // Never infer authority from mutable user metadata or email. Offline access is
  // allowed only through a previously server-verified, user-bound cached scope.
  return { ...emptyScope, user, session }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(createClient)
  const [scope, setScope] = useState<ClientAuthScope>(emptyScope)
  const scopeRef = useRef<ClientAuthScope>(emptyScope)
  const hydrateSequenceRef = useRef(0)
  const hydrateAbortRef = useRef<AbortController | null>(null)
  const explicitSignOutRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { scopeRef.current = scope }, [scope])

  const applyScope = useCallback((next: ClientAuthScope) => {
    scopeRef.current = next
    setScope(next)
    if (next.user) cacheAuth(next)
  }, [])

  const hydrate = useCallback(async (session: Session | null, requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    const sequence = ++hydrateSequenceRef.current
    hydrateAbortRef.current?.abort()
    const controller = new AbortController()
    hydrateAbortRef.current = controller
    const user = session?.user ?? null

    if (!user) {
      const cached = readCachedAuth()
      if (cached && !(await network.check())) {
        applyScope(cached)
        persistScope(cached.activePharmacyId, cached.activeBranchId)
        setLoading(false)
        setError(null)
        return
      }
      persistScope(null, null)
      clearCachedAuth()
      applyScope({ ...emptyScope, session: null, user: null })
      setLoading(false)
      setError(null)
      return
    }

    const existing = scopeRef.current
    const cached = readCachedAuth(user.id)
    const hasUsableScope = existing.user?.id === user.id && Boolean(existing.activePharmacyId)
    if (!hasUsableScope) setLoading(true)
    setError(null)
    const optimistic = hasUsableScope ? { ...existing, user, session } : cached ? { ...cached, user, session } : buildLocalFallback(user, session)
    applyScope(optimistic)

    try {
      const stored = readStoredScope()
      const pharmacyId = requested && "pharmacyId" in requested ? requested.pharmacyId ?? null : stored.pharmacyId
      const branchId = requested && "branchId" in requested ? requested.branchId ?? null : stored.branchId
      const search = new URLSearchParams()
      if (pharmacyId) search.set("pharmacy_id", pharmacyId)
      if (branchId) search.set("branch_id", branchId)
      const data = await apiRequest<ApiAuthResponse>(`/api/auth/me${search.size ? `?${search.toString()}` : ""}`, {
        cache: "no-store",
        timeoutMs: 15_000,
        retries: 2,
        signal: controller.signal,
      })
      if (sequence !== hydrateSequenceRef.current || controller.signal.aborted) return
      persistScope(data.activePharmacyId, data.activeBranchId)
      applyScope({
        user,
        session,
        profile: data.profile,
        role: normalizeRole(data.role),
        isDeveloper: data.isDeveloper,
        isOwner: data.isOwner,
        activePharmacyId: data.activePharmacyId,
        activeBranchId: data.activeBranchId,
        activePharmacy: data.activePharmacy,
        activeBranch: data.activeBranch,
        memberships: data.memberships ?? [],
        branches: data.branches ?? [],
      })
    } catch (err) {
      if (controller.signal.aborted || sequence !== hydrateSequenceRef.current) return
      const fallback = readCachedAuth(user.id)
      if (fallback) {
        applyScope({ ...fallback, user, session })
        setError((await network.check()) ? (err instanceof Error ? err.message : "فشل تحديث بيانات الصلاحيات") : null)
      } else if (scopeRef.current.user?.id !== user.id || !scopeRef.current.activePharmacyId) {
        applyScope(buildLocalFallback(user, session))
        setError(err instanceof Error ? err.message : "فشل تحميل بيانات الصلاحيات")
      }
    } finally {
      if (sequence === hydrateSequenceRef.current) setLoading(false)
    }
  }, [applyScope])

  const refreshAuth = useCallback(async (requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await hydrate(session, requested)
    } catch {
      const cached = readCachedAuth()
      if (cached && !(await network.check())) {
        applyScope(cached)
        setLoading(false)
      }
    }
  }, [applyScope, hydrate, supabase])

  const setActiveScope = useCallback(async (requested: { pharmacyId?: string | null; branchId?: string | null }) => {
    const pharmacyId = "pharmacyId" in requested ? requested.pharmacyId ?? null : scopeRef.current.activePharmacyId
    const branchId = "branchId" in requested ? requested.branchId ?? null : scopeRef.current.activeBranchId
    persistScope(pharmacyId, branchId)
    const current = scopeRef.current
    if (current.user) {
      const next = {
        ...current,
        activePharmacyId: pharmacyId,
        activeBranchId: branchId,
        activeBranch: current.branches.find((branch) => branch.id === branchId) ?? null,
      }
      applyScope(next)
    }
    await refreshAuth({ pharmacyId, branchId })
  }, [applyScope, refreshAuth])

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) void hydrate(data.session)
    }).catch(() => { if (mounted) void hydrate(null) })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: Session | null) => {
      if (!mounted) return
      if (event === "SIGNED_OUT") {
        if (explicitSignOutRef.current) return
        void (async () => {
          const cached = readCachedAuth()
          if (cached && !(await network.check())) {
            applyScope(cached)
            setLoading(false)
            setError(null)
            return
          }
          persistScope(null, null)
          clearCachedAuth()
          applyScope(emptyScope)
          setLoading(false)
          setError(null)
        })()
        return
      }
      if (event === "TOKEN_REFRESHED" && session?.user) {
        applyScope({ ...scopeRef.current, user: session.user, session })
        return
      }
      if (["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED"].includes(event)) void hydrate(session)
    })

    return () => {
      mounted = false
      hydrateAbortRef.current?.abort()
      subscription.unsubscribe()
    }
  }, [applyScope, hydrate, supabase])

  const signOut = useCallback(() => {
    explicitSignOutRef.current = true
    persistScope(null, null)
    clearCachedAuth()
    applyScope(emptyScope)
    setLoading(false)
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHES" })
    void localDB.clearPrivateData().finally(() => {
      window.location.href = "/api/auth/logout"
    })
  }, [applyScope])

  const value = useMemo<AuthState>(() => {
    const memberships = scope.memberships.filter((membership) => membership.pharmacy_id === scope.activePharmacyId)
    const activeMembership = memberships.find((membership) => membership.branch_id === scope.activeBranchId)
      ?? memberships.find((membership) => membership.branch_id === null)
      ?? memberships[0]
    const extraPermissions = activeMembership?.permissions ?? []
    const deniedPermissions = activeMembership?.denied_permissions ?? []
    return {
      ...scope,
      loading,
      error,
      can: (permission: Permission) => hasPermission(scope.role, permission, extraPermissions, deniedPermissions),
      refreshAuth,
      setActiveScope,
      signOut,
    }
  }, [error, loading, refreshAuth, scope, setActiveScope, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
