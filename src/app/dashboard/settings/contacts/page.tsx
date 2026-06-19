"use client"

import { ContactRound } from "lucide-react"
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
import { PAYMENT_TERM_OPTIONS } from "@/features/settings/constants"

const defaultSettings = {
  defaultCustomerGroup: "",
  defaultSupplierGroup: "",
  defaultPaymentTerm: "cash",
  enableCustomerCreditLimit: "false",
  defaultCreditLimit: "0",
  enableCustomerLoyalty: "true",
  customerDisplayName: "name",
  requirePhoneForCustomers: "false",
  requirePhoneForSuppliers: "false",
  enableCustomerPriceGroup: "false",
  autoCreateCustomer: "false",
  defaultCustomerId: "",
  enableCustomerDiscount: "false",
  defaultCustomerDiscount: "0",
}

const displayNameOptions = [
  { value: "name", label: "الاسم" },
  { value: "company", label: "الشركة" },
  { value: "both", label: "الاسم والشركة" },
]

function ContactsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات جهات الاتصال"
        description="تخصيص إعدادات العملاء والموردين"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الإعدادات الافتراضية" icon={ContactRound}>
        <div className="space-y-4">
          <TextField
            label="مجموعة العملاء الافتراضية"
            value={getSetting("defaultCustomerGroup", "")}
            onChange={(v) => updateSetting("defaultCustomerGroup", v)}
            disabled={!canWrite}
          />
          <TextField
            label="مجموعة الموردين الافتراضية"
            value={getSetting("defaultSupplierGroup", "")}
            onChange={(v) => updateSetting("defaultSupplierGroup", v)}
            disabled={!canWrite}
          />
          <SelectField
            label="شروط الدفع الافتراضية"
            value={getSetting("defaultPaymentTerm", "cash")}
            onChange={(v) => updateSetting("defaultPaymentTerm", v)}
            options={PAYMENT_TERM_OPTIONS}
            disabled={!canWrite}
          />
          <SelectField
            label="عرض اسم العميل كـ"
            value={getSetting("customerDisplayName", "name")}
            onChange={(v) => updateSetting("customerDisplayName", v)}
            options={displayNameOptions}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="حدود الائتمان والخصم" icon={ContactRound}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل حد الائتمان للعملاء"
            checked={getSetting("enableCustomerCreditLimit", "false") === "true"}
            onChange={(v) => updateSetting("enableCustomerCreditLimit", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="حد الائتمان الافتراضي"
            value={Number(getSetting("defaultCreditLimit", "0"))}
            onChange={(v) => updateSetting("defaultCreditLimit", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل الخصم للعملاء"
            checked={getSetting("enableCustomerDiscount", "false") === "true"}
            onChange={(v) => updateSetting("enableCustomerDiscount", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نسبة الخصم الافتراضية (%)"
            value={Number(getSetting("defaultCustomerDiscount", "0"))}
            onChange={(v) => updateSetting("defaultCustomerDiscount", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="خيارات متقدمة" icon={ContactRound}>
        <div className="space-y-4">
          <ToggleField
            label="نظام المكافآت للعملاء"
            checked={getSetting("enableCustomerLoyalty", "true") === "true"}
            onChange={(v) => updateSetting("enableCustomerLoyalty", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="مجموعة أسعار خاصة بالعميل"
            checked={getSetting("enableCustomerPriceGroup", "false") === "true"}
            onChange={(v) => updateSetting("enableCustomerPriceGroup", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إنشاء عميل تلقائي عند البيع"
            checked={getSetting("autoCreateCustomer", "false") === "true"}
            onChange={(v) => updateSetting("autoCreateCustomer", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إلزامية رقم الهاتف للعملاء"
            checked={getSetting("requirePhoneForCustomers", "false") === "true"}
            onChange={(v) => updateSetting("requirePhoneForCustomers", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إلزامية رقم الهاتف للموردين"
            checked={getSetting("requirePhoneForSuppliers", "false") === "true"}
            onChange={(v) => updateSetting("requirePhoneForSuppliers", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function ContactsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="contacts">
        <ContactsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
