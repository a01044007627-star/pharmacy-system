import { spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"

const baseEnv = {
  ...process.env,
  npm_config_legacy_peer_deps: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_progress: "false",
  npm_config_engine_strict: "false",
  npm_config_prefer_offline: "false",
  npm_config_fetch_retries: process.env.npm_config_fetch_retries ?? "5",
  npm_config_fetch_retry_mintimeout: process.env.npm_config_fetch_retry_mintimeout ?? "20000",
  npm_config_fetch_retry_maxtimeout: process.env.npm_config_fetch_retry_maxtimeout ?? "120000",
}

function runInstall(label, args) {
  console.log(`\n[vercel-install] ${label}: npm ${args.join(" ")}`)
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: false,
    env: baseEnv,
  })

  if (result.error) {
    console.error(`[vercel-install] ${label} failed to start:`, result.error.message)
    return 1
  }

  return typeof result.status === "number" ? result.status : 1
}

let code = runInstall("primary", [
  "ci",
  "--legacy-peer-deps",
  "--no-audit",
  "--no-fund",
  "--prefer-online",
])

if (code !== 0) {
  console.warn("[vercel-install] npm ci failed. Falling back to npm install...")
  rmSync("node_modules", { recursive: true, force: true })
  code = runInstall("fallback", [
    "install",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
    "--prefer-online",
  ])
}

process.exit(code)
