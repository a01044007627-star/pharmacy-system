"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { isSuperAdmin, SUPER_ADMIN_ROLE, resolveRole } from "@/config/super-admin"
import { hasPermission, normalizeRole, type Permission } from "@/lib/auth/permissions"
import type { AuthScope, BranchSummary, MedicalRole, PharmacyMembership, PharmacySummary, UserProfile } from "@/types"
import { apiRequest } from "@/lib/api-client"

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
  return {
    pharmacyId: window.localStorage.getItem("active-pharmacy-id"),
    branchId: window.localStorage.getItem("active-branch-id"),
  }
}

function persistScope(pharmacyId: string | null, branchId: string | null) {
  if (typeof window === "undefined") return
  const maxAge = 60 * 60 * 24 * 30
  if (pharmacyId) {
    window.localStorage.setItem("active-pharmacy-id", pharmacyId)
    document.cookie = `active-pharmacy-id=${encodeURIComponent(pharmacyId)}; path=/; max-age=${maxAge}; samesite=lax`
  } else {
    window.localStorage.removeItem("active-pharmacy-id")
    document.cookie = "active-pharmacy-id=; path=/; max-age=0; samesite=lax"
  }
  if (branchId) {
    window.localStorage.setItem("active-branch-id", branchId)
    document.cookie = `active-branch-id=${encodeURIComponent(branchId)}; path=/; max-age=${maxAge}; samesite=lax`
  } else {
    window.localStorage.removeItem("active-branch-id")
    document.cookie = "active-branch-id=; path=/; max-age=0; samesite=lax"
  }
}

function buildLocalFallback(user: User | null, session: Session | null): ClientAuthScope {
  const rawRole = (user?.user_metadata?.role as string) ?? null
  const email = user?.email ?? null
  const role = normalizeRole(resolveRole(email, rawRole))
  const isDeveloper = role === SUPER_ADMIN_ROLE || isSuperAdmin(email)
  return {
    ...emptyScope,
    user,
    session,
    role: isDeveloper ? "developer" : role,
    isDeveloper,
    isOwner: role === "owner",
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(createClient)
  const [scope, setScope] = useState<ClientAuthScope>(emptyScope)
  const scopeRef = useRef<ClientAuthScope>(emptyScope)
  const hydrateSequenceRef = useRef(0)
  const hydrateAbortRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { scopeRef.current = scope }, [scope])

  const hydrate = useCallback(async (session: Session | null, requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    const sequence = ++hydrateSequenceRef.current
    hydrateAbortRef.current?.abort()
    const controller = new AbortController()
    hydrateAbortRef.current = controller

    const user = session?.user ?? null
    if (!user) {
      persistScope(null, null)
      setScope({ ...emptyScope, session: null, user: null })
      setLoading(false)
      setError(null)
      return
    }

    const existing = scopeRef.current
    const hasUsableScope = existing.user?.id === user.id && Boolean(existing.activePharmacyId)
    if (!hasUsableScope) setLoading(true)
    setError(null)
    setScope((prev) => hasUsableScope ? { ...prev, user, session } : { ...prev, ...buildLocalFallback(user, session) })

    try {
      const stored = readStoredScope()
      const pharmacyId = requested && "pharmacyId" in requested ? requested.pharmacyId ?? null : stored.pharmacyId
      const branchId = requested && "branchId" in requested ? requested.branchId ?? null : stored.branchId
      const search = new URLSearchParams()
      if (pharmacyId) search.set("pharmacy_id", pharmacyId)
      if (branchId) search.set("branch_id", branchId)

      const data = await apiRequest<ApiAuthResponse>(
        `/api/auth/me${search.size ? `?${search.toString()}` : ""}`,
        { cache: "no-store", timeoutMs: 15_000, retries: 2, signal: controller.signal },
      )
      if (sequence !== hydrateSequenceRef.current || controller.signal.aborted) return

      persistScope(data.activePharmacyId, data.activeBranchId)
      const nextScope: ClientAuthScope = {
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
      }
      scopeRef.current = nextScope
      setScope(nextScope)
    } catch (err) {
      if (controller.signal.aborted || sequence !== hydrateSequenceRef.current) return
      const message = err instanceof Error ? err.message : "فشل تحميل بيانات الصلاحيات"
      setError(message)
      setScope((prev) => prev.user?.id === user.id && prev.activePharmacyId
        ? { ...prev, user, session }
        : buildLocalFallback(user, session))
    } finally {
      if (sequence === hydrateSequenceRef.current) setLoading(false)
    }
  }, [])

  const refreshAuth = useCallback(async (requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    const { data: { session } } = await supabase.auth.getSession()
    await hydrate(session, requested)
  }, [hydrate, supabase])

  const setActiveScope = useCallback(async (requested: { pharmacyId?: string | null; branchId?: string | null }) => {
    const pharmacyId = "pharmacyId" in requested ? requested.pharmacyId ?? null : scope.activePharmacyId
    const branchId = "branchId" in requested ? requested.branchId ?? null : scope.activeBranchId
    persistScope(pharmacyId, branchId)
    await refreshAuth({ pharmacyId, branchId })
  }, [refreshAuth, scope.activeBranchId, scope.activePharmacyId])

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) void hydrate(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: Session | null) => {
      if (!mounted) return
      if (event === "SIGNED_OUT") {
        hydrateAbortRef.current?.abort()
        persistScope(null, null)
        scopeRef.current = emptyScope
        setScope(emptyScope)
        setLoading(false)
        setError(null)
        return
      }
      if (event === "TOKEN_REFRESHED" && session?.user) {
        setScope((prev) => ({ ...prev, user: session.user, session }))
        return
      }
      if (["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED"].includes(event)) void hydrate(session)
    })

    return () => {
      mounted = false
      hydrateAbortRef.current?.abort()
      subscription.unsubscribe()
    }
  }, [hydrate, supabase])

  const signOut = useCallback(() => {
    persistScope(null, null)
    setScope(emptyScope)
    setLoading(false)
    window.location.href = "/api/auth/logout"
  }, [])

  const value = useMemo<AuthState>(() => {
    const activeMembership = scope.memberships.find((membership) => membership.pharmacy_id === scope.activePharmacyId)
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
