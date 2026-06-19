"use client"

import { Gift } from "lucide-react"
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
  enableRewards: "false",
  pointsPerAmount: "100",
  pointsCurrency: "EGP",
  pointsPerPurchase: "1",
  redeemRate: "1",
  minRedeemPoints: "100",
  maxRedeemPercent: "50",
  expiryDays: "365",
  enableBirthdayReward: "true",
  birthdayRewardPoints: "100",
  enableSignupReward: "true",
  signupRewardPoints: "50",
}

function RewardsSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات المكافآت"
        description="تخصيص نظام نقاط المكافآت للعملاء"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الإعدادات العامة" icon={Gift}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل نظام المكافآت"
            checked={getSetting("enableRewards", "false") === "true"}
            onChange={(v) => updateSetting("enableRewards", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="المبلغ المطلوب لنقطة واحدة"
            value={Number(getSetting("pointsPerAmount", "100"))}
            onChange={(v) => updateSetting("pointsPerAmount", String(v))}
            min={1}
            disabled={!canWrite}
          />
          <TextField
            label="عملة النقاط"
            value={getSetting("pointsCurrency", "EGP")}
            onChange={(v) => updateSetting("pointsCurrency", v)}
            disabled={!canWrite}
            placeholder="EGP"
          />
          <NumberField
            label="النقاط لكل عملية شراء"
            value={Number(getSetting("pointsPerPurchase", "1"))}
            onChange={(v) => updateSetting("pointsPerPurchase", String(v))}
            min={1}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الاستبدال" icon={Gift}>
        <div className="space-y-4">
          <NumberField
            label="سعر الاستبدال (نقطة = عملة)"
            value={Number(getSetting("redeemRate", "1"))}
            onChange={(v) => updateSetting("redeemRate", String(v))}
            min={0.01}
            step={0.01}
            disabled={!canWrite}
          />
          <NumberField
            label="الحد الأدنى للنقاط للاستبدال"
            value={Number(getSetting("minRedeemPoints", "100"))}
            onChange={(v) => updateSetting("minRedeemPoints", String(v))}
            min={1}
            disabled={!canWrite}
          />
          <NumberField
            label="الحد الأقصى للاستبدال (%)"
            value={Number(getSetting("maxRedeemPercent", "50"))}
            onChange={(v) => updateSetting("maxRedeemPercent", String(v))}
            min={1}
            max={100}
            disabled={!canWrite}
          />
          <NumberField
            label="صلاحية النقاط (أيام)"
            value={Number(getSetting("expiryDays", "365"))}
            onChange={(v) => updateSetting("expiryDays", String(v))}
            min={1}
            max={3650}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="المكافآت الخاصة" icon={Gift}>
        <div className="space-y-4">
          <ToggleField
            label="مكافأة عيد الميلاد"
            checked={getSetting("enableBirthdayReward", "true") === "true"}
            onChange={(v) => updateSetting("enableBirthdayReward", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نقاط مكافأة عيد الميلاد"
            value={Number(getSetting("birthdayRewardPoints", "100"))}
            onChange={(v) => updateSetting("birthdayRewardPoints", String(v))}
            min={0}
            disabled={!canWrite}
          />
          <ToggleField
            label="مكافأة التسجيل"
            checked={getSetting("enableSignupReward", "true") === "true"}
            onChange={(v) => updateSetting("enableSignupReward", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="نقاط مكافأة التسجيل"
            value={Number(getSetting("signupRewardPoints", "50"))}
            onChange={(v) => updateSetting("signupRewardPoints", String(v))}
            min={0}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function RewardsSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="rewards">
        <RewardsSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
