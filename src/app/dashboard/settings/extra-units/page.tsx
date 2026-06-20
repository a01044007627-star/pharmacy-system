"use client"

import { useState } from "react"
import { Copy, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  ToggleField,
  TextField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const defaultSettings = {
  enableExtraUnits: "false",
}

const defaultUnits = ["علبة", "شريط", "قرص", "كابسولة", "أمبول", "زجاجة", "بخاخ", "أنبوب", "قطارة", "عبوة"]

function ExtraUnitsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()
  const [units, setUnits] = useState<string[]>([])
  const [newUnit, setNewUnit] = useState("")

  function addUnit() {
    if (!newUnit.trim()) { toast.error("يرجى إدخال اسم الوحدة"); return }
    if (units.includes(newUnit.trim())) { toast.error("الوحدة موجودة مسبقاً"); return }
    setUnits((prev) => [...prev, newUnit.trim()])
    setNewUnit("")
  }

  function removeUnit(index: number) {
    setUnits((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات الوحدات الإضافية"
        description="إدارة الوحدات الإضافية للأصناف"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الوحدات" icon={Copy}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل الوحدات الإضافية"
            checked={getSetting("enableExtraUnits", "false") === "true"}
            onChange={(v) => updateSetting("enableExtraUnits", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-black text-slate-900">الوحدات الافتراضية</h3>
          <div className="mb-4 flex flex-wrap gap-2">
            {defaultUnits.map((unit) => (
              <span
                key={unit}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-700"
              >
                {unit}
              </span>
            ))}
          </div>
          <p className="text-xs font-semibold text-slate-400">
            يمكن إضافة وحدات مخصصة إضافية من شاشة إدارة الأصناف
          </p>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-black text-slate-900">وحدات مخصصة</h3>
            <div className="mb-3 flex items-center gap-2">
              <TextField
                label=""
                value={newUnit}
                onChange={setNewUnit}
                placeholder="اسم الوحدة"
              />
              <Button variant="default" size="sm" onClick={addUnit} className="shrink-0">
                <Plus className="size-4" />
                إضافة
              </Button>
            </div>
            <div className="space-y-2">
              {units.length === 0 ? (
                <p className="text-xs font-semibold text-slate-400">لا توجد وحدات مخصصة بعد</p>
              ) : units.map((unit, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5"
                >
                  <span className="text-sm font-bold text-slate-700">{unit}</span>
                  <Button variant="ghost" size="icon-xs" onClick={() => removeUnit(index)}>
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default function ExtraUnitsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="extraUnits">
        <ExtraUnitsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
