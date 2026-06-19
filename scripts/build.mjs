import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

const isWindows = process.platform === "win32"
const nextBin = join(process.cwd(), "node_modules", ".bin", isWindows ? "next.cmd" : "next")

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: isWindows,
    env,
  })

  if (result.error) {
    console.error(result.error.message)
    return 1
  }

  return typeof result.status === "number" ? result.status : 1
}

if (!existsSync(nextBin)) {
  console.warn("[build] next is missing from node_modules. Running project install before build...")
  const installCode = run(process.execPath, ["scripts/vercel-install.mjs"], {
    ...process.env,
    npm_config_engine_strict: "false",
    npm_config_legacy_peer_deps: "true",
  })

  if (installCode !== 0) {
    process.exit(installCode)
  }
}

process.exit(run(nextBin, ["build"], {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
}))
