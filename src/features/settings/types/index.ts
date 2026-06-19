import type {
  SettingsTabId as _SettingsTabId,
  CurrencySymbolPlacement as _CurrencySymbolPlacement,
  InventoryCostingMethod as _InventoryCostingMethod,
  TimeFormat as _TimeFormat,
  PaymentTerm as _PaymentTerm,
  SaleItemBehavior as _SaleItemBehavior,
  SalesRepCommissionBase as _SalesRepCommissionBase,
  CashCategoryScope as _CashCategoryScope,
  SystemLanguage as _SystemLanguage,
  HttpMethod as _HttpMethod,
  FieldType as _FieldType,
  Option as _Option,
  CustomFieldGroup as _CustomFieldGroup,
  StringLabelGroup as _StringLabelGroup,
} from "@/types/settings"

export type SettingsTabId = _SettingsTabId
export type CurrencySymbolPlacement = _CurrencySymbolPlacement
export type InventoryCostingMethod = _InventoryCostingMethod
export type TimeFormat = _TimeFormat
export type PaymentTerm = _PaymentTerm
export type SaleItemBehavior = _SaleItemBehavior
export type SalesRepCommissionBase = _SalesRepCommissionBase
export type CashCategoryScope = _CashCategoryScope
export type SystemLanguage = _SystemLanguage
export type HttpMethod = _HttpMethod
export type FieldType = _FieldType
export type Option = _Option
export type CustomFieldGroup = _CustomFieldGroup
export type StringLabelGroup = _StringLabelGroup

export type TaxCalculationMethod = "inclusive" | "exclusive"
export type TaxRounding = "nearest" | "up" | "down"
export type TaxRateType = "percent" | "fixed"
export type TaxRateStatus = "active" | "inactive"
export type TaxGroupStatus = "active" | "inactive"

export type PaperSize = "A4" | "A5" | "A6" | "80mm" | "58mm" | "letter"
export type PrinterInterface = "usb" | "bluetooth" | "network" | "wifi" | "serial"
export type PrinterType = "thermal" | "inkjet" | "dot_matrix"
export type PrinterStatus = "active" | "inactive"

export type NotificationChannel = "sms" | "email" | "inapp"
export type TemplateStatus = "active" | "inactive"

export type BarcodeSymbology = "EAN-13" | "EAN-8" | "Code-128" | "Code-39" | "UPC-A" | "QR Code"

export type InvoiceDesignStatus = "active" | "inactive"
export type InvoiceTemplate = "standard" | "modern" | "compact" | "minimal"

export type StockAlertCondition = "below_min" | "below_reorder" | "expiring_soon" | "expired"
export type StockAlertSeverity = "low" | "medium" | "high"

export type DiscountApplication = "before_tax" | "after_tax"
export type PriceSource = "buy_price" | "sell_price" | "last_purchase" | "manual"

export interface PharmacySettings {
  project: ProjectSettings
  tax: TaxSettings
  items: ItemSettings
  contacts: ContactSettings
  sales: SalesSettings
  cashier: CashierSettings
  purchases: PurchaseSettings
  payments: PaymentSettings
  stockAlerts: StockAlertSettings
  system: SystemSettings
  shortcuts: ShortcutSettings
  email: EmailSettings
  sms: SmsSettings
  rewards: RewardSettings
  extraUnits: ExtraUnitSettings
  customLabels: CustomLabelSettings
}

export interface ProjectSettings {
  name: string
  legalName: string
  ownerName: string
  ownerTitle: string
  address: string
  phone: string
  mobile: string
  email: string
  website: string
  logo: string | null
  taxId: string
  commercialRegister: string
  healthLicense: string
  currency: string
  currencySymbol: string
  currencySymbolPlacement: CurrencySymbolPlacement
  timezone: string
  language: SystemLanguage
  dateFormat: string
  timeFormat: TimeFormat
  country: string
  city: string
  district: string
  building: string
  floor: string
  landmark: string
  facebook: string
  twitter: string
  instagram: string
  whatsapp: string
  notes: string
}

export interface TaxSettings {
  defaultTaxRate: number
  taxCalculationMethod: TaxCalculationMethod
  taxNumber: string
  taxAuthority: string
  vatRate: number
  includeTaxInPrice: boolean
  applyTaxToShipping: boolean
  taxRounding: TaxRounding
  taxOnDiscount: boolean
  enableMultipleTaxes: boolean
  taxDisplayLabel: string
}

export interface ItemSettings {
  defaultUnit: string
  enableExpiryTracking: boolean
  enableBatchTracking: boolean
  enableSerialTracking: boolean
  enableBarcodeScanning: boolean
  defaultPurchasePrice: number
  defaultSellingPrice: number
  defaultMinStock: number
  defaultMaxStock: number
  defaultReorderPoint: number
  autoGenerateBarcode: boolean
  barcodePrefix: string
  barcodeSymbology: BarcodeSymbology
  costingMethod: InventoryCostingMethod
  allowNegativeStock: boolean
  enablePriceGroups: boolean
  enableWholesalePrice: boolean
  enableMultiUnit: boolean
  itemNameFormat: string
  showExpiryInSales: boolean
  showBatchInSales: boolean
  daysToExpiryWarning: number
}

export interface ContactSettings {
  defaultCustomerGroup: string
  defaultSupplierGroup: string
  defaultPaymentTerm: PaymentTerm
  enableCustomerCreditLimit: boolean
  defaultCreditLimit: number
  enableCustomerLoyalty: boolean
  customerDisplayName: string
  requirePhoneForCustomers: boolean
  requirePhoneForSuppliers: boolean
  enableCustomerPriceGroup: boolean
  autoCreateCustomer: boolean
  defaultCustomerId: string
  enableCustomerDiscount: boolean
  defaultCustomerDiscount: number
}

export interface SalesSettings {
  invoicePrefix: string
  invoiceSuffix: string
  nextInvoiceNumber: number
  receiptFooter: string
  receiptHeader: string
  saleItemBehavior: SaleItemBehavior
  defaultDiscountPercent: number
  maxDiscountPercent: number
  enableDiscount: boolean
  enableReturn: boolean
  returnWindowDays: number
  requireReturnReason: boolean
  enableSalesRep: boolean
  salesRepCommissionBase: SalesRepCommissionBase
  salesRepCommissionRate: number
  enablePriceOverride: boolean
  requirePriceOverrideReason: boolean
  defaultSaleStatus: string
  enableDraftInvoices: boolean
  enablePriceOffers: boolean
  priceOfferValidDays: number
  enableShipping: boolean
  defaultShippingCost: number
  enableFreeReturns: boolean
}

export interface CashierSettings {
  posLayout: string
  posColumns: number
  enableQuickKeys: boolean
  quickKeys: string[]
  enableCashDrawer: boolean
  cashDrawerPort: string
  autoOpenDrawer: boolean
  enableCustomerSelection: boolean
  enableSearch: boolean
  searchMinChars: number
  showItemImage: boolean
  showItemStock: boolean
  showItemPrice: boolean
  enableCategoryFilter: boolean
  enableBarcodeSearch: boolean
  enableCalculator: boolean
  holdSaleEnabled: boolean
  quickSaleEnabled: boolean
  cashCategoryScope: CashCategoryScope
  defaultCashCategory: string
  audioOnScan: boolean
}

export interface PurchaseSettings {
  orderPrefix: string
  nextOrderNumber: number
  enablePurchaseApproval: boolean
  requireApprovalAbove: number
  defaultOrderStatus: string
  enablePartialReceiving: boolean
  enablePurchaseReturn: boolean
  returnWindowDays: number
  enableShippingCost: boolean
  defaultShippingCost: number
  enablePurchaseDiscount: boolean
  defaultDiscountPercent: number
  autoCreateStockOnReceive: boolean
  enableBatchTracking: boolean
  enableExpiryTracking: boolean
}

export interface PaymentSettings {
  defaultPaymentMethod: string
  acceptedPaymentMethods: string[]
  enableCardPayment: boolean
  cardFeePercent: number
  enableWalletPayment: boolean
  enableBankTransfer: boolean
  enablePartialPayment: boolean
  enableChangeCalculation: boolean
  paymentRounding: number
  defaultPaymentTerm: PaymentTerm
  enableDeposit: boolean
  depositPercent: number
}

export interface StockAlertSettings {
  enableLowStockAlerts: boolean
  lowStockThreshold: number
  enableExpiryAlerts: boolean
  expiryWarningDays: number
  enableOutOfStockAlerts: boolean
  alertConditions: StockAlertCondition[]
  defaultSeverity: StockAlertSeverity
  alertFrequency: string
  enableEmailAlerts: boolean
  enableInAppAlerts: boolean
  enableSmsAlerts: boolean
  maxAlertItems: number
}

export interface SystemSettings {
  appName: string
  appVersion: string
  companyName: string
  supportPhone: string
  supportEmail: string
  enableAutoBackup: boolean
  backupFrequency: string
  backupRetentionDays: number
  backupLocation: string
  enableAuditLog: boolean
  auditLogRetentionDays: number
  enableMultiBranch: boolean
  enableMultiCurrency: boolean
  defaultBranchId: string
  enableDarkMode: boolean
  enableNotifications: boolean
  sessionTimeout: number
  maxLoginAttempts: number
  enableTwoFactor: boolean
  maintenanceMode: boolean
}

export interface ShortcutSettings {
  enableShortcuts: boolean
  shortcuts: Record<string, string>
}

export interface EmailSettings {
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpEncryption: string
  fromAddress: string
  fromName: string
  enableEmailNotifications: boolean
  emailSignature: string
}

export interface SmsSettings {
  provider: string
  apiKey: string
  apiSecret: string
  senderId: string
  enableSmsNotifications: boolean
  smsSignature: string
  defaultCountryCode: string
}

export interface RewardSettings {
  enableRewards: boolean
  pointsPerAmount: number
  pointsCurrency: string
  pointsPerPurchase: number
  redeemRate: number
  minRedeemPoints: number
  maxRedeemPercent: number
  expiryDays: number
  enableBirthdayReward: boolean
  birthdayRewardPoints: number
  enableSignupReward: boolean
  signupRewardPoints: number
  rewardTiers: string[]
}

export interface ExtraUnitSettings {
  enableExtraUnits: boolean
  units: string[]
}

export interface CustomLabelSettings {
  enableCustomLabels: boolean
  itemFields: string[]
  purchaseFields: string[]
  shippingFields: string[]
  saleFields: string[]
  paymentFields: string[]
  contactFields: string[]
  locationFields: string[]
  userFields: string[]
  serviceFields: string[]
}

export interface SettingsTab {
  id: SettingsTabId
  label: string
  icon: string
}

export interface SettingsTabSection {
  id: string
  label: string
  tabs: SettingsTab[]
}

export interface TaxRate {
  id: string
  pharmacy_id: string
  name: string
  rate: number
  rate_type: TaxRateType
  is_default: boolean
  status: TaxRateStatus
  created_at: string
  updated_at: string
}

export interface TaxGroup {
  id: string
  pharmacy_id: string
  name: string
  description: string
  tax_rate_ids: string[]
  rates?: TaxRate[]
  is_default: boolean
  status: TaxGroupStatus
  created_at: string
  updated_at: string
}

export interface BarcodePaperSetting {
  id: string
  pharmacy_id: string
  name: string
  page_width: number
  page_height: number
  left_margin: number
  right_margin: number
  top_margin: number
  bottom_margin: number
  label_width: number
  label_height: number
  columns: number
  rows: number
  gap_horizontal: number
  gap_vertical: number
  font_size: number
  barcode_symbology: BarcodeSymbology
  show_price: boolean
  show_name: boolean
  show_barcode: boolean
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface InvoiceDesign {
  id: string
  pharmacy_id: string
  name: string
  template: InvoiceTemplate
  primary_color: string
  secondary_color: string
  accent_color: string
  show_logo: boolean
  logo_url: string | null
  show_header: boolean
  header_text: string
  show_footer: boolean
  footer_text: string
  show_tax: boolean
  show_discount: boolean
  show_barcode: boolean
  show_qr: boolean
  show_currency: boolean
  show_signature: boolean
  paper_size: PaperSize
  font_family: string
  font_size: number
  is_default: boolean
  status: InvoiceDesignStatus
  created_at: string
  updated_at: string
}

export interface ReceiptPrinter {
  id: string
  pharmacy_id: string
  name: string
  printer_type: PrinterType
  interface_type: PrinterInterface
  ip_address: string
  port: number
  paper_width: number
  characters_per_line: number
  is_default: boolean
  status: PrinterStatus
  created_at: string
  updated_at: string
}

export interface NotificationTemplate {
  id: string
  pharmacy_id: string
  name: string
  channel: NotificationChannel
  subject: string
  body: string
  variables: string[]
  is_default: boolean
  status: TemplateStatus
  created_at: string
  updated_at: string
}

export interface PharmacyProfile {
  id: string
  owner_id: string
  name: string
  legal_name: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  address: string | null
  logo_url: string | null
  currency: string
  timezone: string
  language: SystemLanguage
  tax_id: string | null
  commercial_register: string | null
  health_license: string | null
  website: string | null
  status: string
  plan: string
}

export interface SettingsRow {
  id: string
  pharmacy_id: string
  key: string
  value: string
  description: string | null
  created_at: string
  updated_at: string
}
