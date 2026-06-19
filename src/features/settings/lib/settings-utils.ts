import { SETTINGS_DEFAULTS, type SettingsNamespace } from "./settings-keys"

export type SettingsMap = Record<string, string>

export function boolSetting(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback
  return ["true", "1", "yes", "on", "enabled"].includes(String(value).toLowerCase())
}

export function numberSetting(value: string | undefined, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function listSetting(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readSetting(
  settings: SettingsMap,
  namespace: SettingsNamespace,
  key: string,
  fallback?: string,
): string {
  const namespaced = `${namespace}.${key}`
  return settings[namespaced]
    ?? settings[key]
    ?? fallback
    ?? SETTINGS_DEFAULTS[namespace]?.[key]
    ?? ""
}

export function roundBySettings(value: number, settings: SettingsMap): number {
  const places = Math.max(0, Math.min(6, numberSetting(readSetting(settings, "project", "decimalPlaces"), 2)))
  const mode = readSetting(settings, "project", "roundingMode", "half-up")
  const factor = 10 ** places
  if (mode === "ceil") return Math.ceil(value * factor) / factor
  if (mode === "floor") return Math.floor(value * factor) / factor
  if (mode === "half-down") return Math.ceil(value * factor - 0.5) / factor
  return Math.round(value * factor) / factor
}

export function formatCurrencyBySettings(value: unknown, settings: SettingsMap): string {
  const amount = typeof value === "number" ? value : Number(value ?? 0)
  const rounded = roundBySettings(Number.isFinite(amount) ? amount : 0, settings)
  const places = Math.max(0, Math.min(6, numberSetting(readSetting(settings, "project", "decimalPlaces"), 2)))
  const symbol = readSetting(settings, "project", "currencySymbol", "ج.م")
  const placement = readSetting(settings, "project", "currencySymbolPlacement", "after")
  const formatted = rounded.toLocaleString("ar-EG", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
  return placement === "before" ? `${symbol} ${formatted}` : `${formatted} ${symbol}`
}

export function formatDateBySettings(date: string | Date | number | null | undefined, settings: SettingsMap): string {
  if (!date) return "—"
  const value = typeof date === "string" || typeof date === "number" ? new Date(date) : date
  if (Number.isNaN(value.getTime())) return "—"
  const format = readSetting(settings, "project", "dateFormat", "YYYY-MM-DD")
  const day = String(value.getDate()).padStart(2, "0")
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const year = String(value.getFullYear())
  return format
    .replace("YYYY", year)
    .replace("MM", month)
    .replace("DD", day)
}

export function formatDateTimeBySettings(date: string | Date | number | null | undefined, settings: SettingsMap): string {
  if (!date) return "—"
  const value = typeof date === "string" || typeof date === "number" ? new Date(date) : date
  if (Number.isNaN(value.getTime())) return "—"
  const base = formatDateBySettings(value, settings)
  const use12h = readSetting(settings, "project", "timeFormat", "24") === "12"
  const time = value.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12h,
  })
  return `${base} ${time}`
}

export function calculateTaxBySettings(subtotal: number, settings: SettingsMap): { subtotal: number; tax: number; total: number } {
  const enabled = boolSetting(readSetting(settings, "tax" as SettingsNamespace, "enableMultipleTaxes"), false)
  const rate = numberSetting(readSetting(settings, "tax" as SettingsNamespace, "vatRate", readSetting(settings, "tax" as SettingsNamespace, "defaultTaxRate", "0")), 0)
  const inclusive = readSetting(settings, "tax" as SettingsNamespace, "taxCalculationMethod", "exclusive") === "inclusive"
  if (!enabled && rate <= 0) return { subtotal, tax: 0, total: subtotal }
  if (inclusive) {
    const tax = subtotal - subtotal / (1 + rate / 100)
    return { subtotal: subtotal - tax, tax: roundBySettings(tax, settings), total: subtotal }
  }
  const tax = roundBySettings(subtotal * (rate / 100), settings)
  return { subtotal, tax, total: roundBySettings(subtotal + tax, settings) }
}

export function isExpiryTrackingEnabled(settings: SettingsMap): boolean {
  return boolSetting(readSetting(settings, "items", "enableExpiryTracking"), true)
}

export function isBatchTrackingEnabled(settings: SettingsMap): boolean {
  return boolSetting(readSetting(settings, "items", "enableBatchTracking"), false)
}

export function isPriceGroupsEnabled(settings: SettingsMap): boolean {
  return boolSetting(readSetting(settings, "items", "enablePriceGroups"), false)
}

export function isMultiUnitEnabled(settings: SettingsMap): boolean {
  return boolSetting(readSetting(settings, "items", "enableMultiUnit"), false)
}

export function expiryWarningDays(settings: SettingsMap): number {
  return numberSetting(
    readSetting(settings, "stockAlerts", "expiryWarningDays", readSetting(settings, "items", "daysToExpiryWarning", "30")),
    30,
  )
}

export function lowStockThreshold(settings: SettingsMap): number {
  return numberSetting(readSetting(settings, "stockAlerts", "lowStockThreshold", readSetting(settings, "items", "defaultMinStock", "0")), 0)
}
