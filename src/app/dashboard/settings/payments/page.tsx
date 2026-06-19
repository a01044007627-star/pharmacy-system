"use client"

import { Wallet } from "lucide-react"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/components/settings-page-provider"
import {
  SettingsSectionCard,
  SelectField,
  NumberField,
  ToggleField,
  SettingsPageHeader,
} from "@/features/settings/components/settings-form"
import { PAYMENT_TERM_OPTIONS } from "@/features/settings/constants"

const defaultSettings = {
  defaultPaymentMethod: "cash",
  acceptedPaymentMethods: "cash,card",
  enableCardPayment: "true",
  cardFeePercent: "0",
  enableWalletPayment: "true",
  enableBankTransfer: "true",
  enablePartialPayment: "true",
  enableChangeCalculation: "true",
  paymentRounding: "0.05",
  defaultPaymentTerm: "cash",
  enableDeposit: "false",
  depositPercent: "0",
}

const paymentMethodOptions = [
  { value: "cash", label: "نقداً" },
  { value: "card", label: "بطاقة" },
  { value: "wallet", label: "محفظة" },
  { value: "bank", label: "تحويل بنكي" },
]

function PaymentsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات المدفوعات"
        description="تخصيص طرق وخيارات الدفع"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="طرق الدفع" icon={Wallet}>
        <div className="space-y-4">
          <SelectField
            label="طريقة الدفع الافتراضية"
            value={getSetting("defaultPaymentMethod", "cash")}
            onChange={(v) => updateSetting("defaultPaymentMethod", v)}
            options={paymentMethodOptions}
            disabled={!canWrite}
          />
          <SelectField
            label="شروط الدفع الافتراضية"
            value={getSetting("defaultPaymentTerm", "cash")}
            onChange={(v) => updateSetting("defaultPaymentTerm", v)}
            options={PAYMENT_TERM_OPTIONS}
            disabled={!canWrite}
          />
          <ToggleField
            label="الدفع بالبطاقة"
            checked={getSetting("enableCardPayment", "true") === "true"}
            onChange={(v) => updateSetting("enableCardPayment", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نسبة رسوم البطاقة (%)"
            value={Number(getSetting("cardFeePercent", "0"))}
            onChange={(v) => updateSetting("cardFeePercent", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
          <ToggleField
            label="المحفظة الإلكترونية"
            checked={getSetting("enableWalletPayment", "true") === "true"}
            onChange={(v) => updateSetting("enableWalletPayment", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="التحويل البنكي"
            checked={getSetting("enableBankTransfer", "true") === "true"}
            onChange={(v) => updateSetting("enableBankTransfer", String(v))}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="خيارات الدفع" icon={Wallet}>
        <div className="space-y-4">
          <ToggleField
            label="الدفع الجزئي"
            checked={getSetting("enablePartialPayment", "true") === "true"}
            onChange={(v) => updateSetting("enablePartialPayment", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="حساب الباقي تلقائياً"
            checked={getSetting("enableChangeCalculation", "true") === "true"}
            onChange={(v) => updateSetting("enableChangeCalculation", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="تقريب المدفوعات"
            value={Number(getSetting("paymentRounding", "0.05"))}
            onChange={(v) => updateSetting("paymentRounding", String(v))}
            min={0}
            step={0.01}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل الدفعة المقدمة"
            checked={getSetting("enableDeposit", "false") === "true"}
            onChange={(v) => updateSetting("enableDeposit", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نسبة الدفعة المقدمة (%)"
            value={Number(getSetting("depositPercent", "0"))}
            onChange={(v) => updateSetting("depositPercent", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function PaymentsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="payments">
        <PaymentsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
