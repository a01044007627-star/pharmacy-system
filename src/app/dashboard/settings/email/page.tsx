"use client"

import { Mail } from "lucide-react"
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

const defaultSettings = {
  smtpHost: "",
  smtpPort: "587",
  smtpUsername: "",
  smtpPassword: "",
  smtpEncryption: "tls",
  fromAddress: "",
  fromName: "",
  enableEmailNotifications: "false",
  emailSignature: "",
}

const encryptionOptions = [
  { value: "none", label: "بدون تشفير" },
  { value: "tls", label: "TLS" },
  { value: "ssl", label: "SSL" },
]

function EmailSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات البريد الإلكتروني"
        description="تخصيص إعدادات SMTP والبريد الصادر"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="خادم البريد (SMTP)" icon={Mail}>
        <div className="space-y-4">
          <TextField
            label="خادم SMTP"
            value={getSetting("smtpHost", "")}
            onChange={(v) => updateSetting("smtpHost", v)}
            disabled={!canWrite}
            placeholder="smtp.gmail.com"
          />
          <NumberField
            label="المنفذ"
            value={Number(getSetting("smtpPort", "587"))}
            onChange={(v) => updateSetting("smtpPort", String(v))}
            min={1}
            max={65535}
            disabled={!canWrite}
          />
          <SelectField
            label="نوع التشفير"
            value={getSetting("smtpEncryption", "tls")}
            onChange={(v) => updateSetting("smtpEncryption", v)}
            options={encryptionOptions}
            disabled={!canWrite}
          />
          <TextField
            label="اسم المستخدم"
            value={getSetting("smtpUsername", "")}
            onChange={(v) => updateSetting("smtpUsername", v)}
            disabled={!canWrite}
            placeholder="user@example.com"
          />
          <TextField
            label="كلمة المرور"
            value={getSetting("smtpPassword", "")}
            onChange={(v) => updateSetting("smtpPassword", v)}
            disabled={!canWrite}
            type="password"
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="البريد الصادر" icon={Mail}>
        <div className="space-y-4">
          <TextField
            label="البريد الإلكتروني المرسل"
            value={getSetting("fromAddress", "")}
            onChange={(v) => updateSetting("fromAddress", v)}
            disabled={!canWrite}
            placeholder="noreply@pharmacy.com"
          />
          <TextField
            label="اسم المرسل"
            value={getSetting("fromName", "")}
            onChange={(v) => updateSetting("fromName", v)}
            disabled={!canWrite}
            placeholder="Logixa Pharmacy"
          />
          <TextField
            label="توقيع البريد"
            value={getSetting("emailSignature", "")}
            onChange={(v) => updateSetting("emailSignature", v)}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإشعارات" icon={Mail}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل الإشعارات البريدية"
            checked={getSetting("enableEmailNotifications", "false") === "true"}
            onChange={(v) => updateSetting("enableEmailNotifications", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function EmailSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="email">
        <EmailSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
