"use client"

type Listener = (online: boolean) => void

let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true
let checkPromise: Promise<boolean> | null = null
let monitorStarted = false
const listeners = new Set<Listener>()

function emit(next: boolean) {
  if (isOnline === next) return
  isOnline = next
  listeners.forEach((listener) => listener(next))
}

async function probe(timeoutMs = 3500): Promise<boolean> {
  if (typeof window === "undefined") return true
  if (checkPromise) return checkPromise
  checkPromise = (async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = `/api/health?connectivity=${Date.now()}`
      const response = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
      const next = response.ok
      emit(next)
      return next
    } catch {
      emit(false)
      return false
    } finally {
      window.clearTimeout(timer)
      checkPromise = null
    }
  })()
  return checkPromise
}

function startMonitor() {
  if (monitorStarted || typeof window === "undefined") return
  monitorStarted = true
  window.addEventListener("online", () => { void probe() })
  window.addEventListener("offline", () => emit(false))
  window.setInterval(() => { if (!document.hidden) void probe() }, 15_000)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void probe() })
}

if (typeof window !== "undefined") startMonitor()

export const network = {
  get isOnline(): boolean {
    return isOnline
  },

  subscribe(listener: Listener): () => void {
    startMonitor()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },

  async waitForOnline(timeoutMs = 30_000): Promise<boolean> {
    if (await probe()) return true
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeoutMs)
      function onChange(online: boolean) {
        if (!online) return
        cleanup()
        resolve(true)
      }
      function cleanup() {
        window.clearTimeout(timer)
        listeners.delete(onChange)
      }
      listeners.add(onChange)
    })
  },

  check: probe,
}
