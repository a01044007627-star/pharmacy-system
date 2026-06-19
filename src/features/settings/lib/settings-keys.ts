export type SettingsNamespace =
  | "project"
  | "tax"
  | "system"
  | "items"
  | "cashier"
  | "sales"
  | "purchases"
  | "payments"
  | "contacts"
  | "stockAlerts"
  | "email"
  | "sms"
  | "rewards"
  | "extraUnits"
  | "customLabels"
  | "shortcuts"

export const SETTINGS_UPDATED_EVENT = "pharmacy-settings-updated"

export const SETTINGS_DEFAULTS: Record<SettingsNamespace, Record<string, string>> = {
  project: {
    name: "",
    legalName: "",
    ownerName: "",
    ownerTitle: "صيدلي",
    address: "",
    phone: "",
    mobile: "",
    email: "",
    website: "",
    taxId: "",
    commercialRegister: "",
    healthLicense: "",
    country: "مصر",
    city: "",
    district: "",
    building: "",
    floor: "",
    landmark: "",
    currency: "EGP",
    currencySymbol: "ج.م",
    currencySymbolPlacement: "before",
    timezone: "Africa/Cairo",
    language: "ar",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "24",
    facebook: "",
    twitter: "",
    instagram: "",
    whatsapp: "",
    notes: "",
    decimalPlaces: "2",
    roundingMode: "half-up",
    notifSound: "true",
    notifAutoread: "true",
  },
  tax: {
    defaultTaxRate: "0",
    taxCalculationMethod: "exclusive",
    taxNumber: "",
    taxAuthority: "",
    vatRate: "0",
    includeTaxInPrice: "false",
    applyTaxToShipping: "false",
    taxRounding: "nearest",
    taxOnDiscount: "false",
    enableMultipleTaxes: "false",
    taxDisplayLabel: "ضريبة القيمة المضافة",
  },
  system: {
    appName: "Logixa Pharmacy",
    appVersion: "1.0.0",
    companyName: "",
    supportPhone: "",
    supportEmail: "",
    enableAutoBackup: "true",
    backupFrequency: "daily",
    backupRetentionDays: "30",
    backupLocation: "",
    enableAuditLog: "true",
    auditLogRetentionDays: "90",
    enableMultiBranch: "false",
    enableMultiCurrency: "false",
    defaultBranchId: "",
    enableDarkMode: "false",
    enableNotifications: "true",
    sessionTimeout: "60",
    maxLoginAttempts: "5",
    enableTwoFactor: "false",
    maintenanceMode: "false",
  },
  items: {
    defaultUnit: "قطعة",
    enableExpiryTracking: "true",
    enableBatchTracking: "false",
    enableSerialTracking: "false",
    enableBarcodeScanning: "true",
    defaultPurchasePrice: "0",
    defaultSellingPrice: "0",
    defaultMinStock: "0",
    defaultMaxStock: "0",
    defaultReorderPoint: "0",
    autoGenerateBarcode: "false",
    barcodePrefix: "",
    barcodeSymbology: "Code-128",
    costingMethod: "average",
    allowNegativeStock: "false",
    enablePriceGroups: "false",
    enableWholesalePrice: "true",
    enableMultiUnit: "false",
    itemNameFormat: "arabic",
    showExpiryInSales: "true",
    showBatchInSales: "false",
    daysToExpiryWarning: "30",
  },
  cashier: {
    posLayout: "grid",
    posColumns: "4",
    enableQuickKeys: "true",
    quickKeys: "",
    enableCashDrawer: "false",
    cashDrawerPort: "",
    autoOpenDrawer: "true",
    enableCustomerSelection: "true",
    enableSearch: "true",
    searchMinChars: "2",
    showItemImage: "true",
    showItemStock: "true",
    showItemPrice: "true",
    enableCategoryFilter: "true",
    enableBarcodeSearch: "true",
    enableCalculator: "true",
    holdSaleEnabled: "true",
    quickSaleEnabled: "true",
    cashCategoryScope: "pos",
    defaultCashCategory: "",
    audioOnScan: "true",
  },
  sales: {
    invoicePrefix: "INV-",
    invoiceSuffix: "",
    nextInvoiceNumber: "1",
    receiptFooter: "شكراً لتعاملكم معنا",
    receiptHeader: "",
    saleItemBehavior: "increase",
    defaultDiscountPercent: "0",
    maxDiscountPercent: "100",
    enableDiscount: "true",
    enableReturn: "true",
    returnWindowDays: "30",
    requireReturnReason: "true",
    enableSalesRep: "false",
    salesRepCommissionBase: "invoice",
    salesRepCommissionRate: "0",
    enablePriceOverride: "true",
    requirePriceOverrideReason: "false",
    defaultSaleStatus: "invoice",
    enableDraftInvoices: "true",
    enablePriceOffers: "true",
    priceOfferValidDays: "7",
    enableShipping: "false",
    defaultShippingCost: "0",
    enableFreeReturns: "false",
  },
  purchases: {
    orderPrefix: "PO-",
    nextOrderNumber: "1",
    enablePurchaseApproval: "false",
    requireApprovalAbove: "10000",
    defaultOrderStatus: "pending",
    enablePartialReceiving: "true",
    enablePurchaseReturn: "true",
    returnWindowDays: "14",
    enableShippingCost: "true",
    defaultShippingCost: "0",
    enablePurchaseDiscount: "true",
    defaultDiscountPercent: "0",
    autoCreateStockOnReceive: "true",
    enableBatchTracking: "false",
    enableExpiryTracking: "true",
  },
  payments: {
    defaultPaymentMethod: "cash",
    acceptedPaymentMethods: "cash,card",
    enableCardPayment: "true",
    cardFeePercent: "0",
    enableWalletPayment: "true",
    enableBankTransfer: "true",
    enablePartialPayment: "true",
    enableChangeCalculation: "true",
    paymentRounding: "0.05",
    defaultPaymentTerm: "cash",
    enableDeposit: "false",
    depositPercent: "0",
  },
  contacts: {
    defaultCustomerGroup: "",
    defaultSupplierGroup: "",
    defaultPaymentTerm: "cash",
    enableCustomerCreditLimit: "false",
    defaultCreditLimit: "0",
    enableCustomerLoyalty: "true",
    customerDisplayName: "name",
    requirePhoneForCustomers: "false",
    requirePhoneForSuppliers: "false",
    enableCustomerPriceGroup: "false",
    autoCreateCustomer: "false",
    defaultCustomerId: "",
    enableCustomerDiscount: "false",
    defaultCustomerDiscount: "0",
  },
  stockAlerts: {
    enableLowStockAlerts: "true",
    lowStockThreshold: "10",
    enableExpiryAlerts: "true",
    expiryWarningDays: "30",
    enableOutOfStockAlerts: "true",
    alertConditions: "below_min,expiring_soon",
    defaultSeverity: "medium",
    alertFrequency: "daily",
    enableEmailAlerts: "false",
    enableInAppAlerts: "true",
    enableSmsAlerts: "false",
    maxAlertItems: "50",
  },
  email: {
    smtpHost: "",
    smtpPort: "587",
    smtpUsername: "",
    smtpPassword: "",
    smtpEncryption: "tls",
    fromAddress: "",
    fromName: "",
    enableEmailNotifications: "false",
    emailSignature: "",
  },
  sms: {
    provider: "",
    apiKey: "",
    apiSecret: "",
    senderId: "",
    enableSmsNotifications: "false",
    smsSignature: "",
    defaultCountryCode: "+20",
  },
  rewards: {
    enableRewards: "false",
    pointsPerAmount: "100",
    pointsCurrency: "EGP",
    pointsPerPurchase: "1",
    redeemRate: "1",
    minRedeemPoints: "100",
    maxRedeemPercent: "50",
    expiryDays: "365",
    enableBirthdayReward: "true",
    birthdayRewardPoints: "100",
    enableSignupReward: "true",
    signupRewardPoints: "50",
  },
  extraUnits: {
    enableExtraUnits: "false",
    units: "علبة,شريط,قرص,كابسولة,أمبول,زجاجة,بخاخ,أنبوب,قطارة,عبوة",
  },
  customLabels: {
    enableCustomLabels: "false",
  },
  shortcuts: {
    enableShortcuts: "true",
  },
}

export function settingKey(namespace: SettingsNamespace, key: string) {
  return `${namespace}.${key}`
}

export function splitSettingKey(key: string): { namespace?: SettingsNamespace; key: string } {
  const [maybeNamespace, ...rest] = key.split(".")
  if (rest.length === 0) return { key }
  if (maybeNamespace in SETTINGS_DEFAULTS) {
    return { namespace: maybeNamespace as SettingsNamespace, key: rest.join(".") }
  }
  return { key }
}

export function flattenDefaultSettings() {
  const output: Record<string, string> = {}
  for (const [namespace, values] of Object.entries(SETTINGS_DEFAULTS) as Array<[SettingsNamespace, Record<string, string>]>) {
    for (const [key, value] of Object.entries(values)) {
      output[settingKey(namespace, key)] = value
    }
  }
  return output
}

export function defaultsForNamespace(namespace: SettingsNamespace, overrides: Record<string, string> = {}) {
  return { ...SETTINGS_DEFAULTS[namespace], ...overrides }
}
