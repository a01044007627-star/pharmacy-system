import "server-only"

function configuredEmails(): Set<string> {
  const raw = process.env.DEVELOPER_BOOTSTRAP_EMAILS
    ?? process.env.DEVELOPER_BOOTSTRAP_EMAIL
    ?? ""
  return new Set(raw.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))
}

/**
 * Environment-only bootstrap used to create the first developer_users row.
 * Runtime authorization never depends on an email address.
 */
export function isDeveloperBootstrapEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return configuredEmails().has(email.trim().toLowerCase())
}
