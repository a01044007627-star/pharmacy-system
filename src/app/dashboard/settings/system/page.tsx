"use client"

import { Lock, Settings, ShieldCheck } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  TextField,
  SelectField,
  NumberField,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"
import { BACKUP_FREQUENCY_OPTIONS } from "@/features/settings/constants"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useAuth } from "@/contexts/auth-context"

const defaultSettings = {
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
}

function SystemSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()
  const { isDeveloper } = useAuth()
  const canEditSystem = canWrite && isDeveloper

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات النظام"
        description="إدارة إعدادات النظام العامة والتطبيق"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canEditSystem}
      />

      <Alert className="border-blue-100 bg-blue-50/70 text-right text-slate-800">
        {canEditSystem ? <ShieldCheck className="size-4 text-brand" /> : <Lock className="size-4 text-amber-600" />}
        <AlertTitle className="font-black">{canEditSystem ? "صلاحية المطور مفعلة" : "عرض فقط لصاحب الصيدلية"}</AlertTitle>
        <AlertDescription className="text-xs font-semibold leading-6 text-slate-600">
          إعدادات اسم المنظومة والإصدار ووضع الصيانة إعدادات تشغيل أساسية، لذلك تعديلها متاح للمطور فقط حتى لا يحصل تعارض في تشغيل المنظومة.
        </AlertDescription>
      </Alert>

      <SettingsSectionCard title="معلومات التطبيق" icon={Settings}>
        <div className="space-y-4">
          <TextField
            label="اسم التطبيق"
            value={getSetting("appName", "Logixa Pharmacy")}
            onChange={(v) => updateSetting("appName", v)}
            disabled={!canEditSystem}
          />
          <TextField
            label="إصدار التطبيق"
            value={getSetting("appVersion", "1.0.0")}
            onChange={(v) => updateSetting("appVersion", v)}
            disabled={!canEditSystem}
          />
          <TextField
            label="اسم الشركة"
            value={getSetting("companyName", "")}
            onChange={(v) => updateSetting("companyName", v)}
            disabled={!canEditSystem}
          />
          <TextField
            label="هاتف الدعم"
            value={getSetting("supportPhone", "")}
            onChange={(v) => updateSetting("supportPhone", v)}
            disabled={!canEditSystem}
          />
          <TextField
            label="بريد الدعم"
            value={getSetting("supportEmail", "")}
            onChange={(v) => updateSetting("supportEmail", v)}
            disabled={!canEditSystem}
            type="email"
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="النسخ الاحتياطي" icon={Settings}>
        <div className="space-y-4">
          <ToggleField
            label="النسخ الاحتياطي التلقائي"
            checked={getSetting("enableAutoBackup", "true") === "true"}
            onChange={(v) => updateSetting("enableAutoBackup", String(v))}
            disabled={!canEditSystem}
          />
          <SelectField
            label="وتيرة النسخ الاحتياطي"
            value={getSetting("backupFrequency", "daily")}
            onChange={(v) => updateSetting("backupFrequency", v)}
            options={BACKUP_FREQUENCY_OPTIONS}
            disabled={!canEditSystem}
          />
          <NumberField
            label="الاحتفاظ بالنسخ (أيام)"
            value={Number(getSetting("backupRetentionDays", "30"))}
            onChange={(v) => updateSetting("backupRetentionDays", String(v))}
            min={1}
            max={365}
            disabled={!canEditSystem}
          />
          <TextField
            label="مساحة التخزين"
            value={getSetting("backupLocation", "")}
            onChange={(v) => updateSetting("backupLocation", v)}
            disabled={!canEditSystem}
            placeholder="/backups/"
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="سجل التدقيق" icon={Settings}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل سجل التدقيق"
            checked={getSetting("enableAuditLog", "true") === "true"}
            onChange={(v) => updateSetting("enableAuditLog", String(v))}
            disabled={!canEditSystem}
          />
          <NumberField
            label="الاحتفاظ بسجل التدقيق (أيام)"
            value={Number(getSetting("auditLogRetentionDays", "90"))}
            onChange={(v) => updateSetting("auditLogRetentionDays", String(v))}
            min={1}
            max={365}
            disabled={!canEditSystem}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإعدادات المتقدمة" icon={Settings}>
        <div className="space-y-4">
          <ToggleField
            label="الفروع المتعددة"
            checked={getSetting("enableMultiBranch", "false") === "true"}
            onChange={(v) => updateSetting("enableMultiBranch", String(v))}
            disabled={!canEditSystem}
          />
          <ToggleField
            label="العملات المتعددة"
            checked={getSetting("enableMultiCurrency", "false") === "true"}
            onChange={(v) => updateSetting("enableMultiCurrency", String(v))}
            disabled={!canEditSystem}
          />
          <ToggleField
            label="الوضع الليلي"
            checked={getSetting("enableDarkMode", "false") === "true"}
            onChange={(v) => updateSetting("enableDarkMode", String(v))}
            disabled={!canEditSystem}
          />
          <ToggleField
            label="تفعيل الإشعارات"
            checked={getSetting("enableNotifications", "true") === "true"}
            onChange={(v) => updateSetting("enableNotifications", String(v))}
            disabled={!canEditSystem}
          />
          <ToggleField
            label="التحقق بخطوتين"
            checked={getSetting("enableTwoFactor", "false") === "true"}
            onChange={(v) => updateSetting("enableTwoFactor", String(v))}
            disabled={!canEditSystem}
          />
          <NumberField
            label="مهلة الجلسة (دقائق)"
            value={Number(getSetting("sessionTimeout", "60"))}
            onChange={(v) => updateSetting("sessionTimeout", String(v))}
            min={1}
            max={1440}
            disabled={!canEditSystem}
          />
          <NumberField
            label="الحد الأقصى لمحاولات تسجيل الدخول"
            value={Number(getSetting("maxLoginAttempts", "5"))}
            onChange={(v) => updateSetting("maxLoginAttempts", String(v))}
            min={1}
            max={20}
            disabled={!canEditSystem}
          />
          <ToggleField
            label="وضع الصيانة"
            checked={getSetting("maintenanceMode", "false") === "true"}
            onChange={(v) => updateSetting("maintenanceMode", String(v))}
            disabled={!canEditSystem}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function SystemSettingsPage() {
  const { isDeveloper } = useAuth()

  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="system" canWriteOverride={isDeveloper}>
        <SystemSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
