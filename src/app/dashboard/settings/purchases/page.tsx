"use client"

import { Truck } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  TextField,
  NumberField,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"

const defaultSettings = {
  orderPrefix: "PO-",
  nextOrderNumber: "1",
  enablePurchaseApproval: "false",
  requireApprovalAbove: "10000",
  defaultOrderStatus: "pending",
  enablePartialReceiving: "true",
  enablePurchaseReturn: "true",
  returnWindowDays: "14",
  enableShippingCost: "true",
  defaultShippingCost: "0",
  enablePurchaseDiscount: "true",
  defaultDiscountPercent: "0",
  autoCreateStockOnReceive: "true",
  enableBatchTracking: "false",
  enableExpiryTracking: "true",
}

function PurchasesSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات المشتريات"
        description="تخصيص إعدادات أوامر الشراء والمشتريات"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الترقيم والأوامر" icon={Truck}>
        <div className="space-y-4">
          <TextField
            label="بادئة أمر الشراء"
            value={getSetting("orderPrefix", "PO-")}
            onChange={(v) => updateSetting("orderPrefix", v)}
            disabled={!canWrite}
          />
          <NumberField
            label="رقم أمر الشراء التالي"
            value={Number(getSetting("nextOrderNumber", "1"))}
            onChange={(v) => updateSetting("nextOrderNumber", String(v))}
            min={1}
            disabled={!canWrite}
          />
          <TextField
            label="الحالة الافتراضية لأمر الشراء"
            value={getSetting("defaultOrderStatus", "pending")}
            onChange={(v) => updateSetting("defaultOrderStatus", v)}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الموافقات والاستلام" icon={Truck}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل اعتماد المشتريات"
            checked={getSetting("enablePurchaseApproval", "false") === "true"}
            onChange={(v) => updateSetting("enablePurchaseApproval", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="الموافقة مطلوبة للمبالغ فوق"
            value={Number(getSetting("requireApprovalAbove", "10000"))}
            onChange={(v) => updateSetting("requireApprovalAbove", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="الاستلام الجزئي"
            checked={getSetting("enablePartialReceiving", "true") === "true"}
            onChange={(v) => updateSetting("enablePartialReceiving", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إنشاء المخزون تلقائي عند الاستلام"
            checked={getSetting("autoCreateStockOnReceive", "true") === "true"}
            onChange={(v) => updateSetting("autoCreateStockOnReceive", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإرجاع والشحن" icon={Truck}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل إرجاع المشتريات"
            checked={getSetting("enablePurchaseReturn", "true") === "true"}
            onChange={(v) => updateSetting("enablePurchaseReturn", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="عدد أيام الإرجاع المسموح بها"
            value={Number(getSetting("returnWindowDays", "14"))}
            onChange={(v) => updateSetting("returnWindowDays", String(v))}
            min={0}
            max={365}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل تكلفة الشحن"
            checked={getSetting("enableShippingCost", "true") === "true"}
            onChange={(v) => updateSetting("enableShippingCost", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="تكلفة الشحن الافتراضية"
            value={Number(getSetting("defaultShippingCost", "0"))}
            onChange={(v) => updateSetting("defaultShippingCost", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل الخصم في المشتريات"
            checked={getSetting("enablePurchaseDiscount", "true") === "true"}
            onChange={(v) => updateSetting("enablePurchaseDiscount", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نسبة الخصم الافتراضية (%)"
            value={Number(getSetting("defaultDiscountPercent", "0"))}
            onChange={(v) => updateSetting("defaultDiscountPercent", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="التتبع" icon={Truck}>
        <div className="space-y-4">
          <ToggleField
            label="تتبع الباتش في المشتريات"
            checked={getSetting("enableBatchTracking", "false") === "true"}
            onChange={(v) => updateSetting("enableBatchTracking", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="تتبع تواريخ انتهاء الصلاحية في المشتريات"
            checked={getSetting("enableExpiryTracking", "true") === "true"}
            onChange={(v) => updateSetting("enableExpiryTracking", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function PurchasesSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="purchases">
        <PurchasesSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
