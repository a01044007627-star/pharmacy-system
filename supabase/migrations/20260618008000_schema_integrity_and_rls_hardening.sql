-- Final schema integrity hardening.
-- This migration is safe for existing databases: CHECK/FK constraints are
-- added NOT VALID, which protects new writes without blocking deployment on
-- legacy rows. Existing rows can be audited then validated separately.

-- -------------------------------------------------------------------
-- 1) Canonical status and non-negative value constraints
-- -------------------------------------------------------------------

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

-- -------------------------------------------------------------------
-- 2) Uniqueness rules that model actual business invariants
-- -------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_branches
    WHERE is_default = true AND status <> 'closed'
    GROUP BY pharmacy_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_one_default_per_pharmacy
      ON public.pharmacy_branches(pharmacy_id)
      WHERE is_default = true AND status <> 'closed';
  ELSE
    RAISE WARNING 'Skipped idx_branches_one_default_per_pharmacy: duplicate default branches need cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_item_barcodes
    WHERE is_primary = true
    GROUP BY pharmacy_id, item_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_item_one_primary_barcode
      ON public.pharmacy_item_barcodes(pharmacy_id, item_id)
      WHERE is_primary = true;
  ELSE
    RAISE WARNING 'Skipped idx_item_one_primary_barcode: duplicate primary barcodes need cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_shifts
    WHERE status = 'open'
    GROUP BY pharmacy_id, branch_id, user_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_user_branch
      ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id)
      WHERE status = 'open';
  ELSE
    RAISE WARNING 'Skipped idx_shifts_one_open_per_user_branch: duplicate open shifts need cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_sales_return_lines
    WHERE sale_line_id IS NOT NULL
    GROUP BY return_id, sale_line_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_return_line_unique_source
      ON public.pharmacy_sales_return_lines(return_id, sale_line_id)
      WHERE sale_line_id IS NOT NULL;
  ELSE
    RAISE WARNING 'Skipped idx_sales_return_line_unique_source: duplicate return source lines need cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_purchase_lines
    WHERE batch_id IS NOT NULL
    GROUP BY purchase_id, batch_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_line_unique_batch
      ON public.pharmacy_purchase_lines(purchase_id, batch_id)
      WHERE batch_id IS NOT NULL;
  ELSE
    RAISE WARNING 'Skipped idx_purchase_line_unique_batch: duplicate purchase batch lines need cleanup';
  END IF;
END;
$$;

-- Composite unique keys allow same-tenant foreign keys below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_id_pharmacy ON public.pharmacy_branches(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partners_id_pharmacy ON public.pharmacy_partners(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_id_pharmacy ON public.pharmacy_items(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_id_pharmacy ON public.pharmacy_item_batches(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_id_pharmacy ON public.pharmacy_sales(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_lines_id_pharmacy ON public.pharmacy_sale_lines(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_returns_id_pharmacy ON public.pharmacy_sales_returns(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_id_pharmacy ON public.pharmacy_purchases(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_lines_id_pharmacy ON public.pharmacy_purchase_lines(id, pharmacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_returns_id_pharmacy ON public.pharmacy_purchase_returns(id, pharmacy_id);

-- -------------------------------------------------------------------
-- 3) Same-tenant relational integrity
-- -------------------------------------------------------------------

DO $$
DECLARE
  relation RECORD;
BEGIN
  FOR relation IN
    SELECT *
    FROM (VALUES
      ('pharmacy_items', 'fk_items_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_item_batches', 'fk_batches_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_item_batches', 'fk_batches_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_stock_balances', 'fk_stock_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_stock_balances', 'fk_stock_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_stock_movements', 'fk_movements_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_stock_movements', 'fk_movements_batch_same_pharmacy', 'batch_id', 'pharmacy_item_batches'),
      ('pharmacy_stock_movements', 'fk_movements_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_sales', 'fk_sales_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_sales', 'fk_sales_customer_same_pharmacy', 'customer_id', 'pharmacy_partners'),
      ('pharmacy_sale_lines', 'fk_sale_lines_sale_same_pharmacy', 'sale_id', 'pharmacy_sales'),
      ('pharmacy_sale_lines', 'fk_sale_lines_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_sale_lines', 'fk_sale_lines_batch_same_pharmacy', 'batch_id', 'pharmacy_item_batches'),
      ('pharmacy_sales_returns', 'fk_sales_returns_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_sales_returns', 'fk_sales_returns_sale_same_pharmacy', 'sale_id', 'pharmacy_sales'),
      ('pharmacy_sales_return_lines', 'fk_sales_return_lines_return_same_pharmacy', 'return_id', 'pharmacy_sales_returns'),
      ('pharmacy_sales_return_lines', 'fk_sales_return_lines_sale_line_same_pharmacy', 'sale_line_id', 'pharmacy_sale_lines'),
      ('pharmacy_sales_return_lines', 'fk_sales_return_lines_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_sales_return_lines', 'fk_sales_return_lines_batch_same_pharmacy', 'batch_id', 'pharmacy_item_batches'),
      ('pharmacy_purchases', 'fk_purchases_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_purchases', 'fk_purchases_supplier_same_pharmacy', 'supplier_id', 'pharmacy_partners'),
      ('pharmacy_purchase_lines', 'fk_purchase_lines_purchase_same_pharmacy', 'purchase_id', 'pharmacy_purchases'),
      ('pharmacy_purchase_lines', 'fk_purchase_lines_item_same_pharmacy', 'item_id', 'pharmacy_items'),
      ('pharmacy_purchase_lines', 'fk_purchase_lines_batch_same_pharmacy', 'batch_id', 'pharmacy_item_batches'),
      ('pharmacy_purchase_returns', 'fk_purchase_returns_branch_same_pharmacy', 'branch_id', 'pharmacy_branches'),
      ('pharmacy_purchase_returns', 'fk_purchase_returns_purchase_same_pharmacy', 'purchase_id', 'pharmacy_purchases'),
      ('pharmacy_purchase_return_lines', 'fk_purchase_return_lines_return_same_pharmacy', 'return_id', 'pharmacy_purchase_returns'),
      ('pharmacy_purchase_return_lines', 'fk_purchase_return_lines_item_same_pharmacy', 'item_id', 'pharmacy_items')
    ) AS refs(table_name, constraint_name, column_name, reference_table)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = relation.table_name
        AND column_name = relation.column_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = relation.constraint_name
        AND conrelid = format('public.%I', relation.table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, pharmacy_id) REFERENCES public.%I(id, pharmacy_id) NOT VALID',
        relation.table_name,
        relation.constraint_name,
        relation.column_name,
        relation.reference_table
      );
    END IF;
  END LOOP;
END;
$$;

-- -------------------------------------------------------------------
-- 4) Permission-aware RLS for purchases and financial records
-- -------------------------------------------------------------------

DO $$
DECLARE
  tbl TEXT;
  has_branch BOOLEAN;
  branch_guard TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_purchases',
    'pharmacy_purchase_lines',
    'pharmacy_purchase_returns',
    'pharmacy_purchase_return_lines',
    'pharmacy_purchase_orders'
  ]
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'branch_id'
    ) INTO has_branch;
    branch_guard := CASE WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)' ELSE '' END;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, ''purchases:write'')%s)',
      tbl, branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.user_has_permission(pharmacy_id, ''purchases:write'')%s) WITH CHECK (public.user_has_permission(pharmacy_id, ''purchases:write'')%s)',
      tbl, branch_guard, branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''purchases:void''))',
      tbl
    );
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_expenses',
    'pharmacy_payments',
    'pharmacy_payment_allocations',
    'pharmacy_financial_movements',
    'pharmacy_cash_registers',
    'pharmacy_register_transactions'
  ]
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'branch_id'
    ) INTO has_branch;
    branch_guard := CASE WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)' ELSE '' END;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, ''financials:write'')%s)',
      tbl, branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.user_has_permission(pharmacy_id, ''financials:write'')%s) WITH CHECK (public.user_has_permission(pharmacy_id, ''financials:write'')%s)',
      tbl, branch_guard, branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''financials:write''))',
      tbl
    );
  END LOOP;
END;
$$;

-- -------------------------------------------------------------------
-- 5) Performance indexes for current API access patterns
-- -------------------------------------------------------------------

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

-- -------------------------------------------------------------------
-- 6) Fail fast if the migration chain did not produce the expected core
--    schema. This catches partial/manual upload orders immediately.
-- -------------------------------------------------------------------

DO $$
DECLARE
  required_column RECORD;
BEGIN
  FOR required_column IN
    SELECT *
    FROM (VALUES
      ('pharmacy_profiles', 'permissions'),
      ('pharmacy_profiles', 'denied_permissions'),
      ('pharmacy_sales', 'shift_id'),
      ('pharmacy_sales', 'client_request_id'),
      ('pharmacy_sale_lines', 'batch_id'),
      ('pharmacy_sales_returns', 'client_request_id'),
      ('pharmacy_sales_return_lines', 'sale_line_id'),
      ('pharmacy_sales_return_lines', 'batch_id'),
      ('pharmacy_purchases', 'client_request_id'),
      ('pharmacy_purchase_lines', 'batch_id'),
      ('pharmacy_purchase_lines', 'batch_number'),
      ('pharmacy_purchase_lines', 'expiry_date'),
      ('pharmacy_purchase_lines', 'created_at'),
      ('pharmacy_item_batches', 'remaining_quantity'),
      ('pharmacy_stock_movements', 'movement_type'),
      ('pharmacy_stock_movements', 'source_id')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = required_column.table_name
        AND column_name = required_column.column_name
    ) THEN
      RAISE EXCEPTION 'Migration chain is incomplete: missing %.%',
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;
END;
$$;
