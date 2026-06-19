"use client"

import { Tag } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"
import { Card, CardContent } from "@/components/ui/card"

const defaultSettings = {
  enableCustomLabels: "false",
}

const fieldGroups = [
  { key: "itemFields", label: "حقول الأصناف" },
  { key: "purchaseFields", label: "حقول المشتريات" },
  { key: "shippingFields", label: "حقول الشحن" },
  { key: "saleFields", label: "حقول المبيعات" },
  { key: "paymentFields", label: "حقول الدفع" },
  { key: "contactFields", label: "حقول جهات الاتصال" },
  { key: "locationFields", label: "حقول المواقع" },
  { key: "userFields", label: "حقول المستخدمين" },
  { key: "serviceFields", label: "حقول الخدمات" },
]

function CustomLabelsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات التسميات المخصصة"
        description="إضافة وتخصيص الحقول الإضافية في النظام"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="التسميات" icon={Tag}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل التسميات المخصصة"
            checked={getSetting("enableCustomLabels", "false") === "true"}
            onChange={(v) => updateSetting("enableCustomLabels", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-black text-slate-900">مجموعات الحقول المتاحة</h3>
          <div className="space-y-2">
            {fieldGroups.map((group) => (
              <div
                key={group.key}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5"
              >
                <span className="text-sm font-bold text-slate-700">{group.label}</span>
                <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500">
                  {}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-400">
            سيتم إضافة إمكانية إدارة الحقول المخصصة قريباً
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function CustomLabelsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="customLabels">
        <CustomLabelsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
