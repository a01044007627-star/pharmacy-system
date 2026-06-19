import type { NextConfig } from "next"
import withSerwistInit from "@serwist/next"

const enableGeneratedServiceWorker = process.env.NEXT_PUBLIC_ENABLE_PWA_SW === "true"

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: !enableGeneratedServiceWorker,
})

const nextConfig: NextConfig = {
  devIndicators: { position: "bottom-right" },
  outputFileTracingExcludes: {
    "/*": ["**/*.wasm", "**/*.map", "**/node_modules/sharp/**"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]
  },
  experimental: {
    cpus: 2,
    optimizePackageImports: ["lucide-react", "date-fns", "@tanstack/react-query", "recharts"],
  },
}

export default enableGeneratedServiceWorker ? withSerwist(nextConfig) : nextConfig
