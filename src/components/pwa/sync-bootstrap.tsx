"use client"

import { useEffect } from "react"
import { syncManager } from "@/lib/sync/sync-manager"

export function SyncBootstrap() {
  useEffect(() => {
    syncManager.startAutoSync(30_000)
    void syncManager.refreshPending()
    if (syncManager.status.online) void syncManager.sync()
    return () => syncManager.stopAutoSync()
  }, [])

  return null
}
