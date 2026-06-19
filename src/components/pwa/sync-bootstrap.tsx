"use client"

import { useEffect } from "react"
import { syncManager } from "@/lib/sync/sync-manager"
import { network } from "@/lib/network"

export function SyncBootstrap() {
  useEffect(() => {
    let cancelled = false
    async function syncWhenReachable() {
      if (cancelled || !(await network.check())) return
      await syncManager.sync()
      if (!cancelled) await syncManager.syncCoreData()
    }
    syncManager.startAutoSync(30_000)
    void syncManager.refreshPending()
    void syncWhenReachable()
    const unsubscribe = network.subscribe((online) => { if (online) void syncWhenReachable() })
    const onVisibility = () => { if (!document.hidden) void syncWhenReachable() }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisibility)
      syncManager.stopAutoSync()
    }
  }, [])
  return null
}
