"use client"

import { ShoppingCart } from "lucide-react"
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
import { SALE_ITEM_BEHAVIOR_OPTIONS } from "@/features/settings/constants"

const defaultSettings = {
  invoicePrefix: "INV-",
  invoiceSuffix: "",
  nextInvoiceNumber: "1",
  receiptFooter: "شكراً لتعاملكم معنا",
  receiptHeader: "",
  saleItemBehavior: "increase",
  defaultDiscountPercent: "0",
  maxDiscountPercent: "100",
  enableDiscount: "true",
  enableReturn: "true",
  returnWindowDays: "30",
  requireReturnReason: "true",
  enableSalesRep: "false",
  salesRepCommissionBase: "invoice",
  salesRepCommissionRate: "0",
  enablePriceOverride: "true",
  requirePriceOverrideReason: "false",
  defaultSaleStatus: "invoice",
  enableDraftInvoices: "true",
  enablePriceOffers: "true",
  priceOfferValidDays: "7",
  enableShipping: "false",
  defaultShippingCost: "0",
  enableFreeReturns: "false",
}

const commissionBaseOptions = [
  { value: "invoice", label: "إجمالي الفاتورة" },
  { value: "profit", label: "الربح" },
  { value: "item", label: "المنتج" },
]

const saleStatusOptions = [
  { value: "invoice", label: "فاتورة" },
  { value: "draft", label: "مسودة" },
  { value: "quote", label: "عرض سعر" },
]

function SalesSettingsForm() {
  const { getSetting, updateSetting, saveSettings, resetSettings, saving, canWrite, dirty } = useSettingsPage()

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="إعدادات المبيعات"
        description="تخصيص إعدادات الفواتير والمبيعات"
        onSave={saveSettings}
        onReset={resetSettings}
        saving={saving}
        canWrite={canWrite}
      />

      <SettingsSectionCard title="الترقيم والفواتير" icon={ShoppingCart}>
        <div className="space-y-4">
          <TextField
            label="بادئة الفاتورة"
            value={getSetting("invoicePrefix", "INV-")}
            onChange={(v) => updateSetting("invoicePrefix", v)}
            disabled={!canWrite}
          />
          <TextField
            label="لاحقة الفاتورة"
            value={getSetting("invoiceSuffix", "")}
            onChange={(v) => updateSetting("invoiceSuffix", v)}
            disabled={!canWrite}
          />
          <NumberField
            label="رقم الفاتورة التالي"
            value={Number(getSetting("nextInvoiceNumber", "1"))}
            onChange={(v) => updateSetting("nextInvoiceNumber", String(v))}
            min={1}
            disabled={!canWrite}
          />
          <TextField
            label="تذييل الفاتورة"
            value={getSetting("receiptFooter", "شكراً لتعاملكم معنا")}
            onChange={(v) => updateSetting("receiptFooter", v)}
            disabled={!canWrite}
          />
          <TextField
            label="ترويسة الفاتورة"
            value={getSetting("receiptHeader", "")}
            onChange={(v) => updateSetting("receiptHeader", v)}
            disabled={!canWrite}
          />
          <SelectField
            label="الحالة الافتراضية للفاتورة"
            value={getSetting("defaultSaleStatus", "invoice")}
            onChange={(v) => updateSetting("defaultSaleStatus", v)}
            options={saleStatusOptions}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="الخصم والإرجاع" icon={ShoppingCart}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل الخصم"
            checked={getSetting("enableDiscount", "true") === "true"}
            onChange={(v) => updateSetting("enableDiscount", String(v))}
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
          <NumberField
            label="الحد الأقصى للخصم (%)"
            value={Number(getSetting("maxDiscountPercent", "100"))}
            onChange={(v) => updateSetting("maxDiscountPercent", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل الإرجاع"
            checked={getSetting("enableReturn", "true") === "true"}
            onChange={(v) => updateSetting("enableReturn", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="عدد أيام الإرجاع المسموح بها"
            value={Number(getSetting("returnWindowDays", "30"))}
            onChange={(v) => updateSetting("returnWindowDays", String(v))}
            min={0}
            max={365}
            disabled={!canWrite}
          />
          <ToggleField
            label="إلزامية سبب الإرجاع"
            checked={getSetting("requireReturnReason", "true") === "true"}
            onChange={(v) => updateSetting("requireReturnReason", String(v))}
            disabled={!canWrite}
          />
          <SelectField
            label="سلوك إضافة الصنف"
            value={getSetting("saleItemBehavior", "increase")}
            onChange={(v) => updateSetting("saleItemBehavior", v)}
            options={SALE_ITEM_BEHAVIOR_OPTIONS}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="مندوبي المبيعات" icon={ShoppingCart}>
        <div className="space-y-4">
          <ToggleField
            label="تفعيل مندوبي المبيعات"
            checked={getSetting("enableSalesRep", "false") === "true"}
            onChange={(v) => updateSetting("enableSalesRep", String(v))}
            disabled={!canWrite}
          />
          <SelectField
            label="أساس عمولة مندوب المبيعات"
            value={getSetting("salesRepCommissionBase", "invoice")}
            onChange={(v) => updateSetting("salesRepCommissionBase", v)}
            options={commissionBaseOptions}
            disabled={!canWrite}
          />
          <NumberField
            label="نسبة العمولة (%)"
            value={Number(getSetting("salesRepCommissionRate", "0"))}
            onChange={(v) => updateSetting("salesRepCommissionRate", String(v))}
            min={0}
            max={100}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="خيارات متقدمة" icon={ShoppingCart}>
        <div className="space-y-4">
          <ToggleField
            label="تعديل السعر يدوياً"
            checked={getSetting("enablePriceOverride", "true") === "true"}
            onChange={(v) => updateSetting("enablePriceOverride", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="إلزامية سبب تعديل السعر"
            checked={getSetting("requirePriceOverrideReason", "false") === "true"}
            onChange={(v) => updateSetting("requirePriceOverrideReason", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="الفواتير المسودة"
            checked={getSetting("enableDraftInvoices", "true") === "true"}
            onChange={(v) => updateSetting("enableDraftInvoices", String(v))}
            disabled={!canWrite}
          />
          <ToggleField
            label="عروض الأسعار"
            checked={getSetting("enablePriceOffers", "true") === "true"}
            onChange={(v) => updateSetting("enablePriceOffers", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="صلاحية عرض السعر (أيام)"
            value={Number(getSetting("priceOfferValidDays", "7"))}
            onChange={(v) => updateSetting("priceOfferValidDays", String(v))}
            min={1}
            max={365}
            disabled={!canWrite}
          />
          <ToggleField
            label="تفعيل الشحن"
            checked={getSetting("enableShipping", "false") === "true"}
            onChange={(v) => updateSetting("enableShipping", String(v))}
            disabled={!canWrite}
          />
          <NumberField
            label="تكلفة الشحن الافتراضية"
            value={Number(getSetting("defaultShippingCost", "0"))}
            onChange={(v) => updateSetting("defaultShippingCost", String(v))}
            min={0}
            disabled={!canWrite}
          />
        </div>
      </SettingsSectionCard>
    </div>
  )
}

export default function SalesSettingsPage() {
  return (
    <SettingsLayout>
      <SettingsPageProvider defaultSettings={defaultSettings} namespace="sales">
        <SalesSettingsForm />
      </SettingsPageProvider>
    </SettingsLayout>
  )
}
