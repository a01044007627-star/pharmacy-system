export const developerReviewConfig = {
  enabled: process.env.DEVELOPER_REVIEW_LOGIN_ENABLED === "true",
  email: process.env.DEVELOPER_REVIEW_EMAIL ?? "",
  password: process.env.DEVELOPER_REVIEW_PASSWORD ?? "",
  name: process.env.DEVELOPER_REVIEW_NAME ?? "Developer",
}

export function isDeveloperReviewButtonVisible(): boolean {
  if (process.env.NODE_ENV === "development") return true
  return process.env.NEXT_PUBLIC_SHOW_DEVELOPER_LOGIN === "true"
}
