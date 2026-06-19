"use client"

import { useEffect, useRef, useState } from "react"
import { WifiOff } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { network } from "@/lib/network"
import { CORE_OFFLINE_ROUTES, OFFLINE_APP_VERSION } from "@/lib/pwa/core-routes"

const READY_KEY = "pharmacy-offline-ready"
const LAST_ROUTE_KEY = "pharmacy-last-dashboard-route"

type WarmRoutesReply = {
  type?: string
  requestId?: string
  cached?: number
  version?: string
}

function postWarmRequest(registration: ServiceWorkerRegistration, routes: readonly string[]) {
  const worker = registration.active ?? registration.waiting ?? registration.installing
  if (!worker) return Promise.resolve(0)
  const requestId = crypto.randomUUID()
  return new Promise<number>((resolve) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage)
      resolve(0)
    }, 45_000)
    function onMessage(event: MessageEvent<WarmRoutesReply>) {
      const data = event.data
      if (data?.type !== "WARM_ROUTES_RESULT" || data.requestId !== requestId) return
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener("message", onMessage)
      resolve(Number(data.cached ?? 0))
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    worker.postMessage({ type: "WARM_ROUTES", requestId, routes: Array.from(routes) })
  })
}

function shouldForceDocumentNavigation(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (anchor.target && anchor.target !== "_self") return false
  if (anchor.hasAttribute("download")) return false
  const href = anchor.getAttribute("href")
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/dashboard")) return false
  return true
}

export function PwaBootstrap() {
  const auth = useAuth()
  const [online, setOnline] = useState(network.isOnline)
  const warmedScopeRef = useRef("")

  useEffect(() => {
    const unsubscribe = network.subscribe(setOnline)
    void network.check()
    return unsubscribe
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.location.pathname.startsWith("/dashboard")) localStorage.setItem(LAST_ROUTE_KEY, window.location.pathname + window.location.search)
  })

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return
    let cancelled = false
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (registration) => {
        if (cancelled) return
        await registration.update().catch(() => undefined)
        if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!auth.user || !auth.activePharmacyId || !online || !("serviceWorker" in navigator)) return
    const scopeKey = `${auth.user.id}:${auth.activePharmacyId}:${auth.activeBranchId ?? "all"}:${OFFLINE_APP_VERSION}`
    if (warmedScopeRef.current === scopeKey) return
    warmedScopeRef.current = scopeKey
    let cancelled = false
    void navigator.serviceWorker.ready.then(async (registration) => {
      const cached = await postWarmRequest(registration, CORE_OFFLINE_ROUTES)
      if (cancelled || cached <= 0) return
      localStorage.setItem(READY_KEY, JSON.stringify({
        version: OFFLINE_APP_VERSION,
        pharmacyId: auth.activePharmacyId,
        branchId: auth.activeBranchId,
        cached,
        preparedAt: new Date().toISOString(),
      }))
      window.dispatchEvent(new CustomEvent("pharmacy-offline-ready-updated"))
    })
    return () => { cancelled = true }
  }, [auth.activeBranchId, auth.activePharmacyId, auth.user, online])

  useEffect(() => {
    function handleOfflineLink(event: MouseEvent) {
      if (network.isOnline) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a")
      if (!(anchor instanceof HTMLAnchorElement) || !shouldForceDocumentNavigation(event, anchor)) return
      event.preventDefault()
      window.location.assign(anchor.href)
    }
    document.addEventListener("click", handleOfflineLink, true)
    return () => document.removeEventListener("click", handleOfflineLink, true)
  }, [])

  if (online) return null
  return (
    <div dir="rtl" className="fixed inset-x-0 bottom-3 z-[9999] mx-auto flex w-[min(94vw,620px)] items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-2.5 text-sm font-black text-amber-900 shadow-xl backdrop-blur">
      <WifiOff className="size-4" />
      وضع عدم الاتصال: العمليات المدعومة محفوظة على الجهاز وستُزامن تلقائيًا.
    </div>
  )
}

export { postWarmRequest }
