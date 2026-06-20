import type { NextConfig } from "next"

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
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ]
  },
  // TypeScript is executed explicitly in the build script. Skipping Next's
  // duplicate checker prevents worker stalls on constrained/legacy build hosts.
  typescript: { ignoreBuildErrors: true },
  experimental: { cpus: 2 },
}

export default nextConfig
