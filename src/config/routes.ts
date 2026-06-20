export const ROUTES = {
  // Auth
  login: "/auth/login",
  signup: "/auth/signup",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",

  // Dashboard
  dashboard: "/dashboard",
  dashboardHome: "/dashboard",
  dashboardPatients: "/dashboard/patients",
  dashboardCashier: "/dashboard/sales/cashier",
  dashboardProfile: "/dashboard/profile",
  dashboardSettings: "/dashboard/settings",
  dashboardNotifications: "/dashboard/notifications",
  developer: "/developer",

  // Settings sub-routes
  settings: {
    general: "/dashboard/settings",
    items: "/dashboard/settings/items",
    contacts: "/dashboard/settings/contacts",
    sales: "/dashboard/settings/sales",
    cashier: "/dashboard/settings/cashier",
    purchases: "/dashboard/settings/purchases",
    payments: "/dashboard/settings/payments",
    stockAlerts: "/dashboard/settings/stock-alerts",
    system: "/dashboard/settings/system",
    shortcuts: "/dashboard/settings/shortcuts",
    email: "/dashboard/settings/email",
    sms: "/dashboard/settings/sms",
    rewards: "/dashboard/settings/rewards",
    extraUnits: "/dashboard/settings/extra-units",
    customLabels: "/dashboard/settings/custom-labels",
    taxRates: "/dashboard/settings/tax-rates",
    barcode: "/dashboard/settings/barcode",
    printers: "/dashboard/settings/printers",
    branches: "/dashboard/settings/branches",
    invoice: "/dashboard/settings/invoice",
    notificationTemplates: "/dashboard/settings/notification-templates",
    backup: "/dashboard/settings/backup",
  },

  // Public
  home: "/",
  offline: "/offline",

  // API
  api: {
    login: "/api/auth/login",
    signup: "/api/auth/signup",
    logout: "/api/auth/logout",
    forgotPassword: "/api/auth/forgot-password",
    updatePassword: "/api/auth/update-password",
    me: "/api/auth/me",
  },
} as const

export const AUTH_ROUTES = [
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.offline,
] as const

export const PROTECTED_ROUTES = [
  ROUTES.dashboard,
] as const
