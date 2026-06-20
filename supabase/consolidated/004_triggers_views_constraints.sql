-- ===================================================================
-- CONSOLIDATED: TRIGGERS, VIEWS, CONSTRAINTS & INDEXES
-- Source: migrations 20260617xxxxx → 20260618xxxxx
--
-- This file is idempotent: all DROP/CREATE IF NOT EXISTS patterns
-- are safe to run multiple times on the same database.
-- ===================================================================

-- ===================================================================
-- 1. HELPER FUNCTIONS
-- ===================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_pharmacy_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.fn_archive_deleted_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.pharmacy_inapp_deleted_notifications (
      user_id,
      original_id,
      title,
      description,
      notif_type,
      href,
      was_read,
      created_at,
      deleted_by
    ) VALUES (
      NEW.user_id,
      NEW.id,
      NEW.title,
      NEW.description,
      NEW.notif_type,
      NEW.href,
      NEW.read,
      NEW.created_at,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_project_name TEXT;
  v_currency TEXT;
  v_country TEXT;
  v_timezone TEXT;
  v_city TEXT;
  v_pharmacy_id UUID;
  v_branch_id UUID;
BEGIN
  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'display_name', ''), split_part(NEW.email, '@', 1));
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.raw_user_meta_data->>'mobile', ''));
  v_role := CASE
    WHEN lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN 'developer'
    WHEN COALESCE(NEW.raw_user_meta_data->>'role', '') IN (
      'owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'
    ) THEN NEW.raw_user_meta_data->>'role'
    ELSE 'owner'
  END;

  v_project_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'project_name', ''), NULLIF(NEW.raw_user_meta_data->>'pharmacy_name', ''), v_full_name, NEW.email, 'صيدلية جديدة');
  v_currency := COALESCE(NULLIF(NEW.raw_user_meta_data->>'currency', ''), 'EGP');
  v_country := COALESCE(NULLIF(NEW.raw_user_meta_data->>'country', ''), 'EG');
  v_timezone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'timezone', ''), 'Africa/Cairo');
  v_city := NULLIF(NEW.raw_user_meta_data->>'city', '');

  INSERT INTO public.user_profiles (user_id, email, username, full_name, phone, avatar_url, global_role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    v_full_name,
    v_phone,
    NEW.raw_user_meta_data->>'avatar_url',
    v_role,
    true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(EXCLUDED.username, public.user_profiles.username),
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.user_profiles.phone),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    global_role = EXCLUDED.global_role,
    is_active = true,
    updated_at = now();

  IF v_role = 'developer' THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();

    DELETE FROM public.pharmacy_profiles WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  IF v_role = 'owner' THEN
    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (NEW.id, v_project_name, v_project_name, v_currency, v_country, v_timezone, v_phone, NEW.email, v_city, 'active', 'trial')
    ON CONFLICT (owner_id) DO UPDATE SET
      status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
      updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', v_city, v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET
      is_default = true,
      status = 'active',
      updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
    VALUES (v_pharmacy_id, v_branch_id, NEW.id, NEW.email, v_full_name, v_phone, 'صاحب الصيدلية', 'owner', true, '[]'::jsonb, '[]'::jsonb, 'created')
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
      branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
      email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
      full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
      phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
      title = 'صاحب الصيدلية',
      role = 'owner',
      is_active = true,
      disabled_reason = NULL,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- ===================================================================
-- 2. TRIGGERS
-- ===================================================================

-- Auth user creation
DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Notification archive on soft-delete
DROP TRIGGER IF EXISTS trg_archive_deleted_notification ON public.pharmacy_inapp_notifications;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pharmacy_inapp_notifications'
  ) THEN
    CREATE TRIGGER trg_archive_deleted_notification
      BEFORE UPDATE OF deleted_at ON public.pharmacy_inapp_notifications
      FOR EACH ROW
      WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
      EXECUTE FUNCTION public.fn_archive_deleted_notification();
  END IF;
END;
$$;

-- Updated-at touch triggers
DROP TRIGGER IF EXISTS touch_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER touch_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacy_profiles_updated_at ON public.pharmacy_profiles;
CREATE TRIGGER touch_pharmacy_profiles_updated_at
BEFORE UPDATE ON public.pharmacy_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacies_updated_at ON public.pharmacies;
CREATE TRIGGER touch_pharmacies_updated_at
BEFORE UPDATE ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacy_branches_updated_at ON public.pharmacy_branches;
CREATE TRIGGER touch_pharmacy_branches_updated_at
BEFORE UPDATE ON public.pharmacy_branches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_settings_updated_at ON public.pharmacy_settings;
CREATE TRIGGER trg_pharmacy_settings_updated_at
BEFORE UPDATE ON public.pharmacy_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_pharmacy_settings_updated_at();

-- Touch triggers for settings module tables
DROP TRIGGER IF EXISTS trg_pharmacy_tax_rates_updated_at ON public.pharmacy_tax_rates;
CREATE TRIGGER trg_pharmacy_tax_rates_updated_at
BEFORE UPDATE ON public.pharmacy_tax_rates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_tax_groups_updated_at ON public.pharmacy_tax_groups;
CREATE TRIGGER trg_pharmacy_tax_groups_updated_at
BEFORE UPDATE ON public.pharmacy_tax_groups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_invoice_designs_updated_at ON public.pharmacy_invoice_designs;
CREATE TRIGGER trg_pharmacy_invoice_designs_updated_at
BEFORE UPDATE ON public.pharmacy_invoice_designs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_barcode_paper_settings_updated_at ON public.pharmacy_barcode_paper_settings;
CREATE TRIGGER trg_pharmacy_barcode_paper_settings_updated_at
BEFORE UPDATE ON public.pharmacy_barcode_paper_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_receipt_printers_updated_at ON public.pharmacy_receipt_printers;
CREATE TRIGGER trg_pharmacy_receipt_printers_updated_at
BEFORE UPDATE ON public.pharmacy_receipt_printers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_notification_templates_updated_at ON public.pharmacy_notification_templates;
CREATE TRIGGER trg_pharmacy_notification_templates_updated_at
BEFORE UPDATE ON public.pharmacy_notification_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_backups_updated_at ON public.pharmacy_backups;
CREATE TRIGGER trg_pharmacy_backups_updated_at
BEFORE UPDATE ON public.pharmacy_backups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Daily summary date sync trigger
DROP TRIGGER IF EXISTS trg_pharmacy_daily_summary_dates ON public.pharmacy_daily_summary;
CREATE TRIGGER trg_pharmacy_daily_summary_dates
BEFORE INSERT OR UPDATE ON public.pharmacy_daily_summary
FOR EACH ROW EXECUTE FUNCTION public.sync_pharmacy_daily_summary_dates();

-- ===================================================================
-- 3. VIEW
-- ===================================================================

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

-- ===================================================================
-- 4. CHECK CONSTRAINTS
-- ===================================================================

ALTER TABLE public.pharmacy_branches
  DROP CONSTRAINT IF EXISTS pharmacy_branches_status_check,
  ADD CONSTRAINT pharmacy_branches_status_check
    CHECK (status IN ('active', 'inactive', 'closed')) NOT VALID;

ALTER TABLE public.pharmacy_items
  DROP CONSTRAINT IF EXISTS pharmacy_items_status_check,
  ADD CONSTRAINT pharmacy_items_status_check
    CHECK (status IN ('active', 'inactive', 'archived', 'deleted')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_items_prices_check,
  ADD CONSTRAINT pharmacy_items_prices_check
    CHECK (
      buy_price >= 0
      AND sell_price >= 0
      AND old_sell_price >= 0
      AND COALESCE(min_stock, 0) >= 0
      AND COALESCE(max_stock, 0) >= 0
      AND COALESCE(opening_stock, 0) >= 0
    ) NOT VALID;

ALTER TABLE public.pharmacy_item_batches
  DROP CONSTRAINT IF EXISTS pharmacy_item_batches_quantities_check,
  ADD CONSTRAINT pharmacy_item_batches_quantities_check
    CHECK (
      quantity >= 0
      AND remaining_quantity >= 0
      AND remaining_quantity <= quantity
      AND COALESCE(cost_price, 0) >= 0
    ) NOT VALID;

ALTER TABLE public.pharmacy_stock_balances
  DROP CONSTRAINT IF EXISTS pharmacy_stock_balances_quantity_check,
  ADD CONSTRAINT pharmacy_stock_balances_quantity_check
    CHECK (quantity >= 0) NOT VALID;

ALTER TABLE public.pharmacy_stock_movements
  DROP CONSTRAINT IF EXISTS pharmacy_stock_movements_values_check,
  ADD CONSTRAINT pharmacy_stock_movements_values_check
    CHECK (quantity > 0 AND unit_price >= 0 AND total_value >= 0) NOT VALID;

ALTER TABLE public.pharmacy_sales
  DROP CONSTRAINT IF EXISTS pharmacy_sales_status_check,
  ADD CONSTRAINT pharmacy_sales_status_check
    CHECK (status IN ('draft', 'invoice', 'completed', 'returned', 'partial_return', 'void', 'cancelled')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_sales_payment_status_check,
  ADD CONSTRAINT pharmacy_sales_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_sales_totals_check,
  ADD CONSTRAINT pharmacy_sales_totals_check
    CHECK (
      subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
      AND total >= 0 AND paid_amount >= 0 AND due_amount >= 0
      AND COALESCE(shipping_fee, 0) >= 0
    ) NOT VALID;

ALTER TABLE public.pharmacy_sale_lines
  DROP CONSTRAINT IF EXISTS pharmacy_sale_lines_values_check,
  ADD CONSTRAINT pharmacy_sale_lines_values_check
    CHECK (
      quantity > 0 AND unit_price >= 0 AND COALESCE(purchase_price, 0) >= 0
      AND discount >= 0 AND net_total >= 0
      AND discount <= quantity * unit_price
    ) NOT VALID;

ALTER TABLE public.pharmacy_sales_returns
  DROP CONSTRAINT IF EXISTS pharmacy_sales_returns_totals_check,
  ADD CONSTRAINT pharmacy_sales_returns_totals_check
    CHECK (total >= 0 AND refund_amount >= 0 AND refund_amount <= total) NOT VALID;

ALTER TABLE public.pharmacy_sales_return_lines
  DROP CONSTRAINT IF EXISTS pharmacy_sales_return_lines_values_check,
  ADD CONSTRAINT pharmacy_sales_return_lines_values_check
    CHECK (quantity > 0 AND unit_price >= 0 AND total >= 0) NOT VALID;

ALTER TABLE public.pharmacy_purchases
  DROP CONSTRAINT IF EXISTS pharmacy_purchases_status_check,
  ADD CONSTRAINT pharmacy_purchases_status_check
    CHECK (status IN ('draft', 'pending', 'ordered', 'received', 'partial_return', 'returned', 'void', 'cancelled')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_purchases_payment_status_check,
  ADD CONSTRAINT pharmacy_purchases_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_purchases_totals_check,
  ADD CONSTRAINT pharmacy_purchases_totals_check
    CHECK (
      subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
      AND total >= 0 AND paid_amount >= 0 AND due_amount >= 0
      AND COALESCE(shipping_fee, 0) >= 0
    ) NOT VALID;

ALTER TABLE public.pharmacy_purchase_lines
  DROP CONSTRAINT IF EXISTS pharmacy_purchase_lines_values_check,
  ADD CONSTRAINT pharmacy_purchase_lines_values_check
    CHECK (
      quantity > 0 AND buy_price >= 0 AND sell_price >= 0
      AND discount >= 0 AND net_total >= 0
      AND discount <= quantity * buy_price
    ) NOT VALID;

ALTER TABLE public.pharmacy_purchase_returns
  DROP CONSTRAINT IF EXISTS pharmacy_purchase_returns_totals_check,
  ADD CONSTRAINT pharmacy_purchase_returns_totals_check
    CHECK (total >= 0 AND refund_amount >= 0 AND refund_amount <= total) NOT VALID;

ALTER TABLE public.pharmacy_purchase_return_lines
  DROP CONSTRAINT IF EXISTS pharmacy_purchase_return_lines_values_check,
  ADD CONSTRAINT pharmacy_purchase_return_lines_values_check
    CHECK (quantity > 0 AND buy_price >= 0 AND total >= 0) NOT VALID;

ALTER TABLE public.pharmacy_expenses
  DROP CONSTRAINT IF EXISTS pharmacy_expenses_totals_check,
  ADD CONSTRAINT pharmacy_expenses_totals_check
    CHECK (amount >= 0 AND tax_amount >= 0 AND total >= 0) NOT VALID;

ALTER TABLE public.pharmacy_payments
  DROP CONSTRAINT IF EXISTS pharmacy_payments_amount_check,
  ADD CONSTRAINT pharmacy_payments_amount_check CHECK (amount > 0) NOT VALID;

ALTER TABLE public.pharmacy_payment_allocations
  DROP CONSTRAINT IF EXISTS pharmacy_payment_allocations_amount_check,
  ADD CONSTRAINT pharmacy_payment_allocations_amount_check CHECK (amount > 0) NOT VALID;

ALTER TABLE public.pharmacy_financial_movements
  DROP CONSTRAINT IF EXISTS pharmacy_financial_movements_amount_check,
  ADD CONSTRAINT pharmacy_financial_movements_amount_check CHECK (amount > 0) NOT VALID;

ALTER TABLE public.pharmacy_register_transactions
  DROP CONSTRAINT IF EXISTS pharmacy_register_transactions_amount_check,
  ADD CONSTRAINT pharmacy_register_transactions_amount_check CHECK (amount > 0) NOT VALID;

ALTER TABLE public.pharmacy_partners
  DROP CONSTRAINT IF EXISTS pharmacy_partners_credit_check,
  ADD CONSTRAINT pharmacy_partners_credit_check
    CHECK (credit_limit >= 0) NOT VALID;

-- ===================================================================
-- 5. COMPOSITE FK CONSTRAINTS (_tenant suffix, final version)
-- ===================================================================

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

-- ===================================================================
-- 6. INDEXES
-- ===================================================================

-- 6a) Composite unique indexes for tenant-safe FK references (final ux_* versions)
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

-- 6b) Business-rule unique indexes (conditional + unconditional)

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_default_branch_per_pharmacy
  ON public.pharmacy_branches(pharmacy_id)
  WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_primary_barcode_per_item
  ON public.pharmacy_item_barcodes(pharmacy_id, item_id)
  WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_base_unit_per_item
  ON public.pharmacy_item_units(pharmacy_id, item_id)
  WHERE is_base = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_shifts_one_open_per_cashier_branch
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number
  ON public.pharmacy_purchase_orders(pharmacy_id, order_number)
  WHERE order_number IS NOT NULL AND order_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_units_name
  ON public.pharmacy_units(pharmacy_id, unit_name);

-- Unique indexes for sale_return_line and purchase_line batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_return_line_unique_source
  ON public.pharmacy_sales_return_lines(return_id, sale_line_id)
  WHERE sale_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_line_unique_batch
  ON public.pharmacy_purchase_lines(purchase_id, batch_id)
  WHERE batch_id IS NOT NULL;

-- 6c) Performance indexes

CREATE INDEX IF NOT EXISTS idx_sales_active_pharmacy_branch_date
  ON public.pharmacy_sales(pharmacy_id, branch_id, sale_date DESC)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_active_pharmacy_branch_date
  ON public.pharmacy_purchases(pharmacy_id, branch_id, purchase_date DESC)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_returns_sale_active
  ON public.pharmacy_sales_returns(pharmacy_id, sale_id, return_date DESC)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_item_batches_fefo
  ON public.pharmacy_item_batches(pharmacy_id, branch_id, item_id, expiry_date, created_at)
  WHERE remaining_quantity > 0;

CREATE INDEX IF NOT EXISTS idx_partners_type_status_name
  ON public.pharmacy_partners(pharmacy_id, type, status, name);

CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_open_user
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id, status, opened_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_shift_id
  ON public.pharmacy_sales(shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_summary_summary_date
  ON public.pharmacy_daily_summary(pharmacy_id, branch_id, summary_date);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch_date
  ON public.pharmacy_purchase_orders(pharmacy_id, branch_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_notif_user_created
  ON public.pharmacy_inapp_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_active
  ON public.pharmacy_inapp_notifications(user_id, read, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inapp_deleted_notif_user
  ON public.pharmacy_inapp_deleted_notifications(user_id, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_lookup
  ON public.pharmacy_settings(pharmacy_id, key);

CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_updated
  ON public.pharmacy_settings(pharmacy_id, updated_at DESC);

DROP INDEX IF EXISTS idx_pharmacy_settings_global_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_settings_global_key
  ON public.pharmacy_settings(key)
  WHERE pharmacy_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_client_request
  ON public.pharmacy_purchase_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_purchase_line
  ON public.pharmacy_purchase_return_lines(pharmacy_id, purchase_line_id);

CREATE INDEX IF NOT EXISTS idx_tasks_pharmacy
  ON public.pharmacy_tasks(pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_completed
  ON public.pharmacy_tasks(pharmacy_id, completed);

CREATE INDEX IF NOT EXISTS idx_pharmacy_price_groups_pharmacy
  ON public.pharmacy_price_groups(pharmacy_id, status, name);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_pharmacy
  ON public.pharmacy_prescriptions(pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_patient
  ON public.pharmacy_prescriptions(pharmacy_id, patient_name);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_scope_status
  ON public.pharmacy_stock_transfers(pharmacy_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_counts_scope_status
  ON public.pharmacy_stock_counts(pharmacy_id, branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_sub_category
  ON public.pharmacy_items(pharmacy_id, lower(sub_category));

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_storage_location
  ON public.pharmacy_items(pharmacy_id, rack, shelf_row, position);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_product_type
  ON public.pharmacy_items(pharmacy_id, product_type);

CREATE INDEX IF NOT EXISTS idx_item_variants_sku
  ON public.pharmacy_item_variants(pharmacy_id, sku)
  WHERE sku IS NOT NULL AND sku <> '';

CREATE INDEX IF NOT EXISTS idx_item_units_item_equation
  ON public.pharmacy_item_units(pharmacy_id, item_id, is_base, factor);


CREATE INDEX IF NOT EXISTS idx_purchases_supplier_lookup
  ON public.pharmacy_purchases(pharmacy_id, supplier_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_partner_lookup
  ON public.pharmacy_payments(pharmacy_id, partner_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_units_lookup
  ON public.pharmacy_units(pharmacy_id, unit_name)
  WHERE is_active = true;

-- Module indexes for settings tables
CREATE INDEX IF NOT EXISTS idx_pharmacy_tax_rates_scope ON public.pharmacy_tax_rates(pharmacy_id, status, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_tax_group_members_group ON public.pharmacy_tax_group_members(pharmacy_id, group_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_invoice_designs_scope ON public.pharmacy_invoice_designs(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_barcode_paper_scope ON public.pharmacy_barcode_paper_settings(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_receipt_printers_scope ON public.pharmacy_receipt_printers(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_notification_templates_scope ON public.pharmacy_notification_templates(pharmacy_id, scenario, channel);
CREATE INDEX IF NOT EXISTS idx_pharmacy_backups_scope ON public.pharmacy_backups(pharmacy_id, created_at DESC) WHERE deleted_at IS NULL;

-- Auth/profile indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_developer_users_user_id ON public.developer_users(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_branch_id ON public.pharmacy_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_role ON public.pharmacy_profiles(role);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_active ON public.pharmacy_profiles(pharmacy_id, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_role ON public.pharmacy_profiles(pharmacy_id, role, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_branch ON public.pharmacy_profiles(pharmacy_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_permissions ON public.pharmacy_profiles USING GIN (permissions);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_denied_permissions ON public.pharmacy_profiles USING GIN (denied_permissions);
CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_profiles_pharmacy_id_user_id_key ON public.pharmacy_profiles(pharmacy_id, user_id);
