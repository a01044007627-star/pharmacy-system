-- ===================================================================
-- PERFORMANCE: MISSING INDEXES, CONSTRAINTS, TRIGGERS & GIN INDEXES
-- Generated from schema audit — safe to run multiple times
-- Uses IF NOT EXISTS / DROP IF EXISTS throughout
-- ===================================================================

-- ===================================================================
-- 1. updated_at trigger function (standardised name)
-- ===================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ===================================================================
-- 2. Missing FK indexes: pharmacy_id on high-volume tables
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_sale_lines_pharmacy_id ON public.pharmacy_sale_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_movements_pharmacy_id ON public.pharmacy_stock_movements(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payments_pharmacy_id ON public.pharmacy_payments(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_notifications_pharmacy_id ON public.pharmacy_notifications(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_item_batches_pharmacy_id ON public.pharmacy_item_batches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchase_lines_pharmacy_id ON public.pharmacy_purchase_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_order_lines_pharmacy_id ON public.pharmacy_order_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_expenses_pharmacy_id ON public.pharmacy_expenses(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_journal_lines_pharmacy_id ON public.pharmacy_journal_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_activity_feed_pharmacy_id ON public.pharmacy_activity_feed(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_pharmacy_id ON public.pharmacy_audit_events(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_cash_registers_pharmacy_id ON public.pharmacy_cash_registers(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_pharmacy_id ON public.pharmacy_shifts(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_tasks_pharmacy_id ON public.pharmacy_tasks(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_pharmacy_id ON public.pharmacy_prescriptions(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_transfers_pharmacy_id ON public.pharmacy_stock_transfers(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_damaged_stock_pharmacy_id ON public.pharmacy_damaged_stock(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_counts_pharmacy_id ON public.pharmacy_stock_counts(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchase_orders_pharmacy_id ON public.pharmacy_purchase_orders(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_invoice_drafts_pharmacy_id ON public.pharmacy_invoice_drafts(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_suspended_invoices_pharmacy_id ON public.pharmacy_suspended_invoices(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_return_lines_pharmacy_id ON public.pharmacy_sales_return_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchase_return_lines_pharmacy_id ON public.pharmacy_purchase_return_lines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_loyalty_transactions_pharmacy_id ON public.pharmacy_loyalty_transactions(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_financial_movements_pharmacy_id ON public.pharmacy_financial_movements(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_controlled_drugs_log_pharmacy_id ON public.pharmacy_controlled_drugs_log(pharmacy_id);

-- ===================================================================
-- 3. Missing branch_id indexes
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_branch_id ON public.pharmacy_sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchases_branch_id ON public.pharmacy_purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_movements_branch_id ON public.pharmacy_stock_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_item_batches_branch_id ON public.pharmacy_item_batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_transfers_from_branch ON public.pharmacy_stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_transfers_to_branch ON public.pharmacy_stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_expenses_branch_id ON public.pharmacy_expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payments_branch_id ON public.pharmacy_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_branch_id ON public.pharmacy_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_cash_registers_branch_id ON public.pharmacy_cash_registers(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_branch_id ON public.pharmacy_shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_branch_id ON public.pharmacy_prescriptions(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_branch_id ON public.pharmacy_audit_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_tasks_branch_id ON public.pharmacy_tasks(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_journal_entries_branch_id ON public.pharmacy_journal_entries(branch_id);

-- ===================================================================
-- 4. Missing item_id indexes
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_movements_item_id ON public.pharmacy_stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_item_batches_item_id ON public.pharmacy_item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sale_lines_item_id ON public.pharmacy_sale_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchase_lines_item_id ON public.pharmacy_purchase_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_item_barcodes_item_id ON public.pharmacy_item_barcodes(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_item_variants_item_id ON public.pharmacy_item_variants(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_damaged_stock_item_id ON public.pharmacy_damaged_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_counts_item_id ON public.pharmacy_stock_counts(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_order_lines_item_id ON public.pharmacy_order_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_consignment_stock_item_id ON public.pharmacy_consignment_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_manufacturing_batches_product ON public.pharmacy_manufacturing_batches(product_item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_controlled_drugs_log_item_id ON public.pharmacy_controlled_drugs_log(item_id);

-- ===================================================================
-- 5. Missing created_by / user_id indexes
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_created_by ON public.pharmacy_sales(created_by);
CREATE INDEX IF NOT EXISTS idx_pharmacy_purchases_created_by ON public.pharmacy_purchases(created_by);
CREATE INDEX IF NOT EXISTS idx_pharmacy_stock_movements_created_by ON public.pharmacy_stock_movements(created_by);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payments_created_by ON public.pharmacy_payments(created_by);
CREATE INDEX IF NOT EXISTS idx_pharmacy_notifications_user_id ON public.pharmacy_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_activity_feed_user_id ON public.pharmacy_activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_user_sessions_user_id ON public.pharmacy_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_user_id ON public.pharmacy_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_attendance_employee_id ON public.pharmacy_attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_leave_employee_id ON public.pharmacy_leave(employee_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_financial_movements_created_by ON public.pharmacy_financial_movements(created_by);
CREATE INDEX IF NOT EXISTS idx_pharmacy_journal_entries_created_by ON public.pharmacy_journal_entries(created_by);

-- ===================================================================
-- 6. High-value composite indexes
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_items_group_status ON public.pharmacy_items(pharmacy_id, group_id, status);
CREATE INDEX IF NOT EXISTS idx_items_brand_status ON public.pharmacy_items(pharmacy_id, brand_id, status);
CREATE INDEX IF NOT EXISTS idx_items_expiry ON public.pharmacy_items(pharmacy_id, has_expiry, expiry_date);
CREATE INDEX IF NOT EXISTS idx_item_batches_expiry ON public.pharmacy_item_batches(pharmacy_id, item_id, branch_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_sales_date_branch ON public.pharmacy_sales(pharmacy_id, sale_date, branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.pharmacy_sales(pharmacy_id, customer_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.pharmacy_sales(pharmacy_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale_item ON public.pharmacy_sale_lines(sale_id, item_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.pharmacy_purchases(pharmacy_id, purchase_date, supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.pharmacy_purchases(pharmacy_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_branch ON public.pharmacy_stock_movements(pharmacy_id, item_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON public.pharmacy_stock_movements(pharmacy_id, source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_payments_source ON public.pharmacy_payments(pharmacy_id, source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.pharmacy_payments(pharmacy_id, payment_date, type);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON public.pharmacy_journal_entries(pharmacy_id, entry_date, branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.pharmacy_orders(pharmacy_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_registers_status ON public.pharmacy_cash_registers(pharmacy_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.pharmacy_notifications(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.pharmacy_prescriptions(pharmacy_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON public.pharmacy_sales(pharmacy_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch ON public.pharmacy_purchases(pharmacy_id, branch_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON public.pharmacy_purchase_lines(purchase_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_return ON public.pharmacy_sales_return_lines(return_id);

-- ===================================================================
-- 7. GIN indexes on important JSONB columns
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_permissions ON public.pharmacy_profiles USING GIN(permissions);
CREATE INDEX IF NOT EXISTS idx_notifications_data ON public.pharmacy_notifications USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_audit_events_metadata ON public.pharmacy_audit_events USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_saved_reports_config ON public.pharmacy_saved_reports USING GIN(config);

-- ===================================================================
-- 8. Trigram indexes for text search
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_items_search_text_trgm ON public.pharmacy_items USING GIN(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_items_name_ar_trgm ON public.pharmacy_items USING GIN(name_ar gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_partners_name_trgm ON public.pharmacy_partners USING GIN(name gin_trgm_ops);

-- ===================================================================
-- 9. Missing CHECK constraints
-- ===================================================================

ALTER TABLE public.pharmacy_tax_groups
  DROP CONSTRAINT IF EXISTS pharmacy_tax_groups_status_check,
  ADD CONSTRAINT pharmacy_tax_groups_status_check CHECK (status IN ('active','inactive')) NOT VALID;

ALTER TABLE public.pharmacy_tax_rates
  DROP CONSTRAINT IF EXISTS pharmacy_tax_rates_status_check,
  ADD CONSTRAINT pharmacy_tax_rates_status_check CHECK (status IN ('active','inactive')) NOT VALID;

ALTER TABLE public.pharmacy_invoice_designs
  DROP CONSTRAINT IF EXISTS pharmacy_invoice_designs_status_check,
  ADD CONSTRAINT pharmacy_invoice_designs_status_check CHECK (status IN ('active','inactive')) NOT VALID;

ALTER TABLE public.pharmacy_receipt_printers
  DROP CONSTRAINT IF EXISTS pharmacy_receipt_printers_status_check,
  ADD CONSTRAINT pharmacy_receipt_printers_status_check CHECK (status IN ('active','inactive')) NOT VALID;

ALTER TABLE public.pharmacy_notification_templates
  DROP CONSTRAINT IF EXISTS pharmacy_notification_templates_status_check,
  ADD CONSTRAINT pharmacy_notification_templates_status_check CHECK (status IN ('active','inactive')) NOT VALID;

ALTER TABLE public.pharmacy_damaged_stock
  DROP CONSTRAINT IF EXISTS pharmacy_damaged_stock_status_check,
  ADD CONSTRAINT pharmacy_damaged_stock_status_check CHECK (status IN ('posted','approved','rejected')) NOT VALID;

ALTER TABLE public.pharmacy_stock_counts
  DROP CONSTRAINT IF EXISTS pharmacy_stock_counts_status_check,
  ADD CONSTRAINT pharmacy_stock_counts_status_check CHECK (status IN ('draft','posted','approved','cancelled')) NOT VALID;

ALTER TABLE public.pharmacy_backups
  DROP CONSTRAINT IF EXISTS pharmacy_backups_type_check,
  ADD CONSTRAINT pharmacy_backups_type_check CHECK (type IN ('manual','automatic','scheduled')) NOT VALID;

ALTER TABLE public.pharmacy_backups
  DROP CONSTRAINT IF EXISTS pharmacy_backups_status_check,
  ADD CONSTRAINT pharmacy_backups_status_check CHECK (status IN ('created','completed','failed','restored')) NOT VALID;

ALTER TABLE public.pharmacy_purchase_orders
  DROP CONSTRAINT IF EXISTS pharmacy_purchase_orders_status_check,
  ADD CONSTRAINT pharmacy_purchase_orders_status_check CHECK (status IN ('draft','sent','partial','received','cancelled')) NOT VALID;

-- ===================================================================
-- 10. Apply updated_at trigger to all tables that have the column
-- ===================================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'pharmacies','pharmacy_branches','user_profiles','pharmacy_profiles',
      'pharmacy_partners','pharmacy_customer_addresses','pharmacy_item_groups',
      'pharmacy_item_brands','pharmacy_items','pharmacy_item_units',
      'pharmacy_item_barcodes','pharmacy_item_batches','pharmacy_stock_balances',
      'pharmacy_stock_transfers','pharmacy_damaged_stock','pharmacy_stock_counts',
      'pharmacy_sales','pharmacy_sales_returns','pharmacy_suspended_invoices',
      'pharmacy_invoice_drafts','pharmacy_purchases','pharmacy_purchase_returns',
      'pharmacy_purchase_orders','pharmacy_expense_categories','pharmacy_expenses',
      'pharmacy_orders','pharmacy_coupons','pharmacy_bundles',
      'pharmacy_chart_of_accounts','pharmacy_journal_entries','pharmacy_account_balances',
      'pharmacy_tax_groups','pharmacy_barcode_label_sheets','pharmacy_cash_registers',
      'pharmacy_shifts','pharmacy_loyalty_points','pharmacy_loyalty_balances',
      'pharmacy_loyalty_transactions','pharmacy_manufacturing_recipes',
      'pharmacy_manufacturing_batches','pharmacy_consignment_stock',
      'pharmacy_employees','pharmacy_attendance','pharmacy_leave',
      'pharmacy_employee_shifts','pharmacy_saved_reports','pharmacy_document_drafts',
      'pharmacy_payment_links','pharmacy_settings','pharmacy_tax_rates',
      'pharmacy_invoice_designs','pharmacy_barcode_paper_settings',
      'pharmacy_receipt_printers','pharmacy_notification_templates',
      'pharmacy_backups','pharmacy_tasks','pharmacy_price_groups',
      'pharmacy_prescriptions','pharmacy_units','pharmacy_user_sessions',
      'pharmacy_sms_log','pharmacy_notifications','pharmacy_inapp_notifications',
      'pharmacy_activity_feed','pharmacy_audit_events','pharmacy_import_logs',
      'pharmacy_api_tokens','pharmacy_deleted_items_audit',
      'pharmacy_inventory_snapshots','pharmacy_stock_movements',
      'pharmacy_sale_lines','pharmacy_purchase_lines','pharmacy_order_lines',
      'pharmacy_journal_lines','pharmacy_financial_movements',
      'pharmacy_bundle_items','pharmacy_recipe_ingredients',
      'pharmacy_controlled_drugs_log','pharmacy_prescriptions','pharmacy_price_groups',
      'developer_users','developer_feature_flags','developer_release_versions',
      'developer_maintenance_tasks','developer_module_registry',
      'developer_permission_matrix','developer_table_registry',
      'developer_access_logs','developer_audit_events','developer_deployments',
      'developer_backup_snapshots','developer_error_events','developer_sql_sync_issues'
    ])
  LOOP
    CONTINUE WHEN to_regclass('public.' || tbl) IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'updated_at'
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I; CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;
