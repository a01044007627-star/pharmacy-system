-- ===================================================================
-- CONSOLIDATED: DATA MIGRATIONS (DML)
-- Source: migrations 20260617xxxxx → 20260618xxxxx
--
-- Wrapped in a single BEGIN/COMMIT transaction.
-- Safe for replay: idempotent patterns (ON CONFLICT, WHERE checks)
-- ===================================================================

BEGIN;

-- ===================================================================
-- 1. SETTINGS — إزالة تكرار الإعدادات العامة وترقية إعدادات الصيدليات
-- ===================================================================

-- حذف الإعدادات العامة المكررة (الاحتفاظ بأحدث سجل لكل key)
WITH ranked_global_settings AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY key ORDER BY updated_at DESC, id DESC) AS rn
  FROM public.pharmacy_settings
  WHERE pharmacy_id IS NULL
)
DELETE FROM public.pharmacy_settings ps
USING ranked_global_settings r
WHERE ps.id = r.id
  AND r.rn > 1;

-- ترقية أحدث إعدادات الصيدليات إلى إعدادات عامة إن لم توجد
WITH latest_scoped_system_settings AS (
  SELECT DISTINCT ON (key)
    key,
    value,
    updated_at
  FROM public.pharmacy_settings
  WHERE pharmacy_id IS NOT NULL
    AND public.is_core_system_setting_key(key)
  ORDER BY key, updated_at DESC, id DESC
)
INSERT INTO public.pharmacy_settings (pharmacy_id, key, value, updated_at)
SELECT NULL, source.key, source.value, source.updated_at
FROM latest_scoped_system_settings source
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pharmacy_settings existing
  WHERE existing.pharmacy_id IS NULL
    AND existing.key = source.key
);

-- ===================================================================
-- 2. SHIFTS — إغلاق الورديات المكررة المفتوحة
-- ===================================================================

WITH duplicated_open_shifts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pharmacy_id, branch_id, user_id
      ORDER BY opened_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.pharmacy_shifts
  WHERE status = 'open'
)
UPDATE public.pharmacy_shifts shift
SET status = 'closed',
    closed_at = COALESCE(shift.closed_at, now()),
    closing_balance = COALESCE(shift.closing_balance, shift.expected_balance, shift.opening_balance, 0),
    difference = COALESCE(shift.difference, 0),
    notes = concat_ws(' | ', NULLIF(shift.notes, ''), 'تم إغلاق وردية مكررة تلقائيًا قبل قفل تعارض الورديات'),
    updated_at = now()
FROM duplicated_open_shifts ranked
WHERE ranked.id = shift.id
  AND ranked.rn > 1;

-- ===================================================================
-- 3. STOCK — ترحيل opening_stock إلى أرصدة وحركات المخزون
-- ===================================================================

-- إدراج الأرصدة الافتتاحية في stock_balances
WITH default_branch AS (
  SELECT DISTINCT ON (pharmacy_id) pharmacy_id, id AS branch_id
  FROM public.pharmacy_branches
  WHERE status <> 'closed'
  ORDER BY pharmacy_id, is_default DESC, created_at ASC
), opening_items AS (
  SELECT
    item.id AS item_id,
    item.pharmacy_id,
    COALESCE(item.branch_id, default_branch.branch_id) AS branch_id,
    item.opening_stock AS quantity,
    item.buy_price,
    item.unit
  FROM public.pharmacy_items item
  JOIN default_branch ON default_branch.pharmacy_id = item.pharmacy_id
  WHERE COALESCE(item.opening_stock, 0) > 0
    AND COALESCE(item.manage_inventory, true) = true
)
INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
SELECT pharmacy_id, item_id, branch_id, quantity, now()
FROM opening_items
WHERE branch_id IS NOT NULL
ON CONFLICT (pharmacy_id, item_id, branch_id) DO NOTHING;

-- إدراج حركات المخزون الافتتاحية
WITH default_branch AS (
  SELECT DISTINCT ON (pharmacy_id) pharmacy_id, id AS branch_id
  FROM public.pharmacy_branches
  WHERE status <> 'closed'
  ORDER BY pharmacy_id, is_default DESC, created_at ASC
), opening_items AS (
  SELECT
    item.id AS item_id,
    item.pharmacy_id,
    COALESCE(item.branch_id, default_branch.branch_id) AS branch_id,
    item.opening_stock AS quantity,
    item.buy_price
  FROM public.pharmacy_items item
  JOIN default_branch ON default_branch.pharmacy_id = item.pharmacy_id
  WHERE COALESCE(item.opening_stock, 0) > 0
    AND COALESCE(item.manage_inventory, true) = true
)
INSERT INTO public.pharmacy_stock_movements (
  pharmacy_id, item_id, branch_id, direction, quantity,
  unit_price, total_value, movement_type, source_table, source_id, created_at
)
SELECT
  opening_items.pharmacy_id,
  opening_items.item_id,
  opening_items.branch_id,
  'in',
  opening_items.quantity,
  COALESCE(opening_items.buy_price, 0),
  ROUND(opening_items.quantity * COALESCE(opening_items.buy_price, 0), 2),
  'opening_stock',
  'pharmacy_items',
  opening_items.item_id,
  now()
FROM opening_items
WHERE opening_items.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_stock_movements movement
    WHERE movement.pharmacy_id = opening_items.pharmacy_id
      AND movement.item_id = opening_items.item_id
      AND movement.source_table = 'pharmacy_items'
      AND movement.source_id = opening_items.item_id
      AND movement.movement_type = 'opening_stock'
  );

-- ===================================================================
-- 4. UNITS — ترحيل وتنظيف وحدات الأصناف
-- ===================================================================

-- 4a) تعبئة الحقول الفارغة في pharmacy_item_units
UPDATE public.pharmacy_item_units
SET
  main_unit = COALESCE(NULLIF(main_unit, ''), CASE WHEN is_base THEN unit_name ELSE unit_name END),
  sub_unit = COALESCE(NULLIF(sub_unit, ''), unit_name),
  qty_per_main_unit = COALESCE(NULLIF(qty_per_main_unit, 0), factor, 1),
  unit_raw = COALESCE(NULLIF(unit_raw, ''), unit_name),
  updated_at = COALESCE(updated_at, now())
WHERE main_unit IS NULL OR main_unit = ''
   OR sub_unit IS NULL OR sub_unit = ''
   OR qty_per_main_unit IS NULL OR qty_per_main_unit <= 0
   OR unit_raw IS NULL OR unit_raw = ''
   OR updated_at IS NULL;

-- 4b) تعبئة الحقول الفارغة في pharmacy_units
UPDATE public.pharmacy_units
SET
  is_active = COALESCE(is_active, true),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, created_at, now())
WHERE is_active IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL;

-- 4c) حذف الوحدات المكررة في pharmacy_units (الاحتفاظ بالأقدم)
WITH ranked_units AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pharmacy_id, lower(trim(unit_name))
      ORDER BY created_at NULLS LAST, id::text
    ) AS duplicate_rank
  FROM public.pharmacy_units
  WHERE NULLIF(trim(unit_name), '') IS NOT NULL
)
DELETE FROM public.pharmacy_units u
USING ranked_units duplicate
WHERE u.id = duplicate.id
  AND duplicate.duplicate_rank > 1;

-- 4d) حذف الوحدات الفارغة
DELETE FROM public.pharmacy_units
WHERE NULLIF(trim(unit_name), '') IS NULL;

-- 4e) تنعيم (trim) أسماء الوحدات
UPDATE public.pharmacy_units
SET unit_name = trim(unit_name), updated_at = now()
WHERE unit_name <> trim(unit_name);

-- 4f) إدراج الوحدات من pharmacy_item_units إلى pharmacy_units
INSERT INTO public.pharmacy_units (pharmacy_id, unit_name)
SELECT DISTINCT pharmacy_id, NULLIF(trim(unit_name), '')
FROM public.pharmacy_item_units
WHERE NULLIF(trim(unit_name), '') IS NOT NULL
ON CONFLICT (pharmacy_id, unit_name) DO NOTHING;

-- 4g) إدراج الوحدات العربية الافتراضية لكل صيدلية
INSERT INTO public.pharmacy_units (pharmacy_id, unit_name)
SELECT p.id, unit_name
FROM public.pharmacies p
CROSS JOIN (
  VALUES ('وحدة'), ('علبة'), ('شريط'), ('قرص'), ('زجاجة'), ('كيس'), ('عبوة')
) AS defaults(unit_name)
ON CONFLICT (pharmacy_id, unit_name) DO NOTHING;

-- ===================================================================
-- 5. BRANCHES & BARCODES & BASE UNITS — تنظيف العلامات المكررة
-- ===================================================================

-- 5a) إزالة تكرار الفرع الافتراضي
WITH ranked_defaults AS (
  SELECT id,
         row_number() OVER (PARTITION BY pharmacy_id ORDER BY created_at NULLS LAST, id::text) AS rn
  FROM public.pharmacy_branches
  WHERE is_default = true
)
UPDATE public.pharmacy_branches b
SET is_default = false, updated_at = now()
FROM ranked_defaults r
WHERE b.id = r.id AND r.rn > 1;

-- 5b) إزالة تكرار الباركود الرئيسي
WITH ranked_primary_barcodes AS (
  SELECT id,
         row_number() OVER (PARTITION BY pharmacy_id, item_id ORDER BY created_at NULLS LAST, id::text) AS rn
  FROM public.pharmacy_item_barcodes
  WHERE is_primary = true
)
UPDATE public.pharmacy_item_barcodes b
SET is_primary = false
FROM ranked_primary_barcodes r
WHERE b.id = r.id AND r.rn > 1;

-- 5c) إزالة تكرار الوحدة الأساسية للصنف
WITH ranked_base_units AS (
  SELECT id,
         row_number() OVER (PARTITION BY pharmacy_id, item_id ORDER BY created_at NULLS LAST, id::text) AS rn
  FROM public.pharmacy_item_units
  WHERE is_base = true
)
UPDATE public.pharmacy_item_units u
SET is_base = false, updated_at = now()
FROM ranked_base_units r
WHERE u.id = r.id AND r.rn > 1;

-- ===================================================================
-- 6. DAILY SUMMARY & PURCHASE ORDERS — ترحيل البيانات الناقصة
-- ===================================================================

-- 6a) تعبئة summary_date في pharmacy_daily_summary
UPDATE public.pharmacy_daily_summary
SET summary_date = COALESCE(
  summary_date,
  CASE WHEN date_key ~ '^\d{4}-\d{2}-\d{2}$' THEN date_key::date ELSE created_at::date END
)
WHERE summary_date IS NULL;

-- 6b) تعبئة date_key من summary_date
UPDATE public.pharmacy_daily_summary
SET date_key = summary_date::text
WHERE summary_date IS NOT NULL
  AND (date_key IS NULL OR date_key = '');

-- 6c) تعبئة الحقول الناقصة في أوامر الشراء
UPDATE public.pharmacy_purchase_orders
SET
  order_number = COALESCE(order_number, 'PO-' || substring(id::text, 1, 8)),
  order_date = COALESCE(order_date, created_at, now()),
  paid_amount = COALESCE(paid_amount, 0),
  due_amount = COALESCE(due_amount, GREATEST(COALESCE(total, 0) - COALESCE(paid_amount, 0), 0))
WHERE order_number IS NULL
   OR order_date IS NULL
   OR paid_amount IS NULL
   OR due_amount IS NULL;

-- 6d) إزالة تكرار أرقام أوامر الشراء
WITH ranked_purchase_orders AS (
  SELECT id,
         row_number() OVER (PARTITION BY pharmacy_id, order_number ORDER BY created_at NULLS LAST, id::text) AS rn
  FROM public.pharmacy_purchase_orders
  WHERE order_number IS NOT NULL AND order_number <> ''
)
UPDATE public.pharmacy_purchase_orders po
SET order_number = po.order_number || '-' || substring(po.id::text, 1, 6),
    updated_at = now()
FROM ranked_purchase_orders r
WHERE po.id = r.id AND r.rn > 1;

COMMIT;
