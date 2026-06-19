-- Final schema conflict guard.
-- Safe for Supabase SQL editor/API roles: no ALTER SYSTEM / no ALTER FUNCTION SET GUC.
-- Keeps existing data, normalizes duplicated flags, and adds tenant-safe indexes/FKs.

BEGIN;

-- 1) Columns currently used by the application but absent in older deployments.
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE public.pharmacy_daily_summary
  ADD COLUMN IF NOT EXISTS summary_date DATE;

UPDATE public.pharmacy_daily_summary
SET summary_date = COALESCE(
  summary_date,
  CASE WHEN date_key ~ '^\d{4}-\d{2}-\d{2}$' THEN date_key::date ELSE created_at::date END
)
WHERE summary_date IS NULL;

UPDATE public.pharmacy_daily_summary
SET date_key = summary_date::text
WHERE summary_date IS NOT NULL
  AND (date_key IS NULL OR date_key = '');

CREATE OR REPLACE FUNCTION public.sync_pharmacy_daily_summary_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.summary_date IS NULL THEN
    NEW.summary_date := CASE
      WHEN NEW.date_key ~ '^\d{4}-\d{2}-\d{2}$' THEN NEW.date_key::date
      ELSE COALESCE(NEW.created_at, now())::date
    END;
  END IF;

  IF NEW.date_key IS NULL OR NEW.date_key = '' THEN
    NEW.date_key := NEW.summary_date::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharmacy_daily_summary_dates ON public.pharmacy_daily_summary;
CREATE TRIGGER trg_pharmacy_daily_summary_dates
BEFORE INSERT OR UPDATE ON public.pharmacy_daily_summary
FOR EACH ROW EXECUTE FUNCTION public.sync_pharmacy_daily_summary_dates();

CREATE INDEX IF NOT EXISTS idx_daily_summary_summary_date
  ON public.pharmacy_daily_summary(pharmacy_id, branch_id, summary_date);

ALTER TABLE public.pharmacy_purchase_orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ NOT NULL DEFAULT now();

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number
  ON public.pharmacy_purchase_orders(pharmacy_id, order_number)
  WHERE order_number IS NOT NULL AND order_number <> '';

CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch_date
  ON public.pharmacy_purchase_orders(pharmacy_id, branch_id, order_date DESC);

ALTER TABLE public.pharmacy_item_units
  ADD COLUMN IF NOT EXISTS main_unit TEXT,
  ADD COLUMN IF NOT EXISTS sub_unit TEXT,
  ADD COLUMN IF NOT EXISTS qty_per_main_unit NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS unit_raw TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

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

-- 2) Normalize duplicated boolean flags before adding partial unique indexes.
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_default_branch_per_pharmacy
  ON public.pharmacy_branches(pharmacy_id)
  WHERE is_default = true;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_primary_barcode_per_item
  ON public.pharmacy_item_barcodes(pharmacy_id, item_id)
  WHERE is_primary = true;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_base_unit_per_item
  ON public.pharmacy_item_units(pharmacy_id, item_id)
  WHERE is_base = true;

-- 3) Clean global units duplicates if a deployment created the table manually.
CREATE TABLE IF NOT EXISTS public.pharmacy_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_units
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DELETE FROM public.pharmacy_units
WHERE NULLIF(trim(unit_name), '') IS NULL;

WITH ranked_units AS (
  SELECT id,
         row_number() OVER (PARTITION BY pharmacy_id, lower(trim(unit_name)) ORDER BY created_at NULLS LAST, id::text) AS rn
  FROM public.pharmacy_units
  WHERE NULLIF(trim(unit_name), '') IS NOT NULL
)
DELETE FROM public.pharmacy_units u
USING ranked_units r
WHERE u.id = r.id AND r.rn > 1;

UPDATE public.pharmacy_units
SET unit_name = trim(unit_name), updated_at = now()
WHERE unit_name <> trim(unit_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_units_name
  ON public.pharmacy_units(pharmacy_id, unit_name);

INSERT INTO public.pharmacy_units (pharmacy_id, unit_name)
SELECT DISTINCT pharmacy_id, NULLIF(trim(unit_name), '')
FROM public.pharmacy_item_units
WHERE NULLIF(trim(unit_name), '') IS NOT NULL
ON CONFLICT (pharmacy_id, unit_name) DO NOTHING;

-- 4) Tenant-safe reference indexes. These are cheap because id is already unique,
-- but they allow composite FKs that prevent cross-pharmacy links.
DO $$
DECLARE
  tbl TEXT;
  ref_tables TEXT[] := ARRAY[
    'pharmacy_branches',
    'pharmacy_items',
    'pharmacy_partners',
    'pharmacy_item_batches',
    'pharmacy_sales',
    'pharmacy_sale_lines',
    'pharmacy_sales_returns',
    'pharmacy_purchases',
    'pharmacy_purchase_lines',
    'pharmacy_purchase_returns',
    'pharmacy_journal_entries',
    'pharmacy_stock_transfers'
  ];
BEGIN
  FOREACH tbl IN ARRAY ref_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'pharmacy_id'
      )
    THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (id, pharmacy_id)', 'ux_' || tbl || '_id_pharmacy', tbl);
    END IF;
  END LOOP;
END;
$$;

-- 5) Composite FKs for the critical operational tables.
DO $$
DECLARE
  rel RECORD;
BEGIN
  FOR rel IN
    SELECT * FROM (VALUES
      ('pharmacy_item_barcodes','item_id','pharmacy_items','fk_barcodes_item_tenant'),
      ('pharmacy_item_units','item_id','pharmacy_items','fk_item_units_item_tenant'),
      ('pharmacy_item_variants','item_id','pharmacy_items','fk_variants_item_tenant'),
      ('pharmacy_item_warranties','item_id','pharmacy_items','fk_warranties_item_tenant'),
      ('pharmacy_item_alternatives','item_id','pharmacy_items','fk_alt_item_tenant'),
      ('pharmacy_item_alternatives','alternative_item_id','pharmacy_items','fk_alt_alt_item_tenant'),
      ('pharmacy_item_batches','item_id','pharmacy_items','fk_batches_item_tenant'),
      ('pharmacy_stock_balances','item_id','pharmacy_items','fk_stock_bal_item_tenant'),
      ('pharmacy_stock_balances','branch_id','pharmacy_branches','fk_stock_bal_branch_tenant'),
      ('pharmacy_stock_movements','item_id','pharmacy_items','fk_stock_mov_item_tenant'),
      ('pharmacy_stock_movements','branch_id','pharmacy_branches','fk_stock_mov_branch_tenant'),
      ('pharmacy_damaged_stock','item_id','pharmacy_items','fk_damage_item_tenant'),
      ('pharmacy_damaged_stock','branch_id','pharmacy_branches','fk_damage_branch_tenant'),
      ('pharmacy_stock_counts','item_id','pharmacy_items','fk_count_item_tenant'),
      ('pharmacy_stock_counts','branch_id','pharmacy_branches','fk_count_branch_tenant'),
      ('pharmacy_sales','branch_id','pharmacy_branches','fk_sales_branch_tenant'),
      ('pharmacy_sales','customer_id','pharmacy_partners','fk_sales_customer_tenant'),
      ('pharmacy_sale_lines','sale_id','pharmacy_sales','fk_sale_lines_sale_tenant'),
      ('pharmacy_sale_lines','item_id','pharmacy_items','fk_sale_lines_item_tenant'),
      ('pharmacy_sales_returns','sale_id','pharmacy_sales','fk_sales_returns_sale_tenant'),
      ('pharmacy_sales_return_lines','return_id','pharmacy_sales_returns','fk_sales_return_lines_return_tenant'),
      ('pharmacy_sales_return_lines','item_id','pharmacy_items','fk_sales_return_lines_item_tenant'),
      ('pharmacy_purchases','branch_id','pharmacy_branches','fk_purchases_branch_tenant'),
      ('pharmacy_purchases','supplier_id','pharmacy_partners','fk_purchases_supplier_tenant'),
      ('pharmacy_purchase_lines','purchase_id','pharmacy_purchases','fk_purchase_lines_purchase_tenant'),
      ('pharmacy_purchase_lines','item_id','pharmacy_items','fk_purchase_lines_item_tenant'),
      ('pharmacy_purchase_returns','purchase_id','pharmacy_purchases','fk_purchase_returns_purchase_tenant'),
      ('pharmacy_purchase_return_lines','return_id','pharmacy_purchase_returns','fk_purchase_return_lines_return_tenant'),
      ('pharmacy_purchase_return_lines','item_id','pharmacy_items','fk_purchase_return_lines_item_tenant'),
      ('pharmacy_journal_lines','entry_id','pharmacy_journal_entries','fk_journal_lines_entry_tenant')
    ) AS v(source_table, source_column, reference_table, constraint_name)
  LOOP
    IF to_regclass('public.' || rel.source_table) IS NOT NULL
      AND to_regclass('public.' || rel.reference_table) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = rel.source_table AND column_name = rel.source_column
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = rel.source_table AND column_name = 'pharmacy_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = rel.reference_table AND column_name = 'id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = rel.reference_table AND column_name = 'pharmacy_id'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = rel.constraint_name AND conrelid = ('public.' || rel.source_table)::regclass
      )
    THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, pharmacy_id) REFERENCES public.%I(id, pharmacy_id) NOT VALID',
        rel.source_table,
        rel.constraint_name,
        rel.source_column,
        rel.reference_table
      );
    END IF;
  END LOOP;
END;
$$;

-- 6) Integrity view: read-only checklist for old data problems.
DROP VIEW IF EXISTS public.pharmacy_table_integrity_issues CASCADE;
CREATE VIEW public.pharmacy_table_integrity_issues AS
SELECT 'duplicate_default_branches' AS issue_code,
       pharmacy_id,
       (array_agg(id ORDER BY created_at NULLS LAST, id::text))[1] AS sample_id,
       'pharmacy_branches' AS table_name,
       'أكثر من فرع رئيسي لنفس الصيدلية' AS issue_message,
       min(created_at) AS first_seen_at
FROM public.pharmacy_branches
WHERE is_default = true
GROUP BY pharmacy_id
HAVING count(*) > 1
UNION ALL
SELECT 'duplicate_primary_barcodes',
       pharmacy_id,
       (array_agg(id ORDER BY created_at NULLS LAST, id::text))[1],
       'pharmacy_item_barcodes',
       'أكثر من باركود رئيسي لنفس الصنف',
       min(created_at)
FROM public.pharmacy_item_barcodes
WHERE is_primary = true
GROUP BY pharmacy_id, item_id
HAVING count(*) > 1
UNION ALL
SELECT 'duplicate_base_units',
       pharmacy_id,
       (array_agg(id ORDER BY created_at NULLS LAST, id::text))[1],
       'pharmacy_item_units',
       'أكثر من وحدة أساسية لنفس الصنف',
       min(created_at)
FROM public.pharmacy_item_units
WHERE is_base = true
GROUP BY pharmacy_id, item_id
HAVING count(*) > 1
UNION ALL
SELECT 'empty_unit_name',
       pharmacy_id,
       (array_agg(id ORDER BY created_at NULLS LAST, id::text))[1],
       'pharmacy_item_units',
       'وحدة صنف بدون اسم',
       min(created_at)
FROM public.pharmacy_item_units
WHERE NULLIF(trim(unit_name), '') IS NULL
GROUP BY pharmacy_id
UNION ALL
SELECT 'negative_stock_balance',
       pharmacy_id,
       NULL::uuid,
       'pharmacy_stock_balances',
       'رصيد مخزون بالسالب',
       now()
FROM public.pharmacy_stock_balances
WHERE quantity < 0
GROUP BY pharmacy_id;

COMMIT;
