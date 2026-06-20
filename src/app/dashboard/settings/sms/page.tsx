"use client"

import { MessageSquare } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  TextField,
  SelectField,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"

const defaultSettings = {
  provider: "",
  apiKey: "",
  apiSecret: "",
  senderId: "",
  enableSmsNotifications: "false",
  smsSignature: "",
  defaultCountryCode: "+20",
}

const providerOptions = [
  { value: "", label: "اختر المزود" },
  { value: "twilio", label: "Twilio" },
  { value: "nexmo", label: "Vonage (Nexmo)" },
  { value: "unifonic", label: "Unifonic" },
  { value: "mobily", label: "Mobily" },
  { value: "other", label: "أخرى" },
]

const countryCodeOptions = [
  { value: "+20", label: "+20 مصر" },
  { value: "+966", label: "+966 السعودية" },
  { value: "+971", label: "+971 الإمارات" },
  { value: "+974", label: "+974 قطر" },
  { value: "+965", label: "+965 الكويت" },
  { value: "+973", label: "+973 البحرين" },
]

function SmsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات الرسائل النصية"
        description="تخصيص إعدادات مزود خدمة SMS"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="المزود" icon={MessageSquare}>
        <div className="space-y-4">
          <SelectField
            label="مزود الخدمة"
            value={getSetting("provider", "")}
            onChange={(v) => updateSetting("provider", v)}
            options={providerOptions}
            disabled={!canWrite}
          />
          <TextField
            label="API Key"
            value={getSetting("apiKey", "")}
            onChange={(v) => updateSetting("apiKey", v)}
            disabled={!canWrite}
            type="password"
          />
          <TextField
            label="API Secret"
            value={getSetting("apiSecret", "")}
            onChange={(v) => updateSetting("apiSecret", v)}
            disabled={!canWrite}
            type="password"
          />
          <TextField
            label="معرف المرسل (Sender ID)"
            value={getSetting("senderId", "")}
            onChange={(v) => updateSetting("senderId", v)}
            disabled={!canWrite}
            placeholder="Logixa"
          />
          <SelectField
            label="رمز الدولة الافتراضي"
            value={getSetting("defaultCountryCode", "+20")}
            onChange={(v) => updateSetting("defaultCountryCode", v)}
            options={countryCodeOptions}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإعدادات" icon={MessageSquare}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل الإشعارات عبر SMS"
            checked={getSetting("enableSmsNotifications", "false") === "true"}
            onChange={(v) => updateSetting("enableSmsNotifications", String(v))}
            disabled={!canWrite}
          />
          <TextField
            label="توقيع الرسائل"
            value={getSetting("smsSignature", "")}
            onChange={(v) => updateSetting("smsSignature", v)}
            disabled={!canWrite}
            placeholder="Logixa Pharmacy"
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function SmsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="sms">
        <SmsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
