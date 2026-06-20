import { installSerwist } from "@serwist/sw"
import type { PrecacheEntry } from "serwist"

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[]
  }
}

const scope = self as unknown as WorkerGlobalScope
const manifest = scope.__SW_MANIFEST

if (manifest) {
  installSerwist({
    precacheEntries: manifest,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    runtimeCaching: [],
  })
}

export {}
