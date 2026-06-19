"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ImageUp,
  Loader2,
  Package,
  Plus,
  Save,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PageAccess } from "@/components/auth/page-access";
import { DashboardPageHeader } from "@/components/shared/page-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/shared/form-base";
import { AddItemSection, AccountingMetric, InventoryToggle } from "@/components/shared/form-sections";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { useUploadThing } from "@/lib/uploadthing/client";
import { ITEM_TYPES } from "@/features/inventory/constants";
import type {
  BranchOption,
  LookupOption,
} from "@/features/inventory/lib/items-types";

type UploadResult = {
  serverData?: { url?: string | null };
  ufsUrl?: string | null;
  url?: string | null;
};

type FormData = {
  name_ar: string;
  name_en: string;
  sku: string;
  barcodes: string;
  group_id: string;
  brand_id: string;
  unit: string;
  main_unit: string;
  sub_unit: string;
  qty_per_main_unit: string;
  unit_raw: string;
  category: string;
  sub_category: string;
  item_type: string;
  product_type: string;
  manufacturer_name: string;
  buy_price: string;
  purchase_price_including_tax: string;
  purchase_price_excluding_tax: string;
  profit_margin: string;
  sell_price: string;
  old_sell_price: string;
  manage_inventory: boolean;
  not_for_sale: boolean;
  min_stock: string;
  max_stock: string;
  opening_stock: string;
  opening_stock_location: string;
  has_expiry: boolean;
  expiry_date: string;
  expiry_period_value: string;
  expiry_period_unit: string;
  track_batch: boolean;
  is_controlled: boolean;
  requires_prescription: boolean;
  serial_tracking_enabled: boolean;
  barcode_type: string;
  tax_name: string;
  tax_percent: string;
  selling_price_tax_type: string;
  variation_name: string;
  variation_values: string;
  variation_skus: string;
  weight: string;
  rack: string;
  shelf_row: string;
  position: string;
  product_locations: string;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  custom_field_4: string;
  product_description: string;
  notes: string;
  image_url: string;
  branch_id: string;
};

const defaults: FormData = {
  name_ar: "",
  name_en: "",
  sku: "",
  barcodes: "",
  group_id: "",
  brand_id: "",
  unit: "وحدة",
  main_unit: "",
  sub_unit: "وحدة",
  qty_per_main_unit: "1",
  unit_raw: "وحدة",
  category: "",
  sub_category: "",
  item_type: "stocked",
  product_type: "single",
  manufacturer_name: "",
  buy_price: "0",
  purchase_price_including_tax: "0",
  purchase_price_excluding_tax: "0",
  profit_margin: "0",
  sell_price: "0",
  old_sell_price: "0",
  manage_inventory: true,
  not_for_sale: false,
  min_stock: "0",
  max_stock: "0",
  opening_stock: "0",
  opening_stock_location: "",
  has_expiry: false,
  expiry_date: "",
  expiry_period_value: "0",
  expiry_period_unit: "months",
  track_batch: false,
  is_controlled: false,
  requires_prescription: false,
  serial_tracking_enabled: false,
  barcode_type: "C128",
  tax_name: "",
  tax_percent: "0",
  selling_price_tax_type: "exclusive",
  variation_name: "",
  variation_values: "",
  variation_skus: "",
  weight: "0",
  rack: "",
  shelf_row: "",
  position: "",
  product_locations: "",
  custom_field_1: "",
  custom_field_2: "",
  custom_field_3: "",
  custom_field_4: "",
  product_description: "",
  notes: "",
  image_url: "",
  branch_id: "",
};

type ItemApiResponse = {
  item?: Partial<FormData> & Record<string, unknown>;
  barcodes?: Array<{ barcode: string; is_primary?: boolean | null }>;
  variants?: Array<{
    name?: string | null;
    value?: string | null;
    sku?: string | null;
  }>;
  units?: Array<{
    unit_name?: string | null;
    factor?: number | string | null;
    is_base?: boolean | null;
    main_unit?: string | null;
    sub_unit?: string | null;
    qty_per_main_unit?: number | string | null;
    unit_raw?: string | null;
  }>;
  error?: string;
};

function numberString(value: unknown, fallback = "0") {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}

function pipeToArray(value: string) {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function lineToBarcodeRows(value: string) {
  const uniqueBarcodes = Array.from(
    new Set(
      value
        .split(/\n|\|/)
        .map((barcode) => barcode.trim())
        .filter(Boolean),
    ),
  );
  return uniqueBarcodes.map((barcode, index) => ({
    barcode,
    is_primary: index === 0,
  }));
}

function formFromApi(data: ItemApiResponse): FormData {
  const item = data.item ?? {};
  const variants = data.variants ?? [];
  const itemUnits = data.units ?? [];
  const baseUnit =
    itemUnits.find((unit) => unit.is_base) ??
    itemUnits.find((unit) => Number(unit.factor ?? 0) === 1);
  const packUnit = itemUnits.find(
    (unit) => !unit.is_base && Number(unit.factor ?? 0) > 1,
  );
  const mainUnit = String(
    packUnit?.main_unit ?? packUnit?.unit_name ?? item.unit ?? "",
  );
  const subUnit = String(
    baseUnit?.sub_unit ?? baseUnit?.unit_name ?? item.unit ?? "",
  );
  const unitFactor = numberString(
    packUnit?.qty_per_main_unit ?? packUnit?.factor ?? 1,
    "1",
  );
  return {
    ...defaults,
    name_ar: String(item.name_ar ?? ""),
    name_en: String(item.name_en ?? ""),
    sku: String(item.sku ?? ""),
    barcodes: (data.barcodes ?? [])
      .map((barcode) => barcode.barcode)
      .join("\n"),
    group_id: String(item.group_id ?? ""),
    brand_id: String(item.brand_id ?? ""),
    unit: String(item.unit ?? ""),
    main_unit: mainUnit,
    sub_unit: subUnit,
    qty_per_main_unit: unitFactor,
    unit_raw: String(
      baseUnit?.unit_raw ?? packUnit?.unit_raw ?? item.unit ?? "",
    ),
    category: String(item.category ?? ""),
    sub_category: String(item.sub_category ?? ""),
    item_type: String(item.item_type ?? "stocked"),
    product_type: String(item.product_type ?? "single"),
    manufacturer_name: String(item.manufacturer_name ?? ""),
    buy_price: numberString(item.buy_price),
    purchase_price_including_tax: numberString(
      item.purchase_price_including_tax,
    ),
    purchase_price_excluding_tax: numberString(
      item.purchase_price_excluding_tax,
    ),
    profit_margin: numberString(item.profit_margin),
    sell_price: numberString(item.sell_price),
    old_sell_price: numberString(item.old_sell_price),
    manage_inventory: item.manage_inventory !== false,
    not_for_sale: Boolean(item.not_for_sale),
    min_stock: numberString(item.min_stock),
    max_stock: numberString(item.max_stock),
    opening_stock: numberString(item.opening_stock),
    opening_stock_location: String(item.opening_stock_location ?? ""),
    has_expiry: Boolean(item.has_expiry),
    expiry_date: String(item.expiry_date ?? ""),
    expiry_period_value: numberString(item.expiry_period_value),
    expiry_period_unit: String(item.expiry_period_unit ?? "months"),
    track_batch: Boolean(item.track_batch),
    is_controlled: Boolean(item.is_controlled),
    requires_prescription: Boolean(item.requires_prescription),
    serial_tracking_enabled: Boolean(item.serial_tracking_enabled),
    barcode_type: String(item.barcode_type ?? "C128"),
    tax_name: String(item.tax_name ?? ""),
    tax_percent: numberString(item.tax_percent),
    selling_price_tax_type: String(item.selling_price_tax_type ?? "exclusive"),
    variation_name: variants[0]?.name ?? String(item.variation_name ?? ""),
    variation_values: variants.length
      ? variants
          .map((variant) => variant.value)
          .filter(Boolean)
          .join("|")
      : Array.isArray(item.variation_values)
        ? item.variation_values.join("|")
        : "",
    variation_skus: variants.length
      ? variants
          .map((variant) => variant.sku)
          .filter(Boolean)
          .join("|")
      : Array.isArray(item.variation_skus)
        ? item.variation_skus.join("|")
        : "",
    weight: numberString(item.weight),
    rack: String(item.rack ?? ""),
    shelf_row: String(item.shelf_row ?? ""),
    position: String(item.position ?? ""),
    product_locations: Array.isArray(item.product_locations)
      ? item.product_locations.join("|")
      : "",
    custom_field_1: String(item.custom_field_1 ?? ""),
    custom_field_2: String(item.custom_field_2 ?? ""),
    custom_field_3: String(item.custom_field_3 ?? ""),
    custom_field_4: String(item.custom_field_4 ?? ""),
    product_description: String(item.product_description ?? ""),
    notes: String(item.notes ?? ""),
    image_url: String(item.image_url ?? ""),
    branch_id: String(item.branch_id ?? ""),
  };
}

export function ItemCreateView({
  itemId,
  mode = "create",
}: {
  itemId?: string;
  mode?: "create" | "edit";
}) {
  const auth = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<FormData>(defaults);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [groups, setGroups] = useState<LookupOption[]>([]);
  const [brands, setBrands] = useState<LookupOption[]>([]);
  const [units, setUnits] = useState<LookupOption[]>([]);
  const [quickLookup, setQuickLookup] = useState({
    group: "",
    brand: "",
    unit: "",
  });
  const [quickBusy, setQuickBusy] = useState<"group" | "brand" | "unit" | null>(
    null,
  );

  const branches = useMemo(
    () => (auth.branches ?? []) as BranchOption[],
    [auth.branches],
  );

  useEffect(() => {
    if (!auth.activePharmacyId) return;
    async function loadLookups() {
      try {
        const [gRes, bRes, uRes] = await Promise.all([
          fetch("/api/items/groups", { cache: "no-store" }),
          fetch("/api/items/brands", { cache: "no-store" }),
          fetch("/api/items/units", { cache: "no-store" }),
        ]);
        const [gData, bData, uData] = await Promise.all([
          gRes.json(),
          bRes.json(),
          uRes.json(),
        ]);
        if (gRes.ok) setGroups(gData.groups ?? []);
        if (bRes.ok) setBrands(bData.brands ?? []);
        if (uRes.ok)
          setUnits(
            (uData.units ?? []).map((u: { id: string; unit_name: string }) => ({
              id: u.id,
              name: u.unit_name,
            })),
          );
      } catch {
        /* ignore lookup errors */
      }
    }
    void loadLookups();
  }, [auth.activePharmacyId]);

  useEffect(() => {
    if (mode !== "edit" || !itemId) return;
    let cancelled = false;
    async function loadItem() {
      setLoading(true);
      try {
        const response = await fetch(`/api/items/${itemId}`, {
          cache: "no-store",
        });
        const data = (await response
          .json()
          .catch(() => ({}))) as ItemApiResponse;
        if (!response.ok) throw new Error(data.error ?? "فشل تحميل الصنف");
        if (!cancelled) setForm(formFromApi(data));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل تحميل الصنف");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadItem();
    return () => {
      cancelled = true;
    };
  }, [itemId, mode]);

  const set = useCallback((key: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const unitEquation = useMemo(() => {
    const qty = Number(form.qty_per_main_unit) || 1;
    if (form.main_unit.trim() && form.sub_unit.trim() && qty > 1) {
      return `1 ${form.main_unit.trim()} = ${qty.toLocaleString("ar-EG")} ${form.sub_unit.trim()}`;
    }
    return form.unit
      ? `وحدة البيع الحالية: ${form.unit}`
      : "حدد الوحدة ومعادلتها";
  }, [form.main_unit, form.qty_per_main_unit, form.sub_unit, form.unit]);

  const pricingPreview = useMemo(() => {
    const buy =
      Number(
        form.purchase_price_excluding_tax ||
          form.buy_price ||
          form.purchase_price_including_tax,
      ) || 0;
    const sell = Number(form.sell_price) || 0;
    const profit = sell - buy;
    const margin =
      sell > 0 ? (profit / sell) * 100 : Number(form.profit_margin) || 0;
    return { profit, margin };
  }, [
    form.buy_price,
    form.profit_margin,
    form.purchase_price_excluding_tax,
    form.purchase_price_including_tax,
    form.sell_price,
  ]);

  async function createLookup(kind: "group" | "brand" | "unit") {
    const name = quickLookup[kind].trim();
    if (!name) {
      toast.error("اكتب الاسم أولًا");
      return;
    }
    setQuickBusy(kind);
    try {
      const endpoint =
        kind === "group"
          ? "/api/items/groups"
          : kind === "brand"
            ? "/api/items/brands"
            : "/api/items/units";
      const payload = kind === "unit" ? { unit_name: name } : { name };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        group?: LookupOption;
        brand?: LookupOption;
        unit?: { id: string; unit_name?: string; name?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "فشل الإضافة");
      if (kind === "group" && data.group) {
        setGroups((prev) =>
          [...prev, data.group!].sort((a, b) =>
            a.name.localeCompare(b.name, "ar"),
          ),
        );
        set("group_id", data.group.id);
      } else if (kind === "brand" && data.brand) {
        setBrands((prev) =>
          [...prev, data.brand!].sort((a, b) =>
            a.name.localeCompare(b.name, "ar"),
          ),
        );
        set("brand_id", data.brand.id);
      } else if (kind === "unit" && data.unit) {
        const unit = {
          id: data.unit.id,
          name: data.unit.unit_name ?? data.unit.name ?? name,
        };
        setUnits((prev) =>
          [...prev.filter((u) => u.name !== unit.name), unit].sort((a, b) =>
            a.name.localeCompare(b.name, "ar"),
          ),
        );
        set("unit", unit.name);
        set("sub_unit", unit.name);
        set("unit_raw", unit.name);
      }
      setQuickLookup((prev) => ({ ...prev, [kind]: "" }));
      toast.success("تمت الإضافة السريعة");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل الإضافة");
    } finally {
      setQuickBusy(null);
    }
  }

  function buildPayload() {
    const variationValues = pipeToArray(form.variation_values);
    const variationSkus = pipeToArray(form.variation_skus);
    const qtyPerMain = Math.max(1, Number(form.qty_per_main_unit) || 1);
    const baseUnitName = form.sub_unit.trim() || form.unit.trim();
    const mainUnitName = form.main_unit.trim();
    const unitRows = [
      baseUnitName
        ? {
            unit_name: baseUnitName,
            factor: 1,
            is_base: true,
            main_unit: mainUnitName || baseUnitName,
            sub_unit: baseUnitName,
            qty_per_main_unit: qtyPerMain,
            unit_raw: form.unit_raw || form.unit,
          }
        : null,
      mainUnitName && mainUnitName !== baseUnitName && qtyPerMain > 1
        ? {
            unit_name: mainUnitName,
            factor: qtyPerMain,
            is_base: false,
            main_unit: mainUnitName,
            sub_unit: baseUnitName || form.unit,
            qty_per_main_unit: qtyPerMain,
            unit_raw: form.unit_raw || form.unit,
          }
        : null,
    ].filter(Boolean);
    return {
      ...form,
      pharmacy_id: auth.activePharmacyId,
      branch_id: form.branch_id || auth.activeBranchId,
      opening_stock_branch_id: form.branch_id || auth.activeBranchId,
      barcodes: lineToBarcodeRows(form.barcodes),
      variation_values: variationValues,
      variation_skus: variationSkus,
      product_locations: pipeToArray(form.product_locations),
      units: unitRows,
      buy_price:
        Number(form.buy_price) ||
        Number(form.purchase_price_excluding_tax) ||
        Number(form.purchase_price_including_tax) ||
        0,
      purchase_price_including_tax:
        Number(form.purchase_price_including_tax) || 0,
      purchase_price_excluding_tax:
        Number(form.purchase_price_excluding_tax) || 0,
      profit_margin: Number(form.profit_margin) || 0,
      sell_price: Number(form.sell_price) || 0,
      old_sell_price: Number(form.old_sell_price) || 0,
      min_stock: Math.max(0, Number(form.min_stock) || 0),
      max_stock: Math.max(0, Number(form.max_stock) || 0),
      opening_stock: Math.max(0, Number(form.opening_stock) || 0),
      expiry_period_value: Math.max(0, Number(form.expiry_period_value) || 0),
      tax_percent: Math.max(0, Number(form.tax_percent) || 0),
      weight: Math.max(0, Number(form.weight) || 0),
    };
  }

  async function save() {
    if (!form.name_ar.trim()) {
      toast.error("اسم الصنف مطلوب");
      return;
    }
    if (!form.unit.trim()) {
      toast.error("اختر الوحدة الأساسية للصنف");
      return;
    }
    if (form.product_type === "variable" && !form.variation_values.trim()) {
      toast.error("قيم المتغيرات مطلوبة للمنتج المتغير");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        mode === "edit" && itemId ? `/api/items/${itemId}` : "/api/items",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        item?: { id: string };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ الصنف");
      toast.success(
        mode === "edit"
          ? "تم تعديل الصنف بنجاح"
          : "تم إنشاء الصنف وإضافته للمخزون بنجاح",
      );
      router.push("/dashboard/items");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ الصنف");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page-container py-10 text-center font-black text-slate-500">
        <Loader2 className="mx-auto mb-3 size-6 animate-spin" /> جاري تحميل
        بيانات الصنف...
      </div>
    );
  }

  return (
    <PageAccess
      permission={mode === "edit" ? "inventory:update" : "inventory:create"}
    >
      <section
        dir="rtl"
        className="page-container space-y-5 py-4 text-right sm:py-6"
      >
        <DashboardPageHeader
          title={mode === "edit" ? "تعديل الصنف" : "إضافة صنف جديد"}
          subtitle="ابدأ بالاسم والوحدة والسعر، ثم أكمل بيانات المخزون والصلاحية حسب احتياج الصنف."
          icon={Package}
          actions={
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              asChild
            >
              <Link href="/dashboard/items">
                <ArrowRight className="size-4" /> الأصناف
              </Link>
            </Button>
          }
        />

        <div className="grid gap-3 md:grid-cols-3">
          <AccountingMetric label="معادلة الوحدة" value={unitEquation} />
          <AccountingMetric
            label="ربح تقديري"
            value={`${pricingPreview.profit.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م (${pricingPreview.margin.toLocaleString("ar-EG", { maximumFractionDigits: 1 })}% هامش)`}
          />
          <AccountingMetric
            label="حالة البيع"
            value={form.not_for_sale ? "غير مخصص للبيع" : "متاح للبيع"}
          />
        </div>

        <AddItemSection title="البيانات الأساسية" icon={<Package className="size-5" />}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField id="name_ar" label="اسم الصنف" required>
              <Input
                autoFocus
                value={form.name_ar}
                onChange={(e) => set("name_ar", e.target.value)}
                placeholder="مثال: بانادول إكسترا"
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="name_en" label="الاسم بالإنجليزية">
              <Input
                value={form.name_en}
                onChange={(e) => set("name_en", e.target.value)}
                className="h-11 rounded-xl"
                dir="ltr"
              />
            </FormField>
            <FormField id="sku" label="SKU">
              <Input
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder="اتركه فارغًا للتوليد عند الاستيراد"
                className="h-11 rounded-xl"
                dir="ltr"
              />
            </FormField>
            <FormField id="barcode_type" label="نوع الباركود">
              <Input
                value={form.barcode_type}
                onChange={(e) => set("barcode_type", e.target.value)}
                className="h-11 rounded-xl"
                dir="ltr"
              />
            </FormField>
            <FormField id="barcodes" label="الباركودات">
              <Textarea
                value={form.barcodes}
                onChange={(e) => set("barcodes", e.target.value)}
                placeholder="باركود في كل سطر"
                className="min-h-20 rounded-xl"
                dir="ltr"
              />
            </FormField>
            <div className="md:col-span-2 xl:col-span-2">
              <ItemImageUploader
                value={form.image_url}
                disabled={saving}
                onChange={(url) => set("image_url", url)}
              />
            </div>
          </div>
        </AddItemSection>

        <AddItemSection title="التصنيف والنوع" icon={<Package className="size-5" />}>
          <div className="space-y-4">
            <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 md:grid-cols-3">
              <QuickCreateBox
                label="مجموعة جديدة"
                value={quickLookup.group}
                busy={quickBusy === "group"}
                onChange={(value) =>
                  setQuickLookup((prev) => ({ ...prev, group: value }))
                }
                onCreate={() => void createLookup("group")}
              />
              <QuickCreateBox
                label="ماركة جديدة"
                value={quickLookup.brand}
                busy={quickBusy === "brand"}
                onChange={(value) =>
                  setQuickLookup((prev) => ({ ...prev, brand: value }))
                }
                onCreate={() => void createLookup("brand")}
              />
              <QuickCreateBox
                label="وحدة جديدة"
                value={quickLookup.unit}
                busy={quickBusy === "unit"}
                onChange={(value) =>
                  setQuickLookup((prev) => ({ ...prev, unit: value }))
                }
                onCreate={() => void createLookup("unit")}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FormField id="group_id" label="المجموعة الرئيسية">
                <NativeSelect
                  value={form.group_id}
                  onChange={(e) => set("group_id", e.target.value)}
                  className="h-11"
                >
                  <NativeSelectOption value="">بدون مجموعة</NativeSelectOption>
                  {groups.map((g) => (
                    <NativeSelectOption key={g.id} value={g.id}>
                      {g.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="category" label="اسم المجموعة من ملف Excel">
                <Input
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="sub_category" label="المجموعة الفرعية">
                <Input
                  value={form.sub_category}
                  onChange={(e) => set("sub_category", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="brand_id" label="الماركة">
                <NativeSelect
                  value={form.brand_id}
                  onChange={(e) => set("brand_id", e.target.value)}
                  className="h-11"
                >
                  <NativeSelectOption value="">بدون ماركة</NativeSelectOption>
                  {brands.map((b) => (
                    <NativeSelectOption key={b.id} value={b.id}>
                      {b.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="unit" label="الوحدة الأساسية" required>
                <NativeSelect
                  value={form.unit}
                  onChange={(e) => {
                    set("unit", e.target.value);
                    if (!form.sub_unit || form.sub_unit === "وحدة")
                      set("sub_unit", e.target.value);
                    if (!form.unit_raw || form.unit_raw === "وحدة")
                      set("unit_raw", e.target.value);
                  }}
                  className="h-11"
                >
                  <NativeSelectOption value="وحدة">وحدة</NativeSelectOption>
                  {units
                    .filter((u) => u.name !== "وحدة")
                    .map((u) => (
                      <NativeSelectOption key={u.id} value={u.name}>
                        {u.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </FormField>
              <FormField id="item_type" label="نوع الصنف الداخلي">
                <NativeSelect
                  value={form.item_type}
                  onChange={(e) => set("item_type", e.target.value)}
                  className="h-11"
                >
                  {ITEM_TYPES.map((t) => (
                    <NativeSelectOption key={t.value} value={t.value}>
                      {t.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="product_type" label="نوع المنتج">
                <NativeSelect
                  value={form.product_type}
                  onChange={(e) => set("product_type", e.target.value)}
                  className="h-11"
                >
                  <NativeSelectOption value="single">مفرد</NativeSelectOption>
                  <NativeSelectOption value="variable">
                    متغير
                  </NativeSelectOption>
                </NativeSelect>
              </FormField>
              <FormField id="manufacturer_name" label="شركة/مصنع">
                <Input
                  value={form.manufacturer_name}
                  onChange={(e) => set("manufacturer_name", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
            </div>
          </div>
        </AddItemSection>

        <AddItemSection title="معادلات الوحدات" icon={<Package className="size-5" />}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField id="sub_unit" label="وحدة البيع / الفرعية">
              <Input
                value={form.sub_unit}
                onChange={(e) => set("sub_unit", e.target.value)}
                placeholder="مثال: شريط / قرص"
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="main_unit" label="الوحدة الرئيسية">
              <Input
                value={form.main_unit}
                onChange={(e) => set("main_unit", e.target.value)}
                placeholder="مثال: علبة"
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="qty_per_main_unit" label="عدد الفرعية داخل الرئيسية">
              <Input
                type="number"
                min="1"
                value={form.qty_per_main_unit}
                onChange={(e) => set("qty_per_main_unit", e.target.value)}
                placeholder="مثال: 10"
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="unit_raw" label="نص الوحدة الأصلي">
              <Input
                value={form.unit_raw}
                onChange={(e) => set("unit_raw", e.target.value)}
                placeholder="النص الأصلي من ملف العميل"
                className="h-11 rounded-xl"
              />
            </FormField>
            <div className="rounded-2xl border border-sky-100 bg-white p-3 text-sm font-black text-sky-900 md:col-span-2 xl:col-span-4">
              المعادلة الحالية:{" "}
              {form.main_unit &&
              form.sub_unit &&
              Number(form.qty_per_main_unit) > 1
                ? `1 ${form.main_unit} = ${form.qty_per_main_unit} ${form.sub_unit}`
                : "حدد الوحدة الرئيسية والفرعية والعدد"}
            </div>
          </div>
        </AddItemSection>

        {form.product_type === "variable" ? (
          <AddItemSection title="المتغيرات" icon={<Package className="size-5" />}>
            <div className="grid gap-3 md:grid-cols-3">
              <FormField id="variation_name" label="اسم المتغير">
                <Input
                  value={form.variation_name}
                  onChange={(e) => set("variation_name", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="variation_values" label="قيم المتغير مفصولة بـ |">
                <Textarea
                  value={form.variation_values}
                  onChange={(e) => set("variation_values", e.target.value)}
                  placeholder="Small|Medium|Large"
                  className="min-h-20 rounded-xl"
                  dir="ltr"
                />
              </FormField>
              <FormField id="variation_skus" label="أكواد المتغيرات مفصولة بـ |">
                <Textarea
                  value={form.variation_skus}
                  onChange={(e) => set("variation_skus", e.target.value)}
                  placeholder="SKU-S|SKU-M|SKU-L"
                  className="min-h-20 rounded-xl"
                  dir="ltr"
                />
              </FormField>
            </div>
          </AddItemSection>
        ) : null}

        <AddItemSection title="التسعير والضرائب" icon={<Package className="size-5" />}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField id="purchase_price_including_tax" label="سعر الشراء شامل الضريبة">
              <Input
                type="number"
                min="0"
                value={form.purchase_price_including_tax}
                onChange={(e) =>
                  set("purchase_price_including_tax", e.target.value)
                }
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="purchase_price_excluding_tax" label="سعر الشراء بدون ضريبة">
              <Input
                type="number"
                min="0"
                value={form.purchase_price_excluding_tax}
                onChange={(e) =>
                  set("purchase_price_excluding_tax", e.target.value)
                }
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="buy_price" label="سعر الشراء الداخلي">
              <Input
                type="number"
                min="0"
                value={form.buy_price}
                onChange={(e) => set("buy_price", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="sell_price" label="سعر البيع">
              <Input
                type="number"
                min="0"
                value={form.sell_price}
                onChange={(e) => set("sell_price", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="old_sell_price" label="سعر البيع القديم">
              <Input
                type="number"
                min="0"
                value={form.old_sell_price}
                onChange={(e) => set("old_sell_price", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="profit_margin" label="هامش الربح %">
              <Input
                type="number"
                min="0"
                value={form.profit_margin}
                onChange={(e) => set("profit_margin", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="tax_name" label="الضريبة المطبقة">
              <Input
                value={form.tax_name}
                onChange={(e) => set("tax_name", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="tax_percent" label="نسبة الضريبة %">
              <Input
                type="number"
                min="0"
                value={form.tax_percent}
                onChange={(e) => set("tax_percent", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="selling_price_tax_type" label="نوع ضريبة سعر البيع">
              <NativeSelect
                value={form.selling_price_tax_type}
                onChange={(e) => set("selling_price_tax_type", e.target.value)}
                className="h-11"
              >
                <NativeSelectOption value="exclusive">غير شامل</NativeSelectOption>
                <NativeSelectOption value="inclusive">شامل</NativeSelectOption>
              </NativeSelect>
            </FormField>
          </div>
        </AddItemSection>

        <AddItemSection title="المخزون والمكان" icon={<Package className="size-5" />}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <InventoryToggle
                label="متابعة المخزون"
                checked={form.manage_inventory}
                onChange={(value) => set("manage_inventory", value)}
              />
              <InventoryToggle
                label="غير مخصص للبيع"
                checked={form.not_for_sale}
                onChange={(value) => set("not_for_sale", value)}
              />
              <InventoryToggle
                label="تفعيل رقم سيريال / IMEI"
                checked={form.serial_tracking_enabled}
                onChange={(value) => set("serial_tracking_enabled", value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FormField id="min_stock" label="حد التنبيه">
                <Input
                  type="number"
                  min="0"
                  value={form.min_stock}
                  onChange={(e) => set("min_stock", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="max_stock" label="حد أقصى">
                <Input
                  type="number"
                  min="0"
                  value={form.max_stock}
                  onChange={(e) => set("max_stock", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="opening_stock" label="الرصيد الافتتاحي">
                <Input
                  type="number"
                  min="0"
                  value={form.opening_stock}
                  onChange={(e) => set("opening_stock", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="branch_id" label="فرع الرصيد الافتتاحي">
                <NativeSelect
                  value={form.branch_id}
                  onChange={(e) => set("branch_id", e.target.value)}
                  className="h-11"
                >
                  <NativeSelectOption value="">
                    الفرع النشط / الافتراضي
                  </NativeSelectOption>
                  {branches.map((b) => (
                    <NativeSelectOption key={b.id} value={b.id}>
                      {b.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="product_locations" label="أماكن الصنف مفصولة بـ |">
                <Input
                  value={form.product_locations}
                  onChange={(e) => set("product_locations", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="rack" label="الرف">
                <Input
                  value={form.rack}
                  onChange={(e) => set("rack", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="shelf_row" label="الصف">
                <Input
                  value={form.shelf_row}
                  onChange={(e) => set("shelf_row", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="position" label="المكان">
                <Input
                  value={form.position}
                  onChange={(e) => set("position", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="weight" label="الوزن">
                <Input
                  type="number"
                  min="0"
                  value={form.weight}
                  onChange={(e) => set("weight", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
            </div>
          </div>
        </AddItemSection>

        <AddItemSection title="الصلاحية والتتبع" icon={<Package className="size-5" />}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <InventoryToggle
                label="له تاريخ صلاحية"
                checked={form.has_expiry}
                onChange={(value) => set("has_expiry", value)}
              />
              <InventoryToggle
                label="تتبع Batch"
                checked={form.track_batch}
                onChange={(value) => set("track_batch", value)}
              />
              <InventoryToggle
                label="محدود / مراقب"
                checked={form.is_controlled}
                onChange={(value) => set("is_controlled", value)}
              />
              <InventoryToggle
                label="يتطلب روشتة"
                checked={form.requires_prescription}
                onChange={(value) => set("requires_prescription", value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FormField id="expiry_date" label="تاريخ الصلاحية">
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => set("expiry_date", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="expiry_period_value" label="ينتهي خلال">
                <Input
                  type="number"
                  min="0"
                  value={form.expiry_period_value}
                  onChange={(e) => set("expiry_period_value", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </FormField>
              <FormField id="expiry_period_unit" label="وحدة فترة الصلاحية">
                <NativeSelect
                  value={form.expiry_period_unit}
                  onChange={(e) => set("expiry_period_unit", e.target.value)}
                  className="h-11"
                >
                  <NativeSelectOption value="months">شهور</NativeSelectOption>
                  <NativeSelectOption value="days">أيام</NativeSelectOption>
                </NativeSelect>
              </FormField>
            </div>
          </div>
        </AddItemSection>

        <AddItemSection title="الوصف والحقول المخصصة" icon={<Package className="size-5" />}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField id="custom_field_1" label="حقل مخصص 1">
              <Input
                value={form.custom_field_1}
                onChange={(e) => set("custom_field_1", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="custom_field_2" label="حقل مخصص 2">
              <Input
                value={form.custom_field_2}
                onChange={(e) => set("custom_field_2", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="custom_field_3" label="حقل مخصص 3">
              <Input
                value={form.custom_field_3}
                onChange={(e) => set("custom_field_3", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="custom_field_4" label="حقل مخصص 4">
              <Input
                value={form.custom_field_4}
                onChange={(e) => set("custom_field_4", e.target.value)}
                className="h-11 rounded-xl"
              />
            </FormField>
            <FormField id="product_description" label="وصف الصنف" className="md:col-span-2">
              <Textarea
                value={form.product_description}
                onChange={(e) => set("product_description", e.target.value)}
                className="min-h-24 rounded-xl"
              />
            </FormField>
            <FormField id="notes" label="ملاحظات داخلية" className="md:col-span-2">
              <Textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="min-h-24 rounded-xl"
              />
            </FormField>
          </div>
        </AddItemSection>

        <div className="sticky bottom-4 z-20 flex flex-wrap justify-end gap-3 rounded-2xl border border-brand/20 bg-white/95 p-3 shadow-xl backdrop-blur">
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            asChild
          >
            <Link href="/dashboard/items">
              <ArrowRight className="size-4" /> إلغاء
            </Link>
          </Button>
          <Button
            className="h-11 min-w-36 rounded-xl px-5 font-black"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {mode === "edit" ? "حفظ التعديل" : "حفظ الصنف"}
          </Button>
        </div>
      </section>
    </PageAccess>
  );
}

function itemUploadUrl(file: UploadResult | null) {
  return file?.serverData?.url ?? file?.ufsUrl ?? file?.url ?? "";
}

function ItemImageUploader({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState(0);
  const { startUpload, isUploading } = useUploadThing("itemImage", {
    onUploadProgress: (value) => setProgress(value),
    onClientUploadComplete: (result) => {
      const url = itemUploadUrl((result?.[0] ?? null) as UploadResult | null);
      if (!url) {
        toast.error("تم رفع الصورة لكن لم يصل رابط UploadThing");
        setProgress(0);
        return;
      }
      onChange(url);
      setProgress(100);
      toast.success("تم رفع صورة الصنف");
    },
    onUploadError: (error) => {
      setProgress(0);
      toast.error(error.message || "فشل رفع صورة الصنف");
    },
  });

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || disabled || isUploading) return;
    if (!file.type.startsWith("image/")) {
      toast.error("اختار صورة فقط");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("حجم صورة الصنف لا يزيد عن 8MB");
      return;
    }
    setProgress(3);
    await startUpload([file]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = Boolean(disabled || isUploading);

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-start gap-3">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {value ? (
            <img
              src={value}
              alt="صورة الصنف"
              className="size-full object-cover"
            />
          ) : (
            <ImageUp className="size-7 text-slate-400" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Label className="font-black text-slate-800">صورة الصنف</Label>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="رابط الصورة أو ارفع صورة على UploadThing"
            className="h-11 rounded-xl bg-white"
            dir="ltr"
            disabled={busy}
          />
          {isUploading ? (
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${Math.max(3, progress)}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(event) => void handleFile(event.target.files)}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-xl bg-white"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UploadCloud className="size-4" />
          )}
          رفع على UploadThing
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-xl bg-white text-rose-600 hover:text-rose-700"
          disabled={busy || !value}
          onClick={() => onChange("")}
        >
          <Trash2 className="size-4" />
          إزالة الصورة
        </Button>
      </div>
    </div>
  );
}

function QuickCreateBox({
  label,
  value,
  busy,
  onChange,
  onCreate,
}: {
  label: string;
  value: string;
  busy?: boolean;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-black text-slate-500">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 rounded-xl bg-white text-sm font-bold"
          placeholder="اكتب الاسم"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-10 shrink-0 rounded-xl bg-white"
          disabled={busy || !value.trim()}
          onClick={onCreate}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}


