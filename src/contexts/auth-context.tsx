"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { isSuperAdmin, SUPER_ADMIN_ROLE, resolveRole } from "@/config/super-admin"
import { hasPermission, normalizeRole, type Permission } from "@/lib/auth/permissions"
import type { AuthScope, BranchSummary, MedicalRole, PharmacyMembership, PharmacySummary, UserProfile } from "@/types"

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
  if (pharmacyId) window.localStorage.setItem("active-pharmacy-id", pharmacyId)
  else window.localStorage.removeItem("active-pharmacy-id")
  if (branchId) window.localStorage.setItem("active-branch-id", branchId)
  else window.localStorage.removeItem("active-branch-id")
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const hydrate = useCallback(async (session: Session | null, requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    const user = session?.user ?? null
    if (!user) {
      persistScope(null, null)
      setScope({ ...emptyScope, session: null, user: null })
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setScope((prev) => ({ ...prev, ...buildLocalFallback(user, session) }))

    try {
      const stored = readStoredScope()
      const pharmacyId = requested?.pharmacyId ?? stored.pharmacyId
      const branchId = requested?.branchId ?? stored.branchId
      const search = new URLSearchParams()
      if (pharmacyId) search.set("pharmacy_id", pharmacyId)
      if (branchId) search.set("branch_id", branchId)

      const response = await fetch(`/api/auth/me${search.size ? `?${search.toString()}` : ""}`, { cache: "no-store" })
      if (!response.ok) throw new Error("فشل تحميل صلاحيات المستخدم")
      const data = (await response.json()) as ApiAuthResponse

      persistScope(data.activePharmacyId, data.activeBranchId)
      setScope({
        user: user,
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
      const message = err instanceof Error ? err.message : "فشل تحميل بيانات الصلاحيات"
      setError(message)
      setScope(buildLocalFallback(user, session))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAuth = useCallback(async (requested?: { pharmacyId?: string | null; branchId?: string | null }) => {
    const { data: { session } } = await supabase.auth.getSession()
    await hydrate(session, requested)
  }, [hydrate, supabase])

  const setActiveScope = useCallback(async (requested: { pharmacyId?: string | null; branchId?: string | null }) => {
    persistScope(requested.pharmacyId ?? scope.activePharmacyId, requested.branchId ?? scope.activeBranchId)
    await refreshAuth({
      pharmacyId: requested.pharmacyId ?? scope.activePharmacyId,
      branchId: requested.branchId ?? scope.activeBranchId,
    })
  }, [refreshAuth, scope.activeBranchId, scope.activePharmacyId])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => hydrate(data.session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        persistScope(null, null)
        setScope(emptyScope)
        setLoading(false)
        setError(null)
        return
      }
      hydrate(session)
    })

    return () => subscription.unsubscribe()
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
