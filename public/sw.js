/* Logixa Pharmacy offline worker. Keep this file plain ES2017 for older clients. */
const SW_VERSION = "2026.06.20.1"
const STATIC_CACHE = `logixa-pharmacy-static-${SW_VERSION}`
const PAGE_CACHE = `logixa-pharmacy-pages-${SW_VERSION}`
const API_CACHE = `logixa-pharmacy-api-${SW_VERSION}`
const CACHE_PREFIX = "logixa-pharmacy-"
const INSTALL_ASSETS = [
  "/offline",
  "/dashboard/items",
  "/dashboard/stocktaking",
  "/manifest.json",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/icon-192.png",
  "/icon-512.png"
]
const AUTH_PATHS = ["/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password", "/api/auth"]
const API_EXCLUDES = ["/api/auth", "/api/health", "/api/developer", "/api/platform", "/api/settings/backup-export", "/api/upload", "/api/download"]

function cacheKeyWithoutSearch(request) {
  const url = new URL(request.url)
  url.search = ""
  url.hash = ""
  return new Request(url.toString(), { method: "GET", credentials: "same-origin" })
}

function isAuthPath(pathname) {
  return AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isCacheableHtmlResponse(response, requestedUrl) {
  if (!response || !response.ok || response.type === "opaque" || response.redirected) return false
  const type = response.headers.get("content-type") || ""
  if (!type.includes("text/html")) return false
  try {
    const finalUrl = new URL(response.url)
    return finalUrl.origin === requestedUrl.origin && finalUrl.pathname === requestedUrl.pathname && !isAuthPath(finalUrl.pathname)
  } catch {
    return false
  }
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function networkFirstNavigation(request) {
  const requestedUrl = new URL(request.url)
  const key = cacheKeyWithoutSearch(request)
  try {
    const response = await fetchWithTimeout(request, 2800)
    if (isCacheableHtmlResponse(response, requestedUrl)) {
      const cache = await caches.open(PAGE_CACHE)
      await cache.put(key, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(key)
    if (cached) return cached
    return (await caches.match("/offline")) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetchWithTimeout(request, 3500)
    if (response.ok && !response.redirected && response.type !== "opaque") await cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: "offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type !== "opaque") {
    const cache = await caches.open(STATIC_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function cacheAssetsFromHtml(html, pageUrl) {
  const matches = html.matchAll(/(?:src|href)=["']([^"']+)["']/g)
  const assetUrls = []
  for (const match of matches) {
    try {
      const url = new URL(match[1], pageUrl)
      if (url.origin !== self.location.origin) continue
      if (!url.pathname.startsWith("/_next/static/") && !/\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) continue
      assetUrls.push(url.toString())
    } catch {}
  }
  const unique = Array.from(new Set(assetUrls)).slice(0, 400)
  const cache = await caches.open(STATIC_CACHE)
  await Promise.all(unique.map(async (url) => {
    try {
      const request = new Request(url, { credentials: "same-origin" })
      if (await cache.match(request)) return
      const response = await fetch(request)
      if (response.ok && response.type !== "opaque") await cache.put(request, response)
    } catch {}
  }))
}

async function warmRoutes(routes) {
  const cache = await caches.open(PAGE_CACHE)
  let cached = 0
  for (const route of routes) {
    try {
      const url = new URL(route, self.location.origin)
      const request = new Request(url.toString(), {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      })
      const response = await fetch(request)
      if (!isCacheableHtmlResponse(response, url)) continue
      const html = await response.clone().text()
      await cache.put(cacheKeyWithoutSearch(request), response.clone())
      await cacheAssetsFromHtml(html, url.toString())
      cached += 1
    } catch {}
  }
  return cached
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE)
    await Promise.all(INSTALL_ASSETS.map(async (asset) => {
      try { await cache.add(new Request(asset, { cache: "reload", credentials: "same-origin" })) } catch {}
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, PAGE_CACHE, API_CACHE].includes(key)).map((key) => caches.delete(key)))
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable() } catch {}
    }
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (url.pathname.startsWith("/api/") && !API_EXCLUDES.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(networkFirstApi(request))
    return
  }

  if (url.pathname.startsWith("/_next/static/") || ["style", "script", "worker", "font", "image"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request))
  }
})

self.addEventListener("message", (event) => {
  const data = event.data || {}
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting()
    return
  }
  if (data.type === "PING") {
    if (event.source && event.source.postMessage) event.source.postMessage({ type: "PONG", version: SW_VERSION })
    return
  }
  if (data.type === "CLEAR_PRIVATE_CACHES") {
    event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), caches.delete(API_CACHE)]))
    return
  }
  if (data.type === "WARM_ROUTES") {
    const routes = Array.isArray(data.routes) ? data.routes.filter((route) => typeof route === "string" && route.startsWith("/")) : []
    event.waitUntil((async () => {
      const cached = await warmRoutes(routes)
      if (event.source && event.source.postMessage) event.source.postMessage({ type: "WARM_ROUTES_RESULT", requestId: data.requestId, cached, version: SW_VERSION })
    })())
  }
})
