"use client"

type Listener = (online: boolean) => void

let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true
const listeners = new Set<Listener>()

function handleOnline() {
  isOnline = true
  listeners.forEach((l) => l(true))
}

function handleOffline() {
  isOnline = false
  listeners.forEach((l) => l(false))
}

if (typeof window !== "undefined") {
  window.addEventListener("online", handleOnline)
  window.addEventListener("offline", handleOffline)
}

export const network = {
  get isOnline(): boolean {
    return isOnline
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },

  async waitForOnline(timeoutMs = 30000): Promise<boolean> {
    if (isOnline) return true
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeoutMs)

      function onOnline() {
        cleanup()
        resolve(true)
      }

      function cleanup() {
        clearTimeout(timeout)
        listeners.delete(onOnline)
      }

      listeners.add(onOnline)
    })
  },

  async check(): Promise<boolean> {
    try {
      const res = await fetch("/api/health", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  },
}
