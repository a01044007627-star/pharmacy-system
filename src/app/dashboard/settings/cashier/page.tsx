"use client"

import { Monitor } from "lucide-react"
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
  posLayout: "grid",
  posColumns: "4",
  enableQuickKeys: "true",
  quickKeys: "",
  enableCashDrawer: "false",
  cashDrawerPort: "",
  autoOpenDrawer: "true",
  enableCustomerSelection: "true",
  enableSearch: "true",
  searchMinChars: "2",
  showItemImage: "true",
  showItemStock: "true",
  showItemPrice: "true",
  enableCategoryFilter: "true",
  enableBarcodeSearch: "true",
  enableCalculator: "true",
  holdSaleEnabled: "true",
  quickSaleEnabled: "true",
  audioOnScan: "true",
}

const layoutOptions = [
  { value: "grid", label: "شبكي" },
  { value: "list", label: "قائمة" },
  { value: "compact", label: "مضغوط" },
]

function CashierSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات الكاشير"
        description="تخصيص شاشة البيع ونقطة البيع"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="تخطيط الشاشة" icon={Monitor}>
        <div className="space-y-4">
          <SelectField
            label="تخطيط نقاط البيع"
            value={getSetting("posLayout", "grid")}
            onChange={(v) => updateSetting("posLayout", v)}
            options={layoutOptions}
            disabled={!canWrite}
          />
          <NumberField
            label="عدد الأعمدة"
            value={Number(getSetting("posColumns", "4"))}
            onChange={(v) => updateSetting("posColumns", String(v))}
            min={1}
            max={8}
            disabled={!canWrite}
          />
          <ToggleField
            label="إظهار صورة الصنف"
            checked={getSetting("showItemImage", "true") === "true"}
            onChange={(v) => updateSetting("showItemImage", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إظهار مخزون الصنف"
            checked={getSetting("showItemStock", "true") === "true"}
            onChange={(v) => updateSetting("showItemStock", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إظهار سعر الصنف"
            checked={getSetting("showItemPrice", "true") === "true"}
            onChange={(v) => updateSetting("showItemPrice", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="البحث والفلترة" icon={Monitor}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل البحث"
            checked={getSetting("enableSearch", "true") === "true"}
            onChange={(v) => updateSetting("enableSearch", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="الحد الأدنى لأحرف البحث"
            value={Number(getSetting("searchMinChars", "2"))}
            onChange={(v) => updateSetting("searchMinChars", String(v))}
            min={1}
            max={10}
            disabled={!canWrite}
          />
          <ToggleField
            label="فلترة بالفئة"
            checked={getSetting("enableCategoryFilter", "true") === "true"}
            onChange={(v) => updateSetting("enableCategoryFilter", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="البحث بالباركود"
            checked={getSetting("enableBarcodeSearch", "true") === "true"}
            onChange={(v) => updateSetting("enableBarcodeSearch", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الدرج والطابعة" icon={Monitor}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل درج النقود"
            checked={getSetting("enableCashDrawer", "false") === "true"}
            onChange={(v) => updateSetting("enableCashDrawer", String(v))}
            disabled={!canWrite}
          />
          <TextField
            label="منفذ درج النقود"
            value={getSetting("cashDrawerPort", "")}
            onChange={(v) => updateSetting("cashDrawerPort", v)}
            disabled={!canWrite}
            placeholder="COM1"
          />
          <ToggleField
            label="فتح تلقائي للدرج"
            checked={getSetting("autoOpenDrawer", "true") === "true"}
            onChange={(v) => updateSetting("autoOpenDrawer", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="صوت عند المسح"
            checked={getSetting("audioOnScan", "true") === "true"}
            onChange={(v) => updateSetting("audioOnScan", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="خيارات البيع" icon={Monitor}>
        <div className="space-y-4">
          <ToggleField
            label="اختيار العميل"
            checked={getSetting("enableCustomerSelection", "true") === "true"}
            onChange={(v) => updateSetting("enableCustomerSelection", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="المفاتيح السريعة"
            checked={getSetting("enableQuickKeys", "true") === "true"}
            onChange={(v) => updateSetting("enableQuickKeys", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="الآلة الحاسبة"
            checked={getSetting("enableCalculator", "true") === "true"}
            onChange={(v) => updateSetting("enableCalculator", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="تعليق الفاتورة"
            checked={getSetting("holdSaleEnabled", "true") === "true"}
            onChange={(v) => updateSetting("holdSaleEnabled", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="البيع السريع"
            checked={getSetting("quickSaleEnabled", "true") === "true"}
            onChange={(v) => updateSetting("quickSaleEnabled", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function CashierSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="cashier">
        <CashierSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
