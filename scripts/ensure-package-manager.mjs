const userAgent = process.env.npm_config_user_agent ?? ""

if (!userAgent.startsWith("npm/")) {
  console.error([
    "",
    "[package-manager] هذا المشروع يستخدم npm فقط.",
    "[package-manager] استخدم: npm ci",
    "[package-manager] في Vercel اترك Install Command فارغًا أو استخدم npm ci.",
    "",
  ].join("\n"))
  process.exit(1)
}
