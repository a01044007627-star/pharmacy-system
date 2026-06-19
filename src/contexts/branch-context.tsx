"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAuth } from "@/contexts/auth-context"
import type { BranchSummary, PharmacySummary, UUID } from "@/types"

interface BranchContextValue {
  pharmacyId: UUID | null
  pharmacyName: string | null
  branchId: UUID | null
  branchName: string | null
  branches: BranchSummary[]
  activePharmacy: PharmacySummary | null
  activeBranch: BranchSummary | null
  setActiveBranch: (branchId: UUID | null) => Promise<void>
}

const BranchContext = createContext<BranchContextValue>({
  pharmacyId: null,
  pharmacyName: null,
  branchId: null,
  branchName: null,
  branches: [],
  activePharmacy: null,
  activeBranch: null,
  setActiveBranch: async () => {},
})

export function BranchProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()

  const value = useMemo<BranchContextValue>(() => ({
    pharmacyId: auth.activePharmacyId,
    pharmacyName: auth.activePharmacy?.name ?? null,
    branchId: auth.activeBranchId,
    branchName: auth.activeBranch?.name ?? null,
    branches: auth.branches,
    activePharmacy: auth.activePharmacy,
    activeBranch: auth.activeBranch,
    setActiveBranch: (branchId) => auth.setActiveScope({ branchId }),
  }), [auth])

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export const useBranch = () => useContext(BranchContext)
