"use client"

import { FileText } from "lucide-react"
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
  enableShortcuts: "true",
}

const defaultShortcuts = [
  { key: "ctrl+n", action: "إنشاء صنف جديد" },
  { key: "ctrl+s", action: "حفظ" },
  { key: "ctrl+f", action: "بحث" },
  { key: "ctrl+p", action: "طباعة" },
  { key: "ctrl+d", action: "نسخ" },
  { key: "f1", action: "مساعدة" },
  { key: "f8", action: "فتح الكاشير" },
  { key: "escape", action: "إغلاق" },
]

function ShortcutsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات الاختصارات"
        description="تخصيص اختصارات لوحة المفاتيح"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الاختصارات" icon={FileText}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل اختصارات لوحة المفاتيح"
            checked={getSetting("enableShortcuts", "true") === "true"}
            onChange={(v) => updateSetting("enableShortcuts", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-black text-slate-900">الاختصارات الافتراضية</h3>
          <div className="space-y-2">
            {defaultShortcuts.map((shortcut) => (
              <div
                key={shortcut.key}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5"
              >
                <span className="text-sm font-semibold text-slate-600">{shortcut.action}</span>
                <kbd className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-black text-slate-700 shadow-sm">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-400">
            سيتم إضافة إمكانية تخصيص الاختصارات قريباً
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ShortcutsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="shortcuts">
        <ShortcutsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
