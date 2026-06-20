"use client"

import { Bell } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  SelectField,
  NumberField,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"
import { ALERT_FREQUENCY_OPTIONS } from "@/features/settings/constants"

const defaultSettings = {
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
}

const severityOptions = [
  { value: "low", label: "منخفض" },
  { value: "medium", label: "متوسط" },
  { value: "high", label: "عالٍ" },
]

const conditionOptions = [
  { value: "below_min", label: "أقل من الحد الأدنى" },
  { value: "below_reorder", label: "أقل من نقطة إعادة الطلب" },
  { value: "expiring_soon", label: "ينتهي قريباً" },
  { value: "expired", label: "منتهي الصلاحية" },
]

function StockAlertsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات تنبيهات المخزون"
        description="تخصيص إعدادات التنبيهات والإشعارات"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="التنبيهات الأساسية" icon={Bell}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل تنبيهات نفاد المخزون"
            checked={getSetting("enableLowStockAlerts", "true") === "true"}
            onChange={(v) => updateSetting("enableLowStockAlerts", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="حد المخزون المنخفض"
            value={Number(getSetting("lowStockThreshold", "10"))}
            onChange={(v) => updateSetting("lowStockThreshold", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل تنبيهات انتهاء الصلاحية"
            checked={getSetting("enableExpiryAlerts", "true") === "true"}
            onChange={(v) => updateSetting("enableExpiryAlerts", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="عدد أيام التحذير قبل انتهاء الصلاحية"
            value={Number(getSetting("expiryWarningDays", "30"))}
            onChange={(v) => updateSetting("expiryWarningDays", String(v))}
            min={1}
            max={365}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل تنبيهات نفاد الكمية"
            checked={getSetting("enableOutOfStockAlerts", "true") === "true"}
            onChange={(v) => updateSetting("enableOutOfStockAlerts", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإعدادات المتقدمة" icon={Bell}>
        <div className="space-y-4">
          <SelectField
            label="شروط التنبيه"
            value={getSetting("alertConditions", "below_min,expiring_soon")}
            onChange={(v) => updateSetting("alertConditions", v)}
            options={conditionOptions}
            disabled={!canWrite}
          />
          <SelectField
            label="درجة الخطورة الافتراضية"
            value={getSetting("defaultSeverity", "medium")}
            onChange={(v) => updateSetting("defaultSeverity", v)}
            options={severityOptions}
            disabled={!canWrite}
          />
          <SelectField
            label="تكرار التنبيهات"
            value={getSetting("alertFrequency", "daily")}
            onChange={(v) => updateSetting("alertFrequency", v)}
            options={ALERT_FREQUENCY_OPTIONS}
            disabled={!canWrite}
          />
          <NumberField
            label="الحد الأقصى لعناصر التنبيه"
            value={Number(getSetting("maxAlertItems", "50"))}
            onChange={(v) => updateSetting("maxAlertItems", String(v))}
            min={1}
            max={500}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="قنوات التنبيه" icon={Bell}>
        <div className="space-y-4">
          <ToggleField
            label="التنبيهات داخل التطبيق"
            checked={getSetting("enableInAppAlerts", "true") === "true"}
            onChange={(v) => updateSetting("enableInAppAlerts", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="التنبيهات عبر البريد الإلكتروني"
            checked={getSetting("enableEmailAlerts", "false") === "true"}
            onChange={(v) => updateSetting("enableEmailAlerts", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="التنبيهات عبر الرسائل النصية"
            checked={getSetting("enableSmsAlerts", "false") === "true"}
            onChange={(v) => updateSetting("enableSmsAlerts", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function StockAlertsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="stockAlerts">
        <StockAlertsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
