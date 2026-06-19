import type { SettingsTabId } from "./types"
import type { Permission } from "@/lib/auth/permissions"

export const settingsTabList: { id: SettingsTabId; label: string; icon: string }[] = [
  { id: "project", label: "عامة", icon: "building" },
  { id: "tax", label: "الضرائب", icon: "receipt-tax" },
  { id: "items", label: "الأصناف", icon: "package" },
  { id: "contacts", label: "جهات الاتصال", icon: "users" },
  { id: "sales", label: "المبيعات", icon: "shopping-cart" },
  { id: "cashier", label: "الكاشير", icon: "gauge" },
  { id: "purchases", label: "المشتريات", icon: "truck" },
  { id: "payments", label: "المدفوعات", icon: "wallet" },
  { id: "stockAlerts", label: "تنبيهات المخزون", icon: "bell" },
  { id: "system", label: "النظام", icon: "settings" },
  { id: "shortcuts", label: "الاختصارات", icon: "keyboard" },
  { id: "email", label: "البريد الإلكتروني", icon: "mail" },
  { id: "sms", label: "الرسائل النصية", icon: "message-square" },
  { id: "rewards", label: "المكافآت", icon: "gift" },
  { id: "extraUnits", label: "الوحدات الإضافية", icon: "scale" },
  { id: "customLabels", label: "التسميات المخصصة", icon: "tags" },
]

export const settingsPermissionMap: Record<SettingsTabId, Permission[]> = {
  project: ["settings:read"],
  tax: ["settings:read"],
  items: ["settings:read"],
  contacts: ["settings:read"],
  sales: ["settings:read"],
  cashier: ["settings:read"],
  purchases: ["settings:read"],
  payments: ["settings:read"],
  stockAlerts: ["settings:read"],
  system: ["settings:read"],
  shortcuts: ["settings:read"],
  email: ["settings:read"],
  sms: ["settings:read"],
  rewards: ["settings:read"],
  extraUnits: ["settings:read"],
  customLabels: ["settings:read"],
}

export const settingsWritePermissionMap: Record<SettingsTabId, Permission[]> = {
  project: ["settings:write"],
  tax: ["settings:write"],
  items: ["settings:write"],
  contacts: ["settings:write"],
  sales: ["settings:write"],
  cashier: ["settings:write"],
  purchases: ["settings:write"],
  payments: ["settings:write"],
  stockAlerts: ["settings:write"],
  system: ["settings:write"],
  shortcuts: ["settings:write"],
  email: ["settings:write"],
  sms: ["settings:write"],
  rewards: ["settings:write"],
  extraUnits: ["settings:write"],
  customLabels: ["settings:write"],
}

export interface ManagementEntityField {
  key: string
  label: string
  type: "text" | "number" | "select" | "boolean" | "color" | "textarea"
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  defaultValue?: unknown
}

export const taxRateFields: ManagementEntityField[] = [
  { key: "name", label: "الاسم", type: "text", required: true, placeholder: "مثال: ضريبة القيمة المضافة" },
  { key: "rate", label: "النسبة (%)", type: "number", required: true, placeholder: "مثال: 15" },
  { key: "rate_type", label: "نوع الضريبة", type: "select", required: true, options: [{ value: "percent", label: "نسبة مئوية" }, { value: "fixed", label: "قيمة ثابتة" }] },
  { key: "is_default", label: "افتراضي", type: "boolean", defaultValue: false },
  { key: "status", label: "الحالة", type: "select", required: true, options: [{ value: "active", label: "نشط" }, { value: "inactive", label: "غير نشط" }] },
]

export const taxGroupFields: ManagementEntityField[] = [
  { key: "name", label: "اسم المجموعة", type: "text", required: true, placeholder: "مثال: مجموعة ضريبية أ" },
  { key: "description", label: "الوصف", type: "textarea", placeholder: "وصف المجموعة الضريبية" },
  { key: "tax_rate_ids", label: "الضرائب", type: "select", required: true },
  { key: "is_default", label: "افتراضي", type: "boolean", defaultValue: false },
  { key: "status", label: "الحالة", type: "select", required: true, options: [{ value: "active", label: "نشط" }, { value: "inactive", label: "غير نشط" }] },
]

export const barcodePaperFields: ManagementEntityField[] = [
  { key: "name", label: "اسم الورق", type: "text", required: true },
  { key: "page_width", label: "عرض الصفحة (مم)", type: "number", required: true },
  { key: "page_height", label: "ارتفاع الصفحة (مم)", type: "number", required: true },
  { key: "left_margin", label: "هامش أيسر (مم)", type: "number", required: true },
  { key: "right_margin", label: "هامش أيمن (مم)", type: "number", required: true },
  { key: "top_margin", label: "هامش علوي (مم)", type: "number", required: true },
  { key: "bottom_margin", label: "هامش سفلي (مم)", type: "number", required: true },
  { key: "label_width", label: "عرض الملصق (مم)", type: "number", required: true },
  { key: "label_height", label: "ارتفاع الملصق (مم)", type: "number", required: true },
  { key: "columns", label: "عدد الأعمدة", type: "number", required: true },
  { key: "rows", label: "عدد الصفوف", type: "number", required: true },
  { key: "gap_horizontal", label: "الفجوة الأفقية (مم)", type: "number" },
  { key: "gap_vertical", label: "الفجوة الرأسية (مم)", type: "number" },
  { key: "font_size", label: "حجم الخط", type: "number" },
  { key: "is_default", label: "افتراضي", type: "boolean" },
]

export const invoiceDesignFields: ManagementEntityField[] = [
  { key: "name", label: "اسم التصميم", type: "text", required: true },
  { key: "template", label: "القالب", type: "select", required: true, options: [
    { value: "standard", label: "قياسي" },
    { value: "modern", label: "حديث" },
    { value: "compact", label: "مضغوط" },
    { value: "minimal", label: "بسيط" },
  ]},
  { key: "primary_color", label: "اللون الأساسي", type: "color" },
  { key: "secondary_color", label: "اللون الثانوي", type: "color" },
  { key: "accent_color", label: "لون التمييز", type: "color" },
  { key: "show_logo", label: "إظهار الشعار", type: "boolean" },
  { key: "show_header", label: "إظهار الترويسة", type: "boolean" },
  { key: "header_text", label: "نص الترويسة", type: "text" },
  { key: "show_footer", label: "إظهار التذييل", type: "boolean" },
  { key: "footer_text", label: "نص التذييل", type: "text" },
  { key: "show_tax", label: "إظهار الضريبة", type: "boolean" },
  { key: "show_discount", label: "إظهار الخصم", type: "boolean" },
  { key: "paper_size", label: "حجم الورق", type: "select", options: [
    { value: "A4", label: "A4" },
    { value: "A5", label: "A5" },
    { value: "A6", label: "A6" },
    { value: "80mm", label: "80 مم" },
    { value: "58mm", label: "58 مم" },
  ]},
  { key: "font_family", label: "نوع الخط", type: "text" },
  { key: "is_default", label: "افتراضي", type: "boolean" },
  { key: "status", label: "الحالة", type: "select", options: [
    { value: "active", label: "نشط" },
    { value: "inactive", label: "غير نشط" },
  ]},
]

export const printerFields: ManagementEntityField[] = [
  { key: "name", label: "اسم الطابعة", type: "text", required: true },
  { key: "printer_type", label: "نوع الطابعة", type: "select", required: true, options: [
    { value: "thermal", label: "حرارية" },
    { value: "inkjet", label: "نافثة للحبر" },
    { value: "dot_matrix", label: "نقطية" },
  ]},
  { key: "interface_type", label: "نوع الواجهة", type: "select", required: true, options: [
    { value: "usb", label: "USB" },
    { value: "bluetooth", label: "بلوتوث" },
    { value: "network", label: "شبكة" },
    { value: "wifi", label: "WiFi" },
    { value: "serial", label: "منفذ تسلسلي" },
  ]},
  { key: "ip_address", label: "عنوان IP", type: "text", placeholder: "192.168.1.100" },
  { key: "port", label: "المنفذ", type: "number" },
  { key: "paper_width", label: "عرض الورق (مم)", type: "number", required: true },
  { key: "characters_per_line", label: "عدد الأحرف في السطر", type: "number" },
  { key: "is_default", label: "افتراضي", type: "boolean" },
  { key: "status", label: "الحالة", type: "select", options: [
    { value: "active", label: "نشط" },
    { value: "inactive", label: "غير نشط" },
  ]},
]

export const notificationTemplateFields: ManagementEntityField[] = [
  { key: "name", label: "اسم القالب", type: "text", required: true },
  { key: "channel", label: "القناة", type: "select", required: true, options: [
    { value: "sms", label: "رسالة نصية" },
    { value: "email", label: "بريد إلكتروني" },
    { value: "inapp", label: "إشعار داخل التطبيق" },
  ]},
  { key: "subject", label: "الموضوع", type: "text", placeholder: "موضوع الرسالة" },
  { key: "body", label: "المحتوى", type: "textarea", required: true, placeholder: "محتوى القالب" },
  { key: "variables", label: "المتغيرات", type: "text", placeholder: "متغيرات مفصولة بفواصل" },
  { key: "is_default", label: "افتراضي", type: "boolean" },
  { key: "status", label: "الحالة", type: "select", options: [
    { value: "active", label: "نشط" },
    { value: "inactive", label: "غير نشط" },
  ]},
]

export const CURRENCY_SYMBOL_PLACEMENT_OPTIONS = [
  { value: "before", label: "قبل المبلغ" },
  { value: "after", label: "بعد المبلغ" },
]

export const INVENTORY_COSTING_METHOD_OPTIONS = [
  { value: "average", label: "المتوسط المرجح" },
  { value: "fifo", label: "الوارد أولاً صادر أولاً" },
  { value: "lifo", label: "الوارد أخيراً صادر أولاً" },
]

export const PAYMENT_TERM_OPTIONS = [
  { value: "cash", label: "نقداً" },
  { value: "day", label: "يوم" },
  { value: "month", label: "شهر" },
]

export const SALE_ITEM_BEHAVIOR_OPTIONS = [
  { value: "increase", label: "زيادة الكمية" },
  { value: "replace", label: "استبدال" },
  { value: "warn", label: "تحذير" },
]

export const TAX_CALCULATION_METHOD_OPTIONS = [
  { value: "exclusive", label: "الضريبة خارج السعر" },
  { value: "inclusive", label: "الضريبة ضمن السعر" },
]

export const TIME_FORMAT_OPTIONS = [
  { value: "24", label: "24 ساعة" },
  { value: "12", label: "12 ساعة" },
]

export const LANGUAGE_OPTIONS = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
]

export const BACKUP_FREQUENCY_OPTIONS = [
  { value: "hourly", label: "كل ساعة" },
  { value: "daily", label: "يومياً" },
  { value: "weekly", label: "أسبوعياً" },
  { value: "monthly", label: "شهرياً" },
]

export const ALERT_FREQUENCY_OPTIONS = [
  { value: "realtime", label: "فوري" },
  { value: "hourly", label: "كل ساعة" },
  { value: "daily", label: "يومياً" },
  { value: "weekly", label: "أسبوعياً" },
]

export const SETTINGS_STORAGE_KEYS = {
  PREFIX: "pharmacy_settings_",
  get: (pharmacyId: string) => `pharmacy_settings_${pharmacyId}`,
  DEFAULTS_LOADED: "pharmacy_settings_defaults_loaded",
}
