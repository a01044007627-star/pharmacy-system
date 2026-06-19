"use client"

import { Package } from "lucide-react"
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
import { INVENTORY_COSTING_METHOD_OPTIONS } from "@/features/settings/constants"

const defaultSettings = {
  defaultUnit: "قطعة",
  enableExpiryTracking: "true",
  enableBatchTracking: "false",
  enableSerialTracking: "false",
  enableBarcodeScanning: "true",
  defaultPurchasePrice: "0",
  defaultSellingPrice: "0",
  defaultMinStock: "0",
  defaultMaxStock: "0",
  defaultReorderPoint: "0",
  autoGenerateBarcode: "false",
  barcodePrefix: "",
  barcodeSymbology: "Code-128",
  costingMethod: "average",
  allowNegativeStock: "false",
  enablePriceGroups: "false",
  enableWholesalePrice: "true",
  enableMultiUnit: "false",
  itemNameFormat: "arabic",
  showExpiryInSales: "true",
  showBatchInSales: "false",
  daysToExpiryWarning: "30",
}

const symbologyOptions = [
  { value: "EAN-13", label: "EAN-13" },
  { value: "EAN-8", label: "EAN-8" },
  { value: "Code-128", label: "Code-128" },
  { value: "Code-39", label: "Code-39" },
  { value: "UPC-A", label: "UPC-A" },
  { value: "QR Code", label: "QR Code" },
]

const nameFormatOptions = [
  { value: "arabic", label: "الاسم العربي" },
  { value: "english", label: "الاسم الإنجليزي" },
  { value: "both", label: "الاسمين معاً" },
]

function ItemsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات الأصناف"
        description="تخصيص إعدادات الأصناف والمخزون"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الوحدات والتتبع" icon={Package}>
        <div className="space-y-4">
          <TextField
            label="الوحدة الافتراضية"
            value={getSetting("defaultUnit", "قطعة")}
            onChange={(v) => updateSetting("defaultUnit", v)}
            disabled={!canWrite}
            placeholder="قطعة"
          />
          <ToggleField
            label="تتبع تواريخ انتهاء الصلاحية"
            checked={getSetting("enableExpiryTracking", "true") === "true"}
            onChange={(v) => updateSetting("enableExpiryTracking", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="تتبع الباتش (رقم التشغيلة)"
            checked={getSetting("enableBatchTracking", "false") === "true"}
            onChange={(v) => updateSetting("enableBatchTracking", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="تتبع الأرقام التسلسلية"
            checked={getSetting("enableSerialTracking", "false") === "true"}
            onChange={(v) => updateSetting("enableSerialTracking", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="مسح الباركود"
            checked={getSetting("enableBarcodeScanning", "true") === "true"}
            onChange={(v) => updateSetting("enableBarcodeScanning", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="عدد أيام التحذير قبل انتهاء الصلاحية"
            value={Number(getSetting("daysToExpiryWarning", "30"))}
            onChange={(v) => updateSetting("daysToExpiryWarning", String(v))}
            min={1}
            max={365}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الأسعار والتكلفة" icon={Package}>
        <div className="space-y-4">
          <NumberField
            label="سعر الشراء الافتراضي"
            value={Number(getSetting("defaultPurchasePrice", "0"))}
            onChange={(v) => updateSetting("defaultPurchasePrice", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <NumberField
            label="سعر البيع الافتراضي"
            value={Number(getSetting("defaultSellingPrice", "0"))}
            onChange={(v) => updateSetting("defaultSellingPrice", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <SelectField
            label="طريقة حساب التكلفة"
            value={getSetting("costingMethod", "average")}
            onChange={(v) => updateSetting("costingMethod", v)}
            options={INVENTORY_COSTING_METHOD_OPTIONS}
            disabled={!canWrite}
          />
          <ToggleField
            label="مجموعات الأسعار"
            checked={getSetting("enablePriceGroups", "false") === "true"}
            onChange={(v) => updateSetting("enablePriceGroups", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="سعر الجملة"
            checked={getSetting("enableWholesalePrice", "true") === "true"}
            onChange={(v) => updateSetting("enableWholesalePrice", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="حدود المخزون" icon={Package}>
        <div className="space-y-4">
          <NumberField
            label="الحد الأدنى للمخزون"
            value={Number(getSetting("defaultMinStock", "0"))}
            onChange={(v) => updateSetting("defaultMinStock", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <NumberField
            label="الحد الأقصى للمخزون"
            value={Number(getSetting("defaultMaxStock", "0"))}
            onChange={(v) => updateSetting("defaultMaxStock", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <NumberField
            label="نقطة إعادة الطلب"
            value={Number(getSetting("defaultReorderPoint", "0"))}
            onChange={(v) => updateSetting("defaultReorderPoint", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="السماح بالمخزون السالب"
            checked={getSetting("allowNegativeStock", "false") === "true"}
            onChange={(v) => updateSetting("allowNegativeStock", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الباركود والتسميات" icon={Package}>
        <div className="space-y-4">
          <ToggleField
            label="توليد باركود تلقائي"
            checked={getSetting("autoGenerateBarcode", "false") === "true"}
            onChange={(v) => updateSetting("autoGenerateBarcode", String(v))}
            disabled={!canWrite}
          />
          <TextField
            label="بادئة الباركود"
            value={getSetting("barcodePrefix", "")}
            onChange={(v) => updateSetting("barcodePrefix", v)}
            disabled={!canWrite}
            placeholder="PH-"
          />
          <SelectField
            label="نظام الترميز"
            value={getSetting("barcodeSymbology", "Code-128")}
            onChange={(v) => updateSetting("barcodeSymbology", v)}
            options={symbologyOptions}
            disabled={!canWrite}
          />
          <SelectField
            label="تنسيق اسم الصنف"
            value={getSetting("itemNameFormat", "arabic")}
            onChange={(v) => updateSetting("itemNameFormat", v)}
            options={nameFormatOptions}
            disabled={!canWrite}
          />
          <ToggleField
            label="إظهار تاريخ الصلاحية في المبيعات"
            checked={getSetting("showExpiryInSales", "true") === "true"}
            onChange={(v) => updateSetting("showExpiryInSales", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function ItemsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="items">
        <ItemsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
