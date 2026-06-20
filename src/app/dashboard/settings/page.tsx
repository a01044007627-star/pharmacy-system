"use client"

import { Building, Globe, Share2, FileText, MapPin, Bell, Trash2 } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  CURRENCY_SYMBOL_PLACEMENT_OPTIONS,
  LANGUAGE_OPTIONS,
  TIME_FORMAT_OPTIONS,
} from "@/features/settings/constants"

const defaultSettings = {
  name: "",
  legalName: "",
  ownerName: "",
  ownerTitle: "صيدلي",
  address: "",
  phone: "",
  mobile: "",
  email: "",
  website: "",
  taxId: "",
  commercialRegister: "",
  healthLicense: "",
  country: "مصر",
  city: "",
  district: "",
  building: "",
  floor: "",
  landmark: "",
  currency: "EGP",
  currencySymbol: "ج.م",
  currencySymbolPlacement: "before",
  timezone: "Africa/Cairo",
  language: "ar",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24",
  facebook: "",
  twitter: "",
  instagram: "",
  whatsapp: "",
  notes: "",
  decimalPlaces: "2",
  roundingMode: "half-up",
  notifSound: "true",
  notifAutoread: "true",
}

const currencyOptions = [
  { value: "EGP", label: "جنيه مصري (EGP)" },
  { value: "SAR", label: "ريال سعودي (SAR)" },
  { value: "AED", label: "درهم إماراتي (AED)" },
  { value: "QAR", label: "ريال قطري (QAR)" },
  { value: "KWD", label: "دينار كويتي (KWD)" },
]

const timezoneOptions = [
  { value: "Africa/Cairo", label: "القاهرة (UTC+2)" },
  { value: "Asia/Riyadh", label: "الرياض (UTC+3)" },
  { value: "Asia/Dubai", label: "دبي (UTC+4)" },
  { value: "Asia/Kuwait", label: "الكويت (UTC+3)" },
]

const roundingOptions = [
  { value: "half-up", label: "تقريب لأعلى" },
  { value: "half-down", label: "تقريب لأسفل" },
  { value: "ceil", label: "تقريب لأعلى دائمًا" },
  { value: "floor", label: "تقريب لأسفل دائمًا" },
]

const dateFormatOptions = [
  { value: "YYYY-MM-DD", label: "2024-01-15" },
  { value: "DD/MM/YYYY", label: "15/01/2024" },
  { value: "MM/DD/YYYY", label: "01/15/2024" },
  { value: "DD-MM-YYYY", label: "15-01-2024" },
]

function ProjectSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="بيانات الصيدلية"
        description="إدارة المعلومات الأساسية للصيدلية"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="معلومات الصيدلية" icon={Building}>
        <div className="space-y-4">
          <TextField label="اسم الصيدلية" value={getSetting("name")} onChange={(v) => updateSetting("name", v)} disabled={!canWrite} />
          <TextField label="الاسم القانوني" value={getSetting("legalName")} onChange={(v) => updateSetting("legalName", v)} disabled={!canWrite} />
          <TextField label="المالك" value={getSetting("ownerName")} onChange={(v) => updateSetting("ownerName", v)} disabled={!canWrite} />
          <TextField label="صفة المالك" value={getSetting("ownerTitle", "صيدلي")} onChange={(v) => updateSetting("ownerTitle", v)} disabled={!canWrite} />
          <TextField label="رقم الهاتف" value={getSetting("phone")} onChange={(v) => updateSetting("phone", v)} disabled={!canWrite} placeholder="+20 1X XXX XXXX" />
          <TextField label="رقم الجوال" value={getSetting("mobile")} onChange={(v) => updateSetting("mobile", v)} disabled={!canWrite} />
          <TextField label="البريد الإلكتروني" value={getSetting("email")} onChange={(v) => updateSetting("email", v)} disabled={!canWrite} type="email" />
          <TextField label="الموقع الإلكتروني" value={getSetting("website")} onChange={(v) => updateSetting("website", v)} disabled={!canWrite} placeholder="https://" />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="المستندات الرسمية" icon={FileText}>
        <div className="space-y-4">
          <TextField label="الرقم الضريبي" value={getSetting("taxId")} onChange={(v) => updateSetting("taxId", v)} disabled={!canWrite} />
          <TextField label="السجل التجاري" value={getSetting("commercialRegister")} onChange={(v) => updateSetting("commercialRegister", v)} disabled={!canWrite} />
          <TextField label="ترخيص وزارة الصحة" value={getSetting("healthLicense")} onChange={(v) => updateSetting("healthLicense", v)} disabled={!canWrite} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الموقع" icon={MapPin}>
        <div className="space-y-4">
          <TextField label="الدولة" value={getSetting("country", "مصر")} onChange={(v) => updateSetting("country", v)} disabled={!canWrite} />
          <TextField label="المدينة" value={getSetting("city")} onChange={(v) => updateSetting("city", v)} disabled={!canWrite} />
          <TextField label="الحي" value={getSetting("district")} onChange={(v) => updateSetting("district", v)} disabled={!canWrite} />
          <TextField label="المبنى" value={getSetting("building")} onChange={(v) => updateSetting("building", v)} disabled={!canWrite} />
          <TextField label="الطابق" value={getSetting("floor")} onChange={(v) => updateSetting("floor", v)} disabled={!canWrite} />
          <TextField label="أقرب معلم" value={getSetting("landmark")} onChange={(v) => updateSetting("landmark", v)} disabled={!canWrite} />
          <TextField label="العنوان بالكامل" value={getSetting("address")} onChange={(v) => updateSetting("address", v)} disabled={!canWrite} />
          <TextField label="ملاحظات" value={getSetting("notes")} onChange={(v) => updateSetting("notes", v)} disabled={!canWrite} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="التواصل الاجتماعي" icon={Share2}>
        <div className="space-y-4">
          <TextField label="فيسبوك" value={getSetting("facebook")} onChange={(v) => updateSetting("facebook", v)} disabled={!canWrite} placeholder="https://facebook.com/..." />
          <TextField label="تويتر" value={getSetting("twitter")} onChange={(v) => updateSetting("twitter", v)} disabled={!canWrite} placeholder="https://twitter.com/..." />
          <TextField label="انستغرام" value={getSetting("instagram")} onChange={(v) => updateSetting("instagram", v)} disabled={!canWrite} placeholder="https://instagram.com/..." />
          <TextField label="واتساب" value={getSetting("whatsapp")} onChange={(v) => updateSetting("whatsapp", v)} disabled={!canWrite} placeholder="https://wa.me/..." />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الإعدادات الإقليمية" icon={Globe}>
        <div className="space-y-4">
          <SelectField label="العملة" value={getSetting("currency", "EGP")} onChange={(v) => updateSetting("currency", v)} options={currencyOptions} disabled={!canWrite} />
          <TextField label="رمز العملة" value={getSetting("currencySymbol", "ج.م")} onChange={(v) => updateSetting("currencySymbol", v)} disabled={!canWrite} />
          <SelectField label="موضع رمز العملة" value={getSetting("currencySymbolPlacement", "before")} onChange={(v) => updateSetting("currencySymbolPlacement", v)} options={CURRENCY_SYMBOL_PLACEMENT_OPTIONS} disabled={!canWrite} />
          <SelectField label="المنطقة الزمنية" value={getSetting("timezone", "Africa/Cairo")} onChange={(v) => updateSetting("timezone", v)} options={timezoneOptions} disabled={!canWrite} />
          <SelectField label="اللغة" value={getSetting("language", "ar")} onChange={(v) => updateSetting("language", v)} options={LANGUAGE_OPTIONS} disabled={!canWrite} />
          <SelectField label="تنسيق التاريخ" value={getSetting("dateFormat", "YYYY-MM-DD")} onChange={(v) => updateSetting("dateFormat", v)} options={dateFormatOptions} disabled={!canWrite} />
          <SelectField label="تنسيق الوقت" value={getSetting("timeFormat", "24")} onChange={(v) => updateSetting("timeFormat", v)} options={TIME_FORMAT_OPTIONS} disabled={!canWrite} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الخيارات الرقمية" icon={Building}>
        <div className="space-y-4">
          <NumberField label="عدد الخانات العشرية" value={Number(getSetting("decimalPlaces", "2"))} onChange={(v) => updateSetting("decimalPlaces", String(v))} min={0} max={6} disabled={!canWrite} />
          <SelectField label="طريقة التقريب" value={getSetting("roundingMode", "half-up")} onChange={(v) => updateSetting("roundingMode", v)} options={roundingOptions} disabled={!canWrite} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="إعدادات الإشعارات" icon={Bell}>
        <div className="space-y-3">
          <ToggleField label="صوت الإشعارات" description="تشغيل صوت عند استلام إشعار جديد" checked={getSetting("notifSound", "true") === "true"} onChange={(v) => updateSetting("notifSound", String(v))} disabled={!canWrite} />
          <ToggleField label="القراءة التلقائية" description="تحديد الإشعارات كمقروءة تلقائيًا عند فتحها" checked={getSetting("notifAutoread", "true") === "true"} onChange={(v) => updateSetting("notifAutoread", String(v))} disabled={!canWrite} />
          <Separator />
          <Button variant="outline" size="sm" disabled={!canWrite} className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="size-4" />
            مسح جميع الإشعارات
          </Button>
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="project">
        <ProjectSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
