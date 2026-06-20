-- ===== 000_core_tables.sql =====
-- ===================================================================
-- PHARMACY SYSTEM - CONSOLIDATED CORE TABLES
-- Generated from all migration files (20260617-20260618)
-- Uses CREATE TABLE IF NOT EXISTS + consolidated ALTER TABLE ADD COLUMN
-- ===================================================================

-- ========================
-- 0. EXTENSIONS
-- ========================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ========================
-- 1. CORE / TENANCY
-- ========================
CREATE TABLE IF NOT EXISTS pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  commercial_registry TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  plan TEXT DEFAULT 'trial' NOT NULL,
  currency TEXT DEFAULT 'EGP' NOT NULL,
  country TEXT DEFAULT 'EG',
  timezone TEXT DEFAULT 'Africa/Cairo',
  logo_url TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  subscription_ends_at TIMESTAMPTZ,
  max_branches INTEGER NOT NULL DEFAULT 3,
  max_users INTEGER NOT NULL DEFAULT 10,
  developer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id)
);

ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT 3;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 10;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS pharmacies_status_check;
ALTER TABLE pharmacies ADD CONSTRAINT pharmacies_status_check CHECK(status IN ('active','suspended','closed'));
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS pharmacies_plan_check;
ALTER TABLE pharmacies ADD CONSTRAINT pharmacies_plan_check CHECK(plan IN ('trial','starter','professional','enterprise'));
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS pharmacies_limits_check;
ALTER TABLE pharmacies ADD CONSTRAINT pharmacies_limits_check CHECK(max_branches > 0 AND max_users > 0);

CREATE TABLE IF NOT EXISTS pharmacy_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_name TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

-- pharmacy_branches CHECK constraints from 20260618008000
ALTER TABLE pharmacy_branches DROP CONSTRAINT IF EXISTS pharmacy_branches_status_check;
ALTER TABLE pharmacy_branches ADD CONSTRAINT pharmacy_branches_status_check
  CHECK (status IN ('active', 'inactive', 'closed')) NOT VALID;

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  global_role TEXT NOT NULL DEFAULT 'no-access',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_global_role_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_global_role_check
  CHECK (global_role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE TABLE IF NOT EXISTS pharmacy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'cashier',
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, user_id)
);

ALTER TABLE pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS denied_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'linked',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

ALTER TABLE pharmacy_profiles
  ALTER COLUMN permissions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN permissions SET NOT NULL;

ALTER TABLE pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK (role IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

ALTER TABLE pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_invite_status_check;
ALTER TABLE pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_invite_status_check
  CHECK (invite_status IN ('created','invited','linked','pending','accepted','disabled'));

-- ========================
-- 2. PARTNERS (Customers + Suppliers unified)
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_limit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_partners DROP CONSTRAINT IF EXISTS pharmacy_partners_type_check;
ALTER TABLE pharmacy_partners ADD CONSTRAINT pharmacy_partners_type_check CHECK(type IN ('customer','supplier','both'));
ALTER TABLE pharmacy_partners DROP CONSTRAINT IF EXISTS pharmacy_partners_status_check;
ALTER TABLE pharmacy_partners ADD CONSTRAINT pharmacy_partners_status_check CHECK(status IN ('active','inactive'));
-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_partners DROP CONSTRAINT IF EXISTS pharmacy_partners_credit_check;
ALTER TABLE pharmacy_partners ADD CONSTRAINT pharmacy_partners_credit_check CHECK (credit_limit >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'الرئيسي' NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  phone TEXT,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 3. ITEMS / INVENTORY
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_item_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  parent_id UUID REFERENCES pharmacy_item_groups(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  group_id UUID REFERENCES pharmacy_item_groups(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES pharmacy_item_brands(id) ON DELETE SET NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  sku TEXT,
  category TEXT,
  unit TEXT DEFAULT 'unit' NOT NULL,
  manufacturer_name TEXT,
  item_type TEXT DEFAULT 'stocked' NOT NULL,
  buy_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  old_sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  manage_inventory BOOLEAN DEFAULT true NOT NULL,
  not_for_sale BOOLEAN DEFAULT false NOT NULL,
  min_stock NUMERIC(14,3) DEFAULT 0,
  max_stock NUMERIC(14,3) DEFAULT 0,
  opening_stock NUMERIC(14,3) DEFAULT 0,
  has_expiry BOOLEAN DEFAULT false,
  track_batch BOOLEAN DEFAULT false,
  is_controlled BOOLEAN DEFAULT false,
  requires_prescription BOOLEAN DEFAULT false,
  expiry_date DATE,
  image_url TEXT,
  search_text TEXT DEFAULT '' NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, sku)
);

ALTER TABLE pharmacy_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sub_category TEXT,
  ADD COLUMN IF NOT EXISTS barcode_type TEXT,
  ADD COLUMN IF NOT EXISTS expiry_period_value NUMERIC(14,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_period_unit TEXT,
  ADD COLUMN IF NOT EXISTS tax_name TEXT,
  ADD COLUMN IF NOT EXISTS selling_price_tax_type TEXT,
  ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS variation_name TEXT,
  ADD COLUMN IF NOT EXISTS variation_values TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS variation_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS purchase_price_including_tax NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_price_excluding_tax NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_margin NUMERIC(8,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_stock_location TEXT,
  ADD COLUMN IF NOT EXISTS serial_tracking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS weight NUMERIC(14,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rack TEXT,
  ADD COLUMN IF NOT EXISTS shelf_row TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS product_description TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_1 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_2 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_3 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_4 TEXT,
  ADD COLUMN IF NOT EXISTS product_locations TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS import_metadata JSONB DEFAULT '{}'::JSONB;

ALTER TABLE pharmacy_items DROP CONSTRAINT IF EXISTS pharmacy_items_item_type_check;
ALTER TABLE pharmacy_items ADD CONSTRAINT pharmacy_items_item_type_check CHECK(item_type IN ('stocked','service','digital','consignment'));

-- CHECK constraints from 20260618008000
ALTER TABLE pharmacy_items DROP CONSTRAINT IF EXISTS pharmacy_items_status_check;
ALTER TABLE pharmacy_items ADD CONSTRAINT pharmacy_items_status_check
  CHECK (status IN ('active', 'inactive', 'archived', 'deleted')) NOT VALID;
ALTER TABLE pharmacy_items DROP CONSTRAINT IF EXISTS pharmacy_items_prices_check;
ALTER TABLE pharmacy_items ADD CONSTRAINT pharmacy_items_prices_check
  CHECK (
    buy_price >= 0 AND sell_price >= 0 AND old_sell_price >= 0
    AND COALESCE(min_stock, 0) >= 0 AND COALESCE(max_stock, 0) >= 0
    AND COALESCE(opening_stock, 0) >= 0
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_item_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, barcode)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  factor NUMERIC(14,3) DEFAULT 1 NOT NULL,
  barcode TEXT,
  sell_price NUMERIC(14,2),
  is_base BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, item_id, unit_name)
);

ALTER TABLE pharmacy_item_units
  ADD COLUMN IF NOT EXISTS main_unit TEXT,
  ADD COLUMN IF NOT EXISTS sub_unit TEXT,
  ADD COLUMN IF NOT EXISTS qty_per_main_unit NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS unit_raw TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE pharmacy_item_units DROP CONSTRAINT IF EXISTS pharmacy_item_units_factor_check;
ALTER TABLE pharmacy_item_units ADD CONSTRAINT pharmacy_item_units_factor_check CHECK(factor > 0);

CREATE TABLE IF NOT EXISTS pharmacy_item_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sell_price NUMERIC(14,2),
  barcode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_item_variants
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS pharmacy_item_warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_days INT NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_item_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  alternative_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  priority INT DEFAULT 0 NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, item_id, alternative_item_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  batch_number TEXT,
  expiry_date DATE,
  quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  remaining_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  unit TEXT,
  cost_price NUMERIC(14,2) DEFAULT 0,
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraints from 20260618008000
ALTER TABLE pharmacy_item_batches DROP CONSTRAINT IF EXISTS pharmacy_item_batches_quantities_check;
ALTER TABLE pharmacy_item_batches ADD CONSTRAINT pharmacy_item_batches_quantities_check
  CHECK (quantity >= 0 AND remaining_quantity >= 0 AND remaining_quantity <= quantity AND COALESCE(cost_price, 0) >= 0) NOT VALID;

-- Deleted items audit table from 20260617003000
CREATE TABLE IF NOT EXISTS pharmacy_deleted_items_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ
);

-- ========================
-- 4. STOCK MANAGEMENT
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_stock_balances (
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, item_id, branch_id)
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_stock_balances DROP CONSTRAINT IF EXISTS pharmacy_stock_balances_quantity_check;
ALTER TABLE pharmacy_stock_balances ADD CONSTRAINT pharmacy_stock_balances_quantity_check
  CHECK (quantity >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  movement_type TEXT NOT NULL,
  source_table TEXT,
  source_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_stock_movements DROP CONSTRAINT IF EXISTS pharmacy_stock_movements_direction_check;
ALTER TABLE pharmacy_stock_movements ADD CONSTRAINT pharmacy_stock_movements_direction_check CHECK(direction IN ('in','out','adjust'));

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_stock_movements DROP CONSTRAINT IF EXISTS pharmacy_stock_movements_values_check;
ALTER TABLE pharmacy_stock_movements ADD CONSTRAINT pharmacy_stock_movements_values_check
  CHECK (quantity > 0 AND unit_price >= 0 AND total_value >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  to_branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  transfer_number TEXT,
  lines JSONB DEFAULT '[]'::jsonb NOT NULL,
  total_items INT DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'completed' NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, transfer_number)
);

ALTER TABLE pharmacy_stock_transfers DROP CONSTRAINT IF EXISTS pharmacy_stock_transfers_status_check;
ALTER TABLE pharmacy_stock_transfers ADD CONSTRAINT pharmacy_stock_transfers_status_check CHECK(status IN ('draft','completed','cancelled'));

CREATE TABLE IF NOT EXISTS pharmacy_damaged_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit TEXT,
  reason TEXT,
  cost_value NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'posted',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  expected_qty NUMERIC(14,3) DEFAULT 0,
  counted_qty NUMERIC(14,3) DEFAULT 0,
  variance NUMERIC(14,3) DEFAULT 0,
  unit TEXT,
  notes TEXT,
  status TEXT DEFAULT 'posted',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_stock_counts
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

CREATE TABLE IF NOT EXISTS pharmacy_inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  total_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  total_purchase_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_sale_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  items JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 5. SALES
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT 'زبون نقدي' NOT NULL,
  status TEXT DEFAULT 'invoice' NOT NULL,
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0,
  rounding_adj NUMERIC(14,2) DEFAULT 0,
  shift_id UUID,
  notes TEXT,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  reversal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, invoice_number)
);

ALTER TABLE pharmacy_sales
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- CHECK constraints from 20260618008000
ALTER TABLE pharmacy_sales DROP CONSTRAINT IF EXISTS pharmacy_sales_status_check;
ALTER TABLE pharmacy_sales ADD CONSTRAINT pharmacy_sales_status_check
  CHECK (status IN ('draft', 'invoice', 'completed', 'returned', 'partial_return', 'void', 'cancelled')) NOT VALID;
ALTER TABLE pharmacy_sales DROP CONSTRAINT IF EXISTS pharmacy_sales_payment_status_check;
ALTER TABLE pharmacy_sales ADD CONSTRAINT pharmacy_sales_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')) NOT VALID;
ALTER TABLE pharmacy_sales DROP CONSTRAINT IF EXISTS pharmacy_sales_totals_check;
ALTER TABLE pharmacy_sales ADD CONSTRAINT pharmacy_sales_totals_check
  CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
    AND total >= 0 AND paid_amount >= 0 AND due_amount >= 0
    AND COALESCE(shipping_fee, 0) >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  item_name TEXT,
  barcode TEXT,
  unit TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  purchase_price NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_sale_lines DROP CONSTRAINT IF EXISTS pharmacy_sale_lines_values_check;
ALTER TABLE pharmacy_sale_lines ADD CONSTRAINT pharmacy_sale_lines_values_check
  CHECK (quantity > 0 AND unit_price >= 0 AND COALESCE(purchase_price, 0) >= 0
    AND discount >= 0 AND net_total >= 0
    AND discount <= quantity * unit_price) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES pharmacy_sales(id) ON DELETE SET NULL,
  return_number TEXT NOT NULL,
  customer_name TEXT DEFAULT 'زبون نقدي' NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  stock_mode TEXT,
  reason TEXT,
  return_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, return_number)
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_sales_returns DROP CONSTRAINT IF EXISTS pharmacy_sales_returns_totals_check;
ALTER TABLE pharmacy_sales_returns ADD CONSTRAINT pharmacy_sales_returns_totals_check
  CHECK (total >= 0 AND refund_amount >= 0 AND refund_amount <= total) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_sales_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES pharmacy_sales_returns(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_sales_return_lines DROP CONSTRAINT IF EXISTS pharmacy_sales_return_lines_values_check;
ALTER TABLE pharmacy_sales_return_lines ADD CONSTRAINT pharmacy_sales_return_lines_values_check
  CHECK (quantity > 0 AND unit_price >= 0 AND total >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_suspended_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT 'زبون نقدي',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(14,2) DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_invoice_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  draft_type TEXT NOT NULL,
  title TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_invoice_drafts DROP CONSTRAINT IF EXISTS pharmacy_invoice_drafts_draft_type_check;
ALTER TABLE pharmacy_invoice_drafts ADD CONSTRAINT pharmacy_invoice_drafts_draft_type_check CHECK(draft_type IN ('sale','purchase','expense','return'));

-- ========================
-- 6. PURCHASES
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  purchase_number TEXT NOT NULL,
  supplier_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  status TEXT DEFAULT 'received' NOT NULL,
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, purchase_number)
);

-- CHECK constraints from 20260618008000
ALTER TABLE pharmacy_purchases DROP CONSTRAINT IF EXISTS pharmacy_purchases_status_check;
ALTER TABLE pharmacy_purchases ADD CONSTRAINT pharmacy_purchases_status_check
  CHECK (status IN ('draft', 'pending', 'ordered', 'received', 'partial_return', 'returned', 'void', 'cancelled')) NOT VALID;
ALTER TABLE pharmacy_purchases DROP CONSTRAINT IF EXISTS pharmacy_purchases_payment_status_check;
ALTER TABLE pharmacy_purchases ADD CONSTRAINT pharmacy_purchases_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')) NOT VALID;
ALTER TABLE pharmacy_purchases DROP CONSTRAINT IF EXISTS pharmacy_purchases_totals_check;
ALTER TABLE pharmacy_purchases ADD CONSTRAINT pharmacy_purchases_totals_check
  CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
    AND total >= 0 AND paid_amount >= 0 AND due_amount >= 0
    AND COALESCE(shipping_fee, 0) >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES pharmacy_purchases(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_purchase_lines DROP CONSTRAINT IF EXISTS pharmacy_purchase_lines_values_check;
ALTER TABLE pharmacy_purchase_lines ADD CONSTRAINT pharmacy_purchase_lines_values_check
  CHECK (quantity > 0 AND buy_price >= 0 AND sell_price >= 0
    AND discount >= 0 AND net_total >= 0
    AND discount <= quantity * buy_price) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  purchase_id UUID REFERENCES pharmacy_purchases(id) ON DELETE SET NULL,
  return_number TEXT NOT NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  stock_mode TEXT,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, return_number)
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_purchase_returns DROP CONSTRAINT IF EXISTS pharmacy_purchase_returns_totals_check;
ALTER TABLE pharmacy_purchase_returns ADD CONSTRAINT pharmacy_purchase_returns_totals_check
  CHECK (total >= 0 AND refund_amount >= 0 AND refund_amount <= total) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_purchase_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES pharmacy_purchase_returns(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_purchase_return_lines DROP CONSTRAINT IF EXISTS pharmacy_purchase_return_lines_values_check;
ALTER TABLE pharmacy_purchase_return_lines ADD CONSTRAINT pharmacy_purchase_return_lines_values_check
  CHECK (quantity > 0 AND buy_price >= 0 AND total >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  expected_date DATE,
  lines JSONB DEFAULT '[]'::jsonb NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_purchase_orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE pharmacy_purchase_orders DROP CONSTRAINT IF EXISTS pharmacy_purchase_orders_status_check;
ALTER TABLE pharmacy_purchase_orders ADD CONSTRAINT pharmacy_purchase_orders_status_check CHECK(status IN ('draft','sent','partial','received','cancelled'));

-- ========================
-- 7. EXPENSES
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES pharmacy_expense_categories(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  category_id UUID REFERENCES pharmacy_expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  paid_to TEXT,
  notes TEXT,
  expense_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_expenses DROP CONSTRAINT IF EXISTS pharmacy_expenses_totals_check;
ALTER TABLE pharmacy_expenses ADD CONSTRAINT pharmacy_expenses_totals_check
  CHECK (amount >= 0 AND tax_amount >= 0 AND total >= 0) NOT VALID;

-- ========================
-- 8. PAYMENTS / TRANSACTIONS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  partner_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  notes TEXT,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_payments DROP CONSTRAINT IF EXISTS pharmacy_payments_type_check;
ALTER TABLE pharmacy_payments ADD CONSTRAINT pharmacy_payments_type_check CHECK(type IN ('sale','purchase','expense','return','transfer'));
ALTER TABLE pharmacy_payments DROP CONSTRAINT IF EXISTS pharmacy_payments_direction_check;
ALTER TABLE pharmacy_payments ADD CONSTRAINT pharmacy_payments_direction_check CHECK(direction IN ('in','out'));
-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_payments DROP CONSTRAINT IF EXISTS pharmacy_payments_amount_check;
ALTER TABLE pharmacy_payments ADD CONSTRAINT pharmacy_payments_amount_check CHECK (amount > 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES pharmacy_payments(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_payment_allocations DROP CONSTRAINT IF EXISTS pharmacy_payment_allocations_amount_check;
ALTER TABLE pharmacy_payment_allocations ADD CONSTRAINT pharmacy_payment_allocations_amount_check CHECK (amount > 0) NOT VALID;

-- ========================
-- 9. ORDERS / E-COMMERCE
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  customer_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'عميل',
  shipping_address_id UUID REFERENCES pharmacy_customer_addresses(id) ON DELETE SET NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0 NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, order_number)
);

ALTER TABLE pharmacy_orders DROP CONSTRAINT IF EXISTS pharmacy_orders_status_check;
ALTER TABLE pharmacy_orders ADD CONSTRAINT pharmacy_orders_status_check CHECK(status IN ('pending','confirmed','preparing','shipped','delivered','cancelled','returned'));

CREATE TABLE IF NOT EXISTS pharmacy_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES pharmacy_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 10. COUPONS & BUNDLES
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC(14,2) NOT NULL,
  min_purchase NUMERIC(14,2) DEFAULT 0,
  max_uses INT DEFAULT 0,
  used_count INT DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

ALTER TABLE pharmacy_coupons DROP CONSTRAINT IF EXISTS pharmacy_coupons_discount_type_check;
ALTER TABLE pharmacy_coupons ADD CONSTRAINT pharmacy_coupons_discount_type_check CHECK(discount_type IN ('percentage','fixed'));

CREATE TABLE IF NOT EXISTS pharmacy_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  total_original_price NUMERIC(14,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL REFERENCES pharmacy_bundles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bundle_id, item_id)
);

-- ========================
-- 11. ACCOUNTING
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id UUID REFERENCES pharmacy_chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

ALTER TABLE pharmacy_chart_of_accounts DROP CONSTRAINT IF EXISTS pharmacy_chart_of_accounts_type_check;
ALTER TABLE pharmacy_chart_of_accounts ADD CONSTRAINT pharmacy_chart_of_accounts_type_check CHECK(type IN ('asset','liability','equity','income','expense'));

CREATE TABLE IF NOT EXISTS pharmacy_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  description TEXT,
  source_table TEXT,
  source_id UUID,
  total_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, entry_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES pharmacy_journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES pharmacy_chart_of_accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_account_balances (
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES pharmacy_chart_of_accounts(id) ON DELETE RESTRICT,
  period TEXT NOT NULL,
  opening_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  opening_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  debit_movements NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_movements NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, account_id, period)
);

CREATE TABLE IF NOT EXISTS pharmacy_tax_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

ALTER TABLE pharmacy_tax_groups
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS pharmacy_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  date_key TEXT NOT NULL,
  sales_count INT DEFAULT 0 NOT NULL,
  sales_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sales_profit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  purchases_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  expenses_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  returns_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_profit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_cash NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_card NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_other NUMERIC(14,2) DEFAULT 0 NOT NULL,
  collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, branch_id, date_key)
);

ALTER TABLE pharmacy_daily_summary
  ADD COLUMN IF NOT EXISTS summary_date DATE;

CREATE TABLE IF NOT EXISTS pharmacy_financial_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  direction TEXT NOT NULL,
  source_table TEXT,
  source_id UUID,
  description TEXT,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_financial_movements DROP CONSTRAINT IF EXISTS pharmacy_financial_movements_direction_check;
ALTER TABLE pharmacy_financial_movements ADD CONSTRAINT pharmacy_financial_movements_direction_check CHECK(direction IN ('in','out'));
-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_financial_movements DROP CONSTRAINT IF EXISTS pharmacy_financial_movements_amount_check;
ALTER TABLE pharmacy_financial_movements ADD CONSTRAINT pharmacy_financial_movements_amount_check CHECK (amount > 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_barcode_label_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rows INT NOT NULL DEFAULT 6,
  cols INT NOT NULL DEFAULT 4,
  margins TEXT DEFAULT '10,10,10,10',
  spacing TEXT DEFAULT '2,2',
  label_width_mm NUMERIC(6,2) NOT NULL DEFAULT 50,
  label_height_mm NUMERIC(6,2) NOT NULL DEFAULT 30,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 12. CASH MANAGEMENT
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_cash_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'closed' NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_cash_registers DROP CONSTRAINT IF EXISTS pharmacy_cash_registers_status_check;
ALTER TABLE pharmacy_cash_registers ADD CONSTRAINT pharmacy_cash_registers_status_check CHECK(status IN ('open','closed'));

CREATE TABLE IF NOT EXISTS pharmacy_register_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  register_id UUID NOT NULL REFERENCES pharmacy_cash_registers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_register_transactions DROP CONSTRAINT IF EXISTS pharmacy_register_transactions_transaction_type_check;
ALTER TABLE pharmacy_register_transactions ADD CONSTRAINT pharmacy_register_transactions_transaction_type_check CHECK(transaction_type IN ('sale','expense','in','out','refund','withdraw','deposit'));
-- CHECK constraint from 20260618008000
ALTER TABLE pharmacy_register_transactions DROP CONSTRAINT IF EXISTS pharmacy_register_transactions_amount_check;
ALTER TABLE pharmacy_register_transactions ADD CONSTRAINT pharmacy_register_transactions_amount_check CHECK (amount > 0) NOT VALID;

CREATE TABLE IF NOT EXISTS pharmacy_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  register_id UUID REFERENCES pharmacy_cash_registers(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_balance NUMERIC(14,2),
  expected_balance NUMERIC(14,2),
  difference NUMERIC(14,2) DEFAULT 0 NOT NULL,
  cash_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  card_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_collected NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_expenses NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'open' NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_shifts DROP CONSTRAINT IF EXISTS pharmacy_shifts_status_check;
ALTER TABLE pharmacy_shifts ADD CONSTRAINT pharmacy_shifts_status_check CHECK(status IN ('open','closed'));

-- ========================
-- 13. LOYALTY SYSTEM
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  points INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, partner_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  points INT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_loyalty_transactions DROP CONSTRAINT IF EXISTS pharmacy_loyalty_transactions_type_check;
ALTER TABLE pharmacy_loyalty_transactions ADD CONSTRAINT pharmacy_loyalty_transactions_type_check CHECK(type IN ('earn','redeem','expire','adjust'));

CREATE TABLE IF NOT EXISTS pharmacy_loyalty_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  total_earned INT DEFAULT 0 NOT NULL,
  total_redeemed INT DEFAULT 0 NOT NULL,
  total_expired INT DEFAULT 0 NOT NULL,
  current_balance INT DEFAULT 0 NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, partner_id)
);

-- ========================
-- 14. MANUFACTURING
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_manufacturing_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  product_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  yield_quantity NUMERIC(14,3) DEFAULT 1 NOT NULL,
  cost_price NUMERIC(14,2) DEFAULT 0,
  sell_price NUMERIC(14,2) DEFAULT 0,
  instructions TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_manufacturing_recipes DROP CONSTRAINT IF EXISTS pharmacy_manufacturing_recipes_status_check;
ALTER TABLE pharmacy_manufacturing_recipes ADD CONSTRAINT pharmacy_manufacturing_recipes_status_check CHECK(status IN ('active','inactive','archived'));

CREATE TABLE IF NOT EXISTS pharmacy_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES pharmacy_manufacturing_recipes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit TEXT,
  wastage_pct NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, item_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_manufacturing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES pharmacy_manufacturing_recipes(id) ON DELETE RESTRICT,
  batch_number TEXT,
  product_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  expiry_date DATE,
  status TEXT DEFAULT 'completed' NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_manufacturing_batches DROP CONSTRAINT IF EXISTS pharmacy_manufacturing_batches_status_check;
ALTER TABLE pharmacy_manufacturing_batches ADD CONSTRAINT pharmacy_manufacturing_batches_status_check CHECK(status IN ('planned','in_progress','completed','cancelled'));

-- ========================
-- 15. CONTROLLED DRUGS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_controlled_drugs_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  patient_name TEXT,
  doctor_name TEXT,
  prescription_number TEXT,
  id_number TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_controlled_drugs_log DROP CONSTRAINT IF EXISTS pharmacy_controlled_drugs_log_action_check;
ALTER TABLE pharmacy_controlled_drugs_log ADD CONSTRAINT pharmacy_controlled_drugs_log_action_check CHECK(action IN ('received','dispensed','destroyed','transfer','adjustment'));

-- ========================
-- 16. CONSIGNMENT STOCK
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_consignment_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  sold_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  returned_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  commission_pct NUMERIC(5,2) DEFAULT 0 NOT NULL,
  cost_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  settlement_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_consignment_stock DROP CONSTRAINT IF EXISTS pharmacy_consignment_stock_status_check;
ALTER TABLE pharmacy_consignment_stock ADD CONSTRAINT pharmacy_consignment_stock_status_check CHECK(status IN ('active','settled','returned'));

-- ========================
-- 17. HR / EMPLOYEES
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  position TEXT NOT NULL,
  salary NUMERIC(14,2) DEFAULT 0 NOT NULL,
  salary_type TEXT DEFAULT 'monthly',
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true NOT NULL,
  national_id TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_employees DROP CONSTRAINT IF EXISTS pharmacy_employees_salary_type_check;
ALTER TABLE pharmacy_employees ADD CONSTRAINT pharmacy_employees_salary_type_check CHECK(salary_type IN ('monthly','weekly','daily','hourly'));

CREATE TABLE IF NOT EXISTS pharmacy_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  check_in TIMESTAMPTZ NOT NULL,
  check_out TIMESTAMPTZ,
  hours_worked NUMERIC(6,2),
  status TEXT DEFAULT 'present' NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, employee_id, date_key)
);

ALTER TABLE pharmacy_attendance DROP CONSTRAINT IF EXISTS pharmacy_attendance_status_check;
ALTER TABLE pharmacy_attendance ADD CONSTRAINT pharmacy_attendance_status_check CHECK(status IN ('present','late','absent','excused'));

CREATE TABLE IF NOT EXISTS pharmacy_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_used INT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' NOT NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_leave DROP CONSTRAINT IF EXISTS pharmacy_leave_type_check;
ALTER TABLE pharmacy_leave ADD CONSTRAINT pharmacy_leave_type_check CHECK(type IN ('annual','sick','emergency','unpaid'));
ALTER TABLE pharmacy_leave DROP CONSTRAINT IF EXISTS pharmacy_leave_status_check;
ALTER TABLE pharmacy_leave ADD CONSTRAINT pharmacy_leave_status_check CHECK(status IN ('pending','approved','rejected','cancelled'));

CREATE TABLE IF NOT EXISTS pharmacy_employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, employee_id, day_of_week)
);

ALTER TABLE pharmacy_employee_shifts DROP CONSTRAINT IF EXISTS pharmacy_employee_shifts_day_of_week_check;
ALTER TABLE pharmacy_employee_shifts ADD CONSTRAINT pharmacy_employee_shifts_day_of_week_check CHECK(day_of_week BETWEEN 0 AND 6);

-- ========================
-- 18. SESSIONS / SECURITY
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(token)
);

CREATE TABLE IF NOT EXISTS pharmacy_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  permissions JSONB DEFAULT '[]'::jsonb NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

-- ========================
-- 19. NOTIFICATIONS & COMMUNICATION
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES pharmacy_notifications(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_inapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE pharmacy_inapp_notifications DROP CONSTRAINT IF EXISTS pharmacy_inapp_notifications_notif_type_check;
ALTER TABLE pharmacy_inapp_notifications ADD CONSTRAINT pharmacy_inapp_notifications_notif_type_check CHECK(notif_type IN ('warning','success','info','error'));

CREATE TABLE IF NOT EXISTS pharmacy_inapp_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  was_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'sent' NOT NULL,
  provider TEXT DEFAULT 'twilio',
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 20. ACTIVITY / AUDIT
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_activity_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'system',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_audit_events DROP CONSTRAINT IF EXISTS pharmacy_audit_events_severity_check;
ALTER TABLE pharmacy_audit_events ADD CONSTRAINT pharmacy_audit_events_severity_check CHECK (severity IN ('info','warning','error','critical'));

-- ========================
-- 21. REPORTS / EXPORTS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule TEXT,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows_total INT DEFAULT 0 NOT NULL,
  rows_inserted INT DEFAULT 0 NOT NULL,
  rows_skipped INT DEFAULT 0 NOT NULL,
  errors TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_import_logs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS pharmacy_document_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft' NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 22. PAYMENT LINKS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES pharmacy_sales(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active' NOT NULL,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_payment_links DROP CONSTRAINT IF EXISTS pharmacy_payment_links_status_check;
ALTER TABLE pharmacy_payment_links ADD CONSTRAINT pharmacy_payment_links_status_check CHECK(status IN ('active','paid','expired','cancelled'));

-- ========================
-- 23. SETTINGS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, key)
);

ALTER TABLE pharmacy_settings ALTER COLUMN pharmacy_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS pharmacy_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  rate_type TEXT NOT NULL DEFAULT 'percent',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_tax_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES pharmacy_tax_groups(id) ON DELETE CASCADE,
  tax_rate_id UUID NOT NULL REFERENCES pharmacy_tax_rates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, tax_rate_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_invoice_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'standard',
  primary_color TEXT DEFAULT '#1e40af',
  secondary_color TEXT DEFAULT '#f8fafc',
  accent_color TEXT DEFAULT '#3b82f6',
  is_default BOOLEAN NOT NULL DEFAULT false,
  show_logo BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  show_header BOOLEAN NOT NULL DEFAULT true,
  header_text TEXT DEFAULT '',
  header_subtitle_1 TEXT DEFAULT '',
  header_subtitle_2 TEXT DEFAULT '',
  header_subtitle_3 TEXT DEFAULT '',
  show_footer BOOLEAN NOT NULL DEFAULT true,
  footer_text TEXT DEFAULT 'شكراً لتعاملكم معنا',
  show_tax BOOLEAN NOT NULL DEFAULT true,
  show_discount BOOLEAN NOT NULL DEFAULT true,
  show_barcode BOOLEAN NOT NULL DEFAULT true,
  show_qr BOOLEAN NOT NULL DEFAULT true,
  qr_enabled BOOLEAN NOT NULL DEFAULT true,
  qr_show_business_name BOOLEAN NOT NULL DEFAULT true,
  qr_show_invoice_no BOOLEAN NOT NULL DEFAULT true,
  qr_show_date BOOLEAN NOT NULL DEFAULT true,
  qr_show_total BOOLEAN NOT NULL DEFAULT true,
  qr_show_tax BOOLEAN NOT NULL DEFAULT true,
  show_customer_info BOOLEAN NOT NULL DEFAULT true,
  show_customer_id BOOLEAN NOT NULL DEFAULT false,
  show_customer_tax BOOLEAN NOT NULL DEFAULT true,
  show_phone BOOLEAN NOT NULL DEFAULT true,
  show_address BOOLEAN NOT NULL DEFAULT true,
  show_shipping BOOLEAN NOT NULL DEFAULT false,
  show_item_image BOOLEAN NOT NULL DEFAULT false,
  show_item_code BOOLEAN NOT NULL DEFAULT true,
  show_item_brand BOOLEAN NOT NULL DEFAULT false,
  show_item_unit BOOLEAN NOT NULL DEFAULT true,
  show_total_qty BOOLEAN NOT NULL DEFAULT true,
  show_payment_info BOOLEAN NOT NULL DEFAULT true,
  show_total_in_words BOOLEAN NOT NULL DEFAULT true,
  show_signature BOOLEAN NOT NULL DEFAULT false,
  show_currency BOOLEAN NOT NULL DEFAULT true,
  paper_size TEXT NOT NULL DEFAULT 'A4',
  font_family TEXT NOT NULL DEFAULT 'Cairo',
  font_size INTEGER NOT NULL DEFAULT 12,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_barcode_paper_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_width NUMERIC(10,2) DEFAULT 297,
  page_height NUMERIC(10,2) DEFAULT 210,
  left_margin NUMERIC(10,2) DEFAULT 10,
  right_margin NUMERIC(10,2) DEFAULT 10,
  top_margin NUMERIC(10,2) DEFAULT 10,
  bottom_margin NUMERIC(10,2) DEFAULT 10,
  label_width NUMERIC(10,2) DEFAULT 70,
  label_height NUMERIC(10,2) DEFAULT 40,
  columns INTEGER DEFAULT 3,
  rows INTEGER DEFAULT 4,
  gap_horizontal NUMERIC(10,2) DEFAULT 2,
  gap_vertical NUMERIC(10,2) DEFAULT 2,
  font_size INTEGER DEFAULT 8,
  barcode_symbology TEXT DEFAULT 'Code-128',
  show_price BOOLEAN NOT NULL DEFAULT true,
  show_name BOOLEAN NOT NULL DEFAULT true,
  show_barcode BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_receipt_printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  printer_type TEXT NOT NULL DEFAULT 'thermal',
  interface_type TEXT NOT NULL DEFAULT 'usb',
  ip_address TEXT DEFAULT '',
  port INTEGER DEFAULT 9100,
  paper_width INTEGER DEFAULT 80,
  characters_per_line INTEGER DEFAULT 42,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'in_app',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  auto_send BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, scenario, channel)
);

CREATE TABLE IF NOT EXISTS pharmacy_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_size BIGINT,
  type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'created',
  storage_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  restored_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 24. TASKS (from 20260618010000)
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_tasks DROP CONSTRAINT IF EXISTS pharmacy_tasks_priority_check;
ALTER TABLE pharmacy_tasks ADD CONSTRAINT pharmacy_tasks_priority_check CHECK(priority IN ('low','medium','high','urgent'));

-- ========================
-- 25. PRICE GROUPS (from 20260618011000)
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_price_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  discount_percent NUMERIC(7,3) DEFAULT 0 NOT NULL,
  markup_percent NUMERIC(7,3) DEFAULT 0 NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name),
  UNIQUE(pharmacy_id, code)
);

ALTER TABLE pharmacy_price_groups DROP CONSTRAINT IF EXISTS pharmacy_price_groups_discount_percent_check;
ALTER TABLE pharmacy_price_groups ADD CONSTRAINT pharmacy_price_groups_discount_percent_check CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE pharmacy_price_groups DROP CONSTRAINT IF EXISTS pharmacy_price_groups_markup_percent_check;
ALTER TABLE pharmacy_price_groups ADD CONSTRAINT pharmacy_price_groups_markup_percent_check CHECK (markup_percent >= 0 AND markup_percent <= 1000);
ALTER TABLE pharmacy_price_groups DROP CONSTRAINT IF EXISTS pharmacy_price_groups_status_check;
ALTER TABLE pharmacy_price_groups ADD CONSTRAINT pharmacy_price_groups_status_check CHECK (status IN ('active','inactive'));

-- ========================
-- 26. PRESCRIPTIONS (from 20260618011000)
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES pharmacy_sales(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL DEFAULT 'مريض',
  doctor_name TEXT,
  diagnosis TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'open' NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_prescriptions DROP CONSTRAINT IF EXISTS pharmacy_prescriptions_status_check;
ALTER TABLE pharmacy_prescriptions ADD CONSTRAINT pharmacy_prescriptions_status_check CHECK (status IN ('open','dispensed','cancelled','archived'));

-- ========================
-- 27. GLOBAL UNITS (from 20260618016000 - first creation)
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, unit_name)
);

-- ========================
-- 28. DEVELOPER / SYSTEM TABLES
-- ========================

CREATE TABLE IF NOT EXISTS developer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_users DROP CONSTRAINT IF EXISTS developer_users_role_check;
ALTER TABLE developer_users ADD CONSTRAINT developer_users_role_check CHECK (role IN ('super_admin','developer','maintainer'));

CREATE TABLE IF NOT EXISTS developer_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  developer_id UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_audit_events DROP CONSTRAINT IF EXISTS developer_audit_events_severity_check;
ALTER TABLE developer_audit_events ADD CONSTRAINT developer_audit_events_severity_check CHECK(severity IN ('info','warning','error','critical'));

CREATE TABLE IF NOT EXISTS developer_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  conditions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_release_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  changelog TEXT,
  min_app_version TEXT,
  is_required BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT false NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID REFERENCES developer_release_versions(id) ON DELETE SET NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  log TEXT,
  deployed_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE developer_deployments DROP CONSTRAINT IF EXISTS developer_deployments_status_check;
ALTER TABLE developer_deployments ADD CONSTRAINT developer_deployments_status_check CHECK(status IN ('pending','deploying','success','failed','rolled_back'));

CREATE TABLE IF NOT EXISTS developer_error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  stack_trace TEXT,
  url TEXT,
  user_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_error_events DROP CONSTRAINT IF EXISTS developer_error_events_level_check;
ALTER TABLE developer_error_events ADD CONSTRAINT developer_error_events_level_check CHECK(level IN ('error','fatal'));

CREATE TABLE IF NOT EXISTS developer_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INT,
  duration_ms INT,
  user_id UUID,
  request_body TEXT,
  response_body TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_sql_sync_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  resolved BOOLEAN DEFAULT false NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_sql_sync_issues DROP CONSTRAINT IF EXISTS developer_sql_sync_issues_issue_type_check;
ALTER TABLE developer_sql_sync_issues ADD CONSTRAINT developer_sql_sync_issues_issue_type_check CHECK(issue_type IN ('schema_mismatch','missing_column','type_conflict','constraint_violation'));

CREATE TABLE IF NOT EXISTS developer_maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL,
  schedule TEXT,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'idle' NOT NULL,
  log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_maintenance_tasks DROP CONSTRAINT IF EXISTS developer_maintenance_tasks_task_type_check;
ALTER TABLE developer_maintenance_tasks ADD CONSTRAINT developer_maintenance_tasks_task_type_check CHECK(task_type IN ('cleanup','backup','migration','index','vacuum','sync','other'));
ALTER TABLE developer_maintenance_tasks DROP CONSTRAINT IF EXISTS developer_maintenance_tasks_status_check;
ALTER TABLE developer_maintenance_tasks ADD CONSTRAINT developer_maintenance_tasks_status_check CHECK(status IN ('idle','running','success','failed','disabled'));

CREATE TABLE IF NOT EXISTS developer_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_users(id) ON DELETE CASCADE,
  impersonated_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS developer_module_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  dependencies TEXT[] DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_permission_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  module TEXT NOT NULL,
  is_granted BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role, permission, module)
);

CREATE TABLE IF NOT EXISTS developer_table_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description TEXT,
  category TEXT,
  sync_enabled BOOLEAN DEFAULT true NOT NULL,
  audit_enabled BOOLEAN DEFAULT false NOT NULL,
  retention_days INT DEFAULT 365,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_build_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INT,
  details TEXT,
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE developer_build_checks DROP CONSTRAINT IF EXISTS developer_build_checks_status_check;
ALTER TABLE developer_build_checks ADD CONSTRAINT developer_build_checks_status_check CHECK(status IN ('pending','passing','failing','skipped'));

CREATE TABLE IF NOT EXISTS developer_backup_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size_bytes BIGINT DEFAULT 0,
  tables_count INT DEFAULT 0,
  rows_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  file_path TEXT,
  checksum TEXT,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_backup_snapshots DROP CONSTRAINT IF EXISTS developer_backup_snapshots_status_check;
ALTER TABLE developer_backup_snapshots ADD CONSTRAINT developer_backup_snapshots_status_check CHECK(status IN ('in_progress','completed','failed','restored'));

CREATE TABLE IF NOT EXISTS developer_migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  direction TEXT NOT NULL,
  checksum TEXT,
  duration_ms INT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  executed_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_migration_runs DROP CONSTRAINT IF EXISTS developer_migration_runs_direction_check;
ALTER TABLE developer_migration_runs ADD CONSTRAINT developer_migration_runs_direction_check CHECK(direction IN ('up','down'));

CREATE TABLE IF NOT EXISTS developer_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(14,2) NOT NULL,
  unit TEXT DEFAULT '',
  status TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE developer_health_checks DROP CONSTRAINT IF EXISTS developer_health_checks_status_check;
ALTER TABLE developer_health_checks ADD CONSTRAINT developer_health_checks_status_check CHECK(status IN ('healthy','warning','critical'));


-- ===== 001_helper_functions.sql =====
-- ===================================================================
-- PHARMACY SYSTEM - CONSOLIDATED HELPER FUNCTIONS
-- Generated from all migration files (20260617-20260618)
-- Uses CREATE OR REPLACE FUNCTION with FINAL versions only
-- Order: auth helpers → permission helpers → setting helpers → trigger helpers → notifications → workspace
-- ===================================================================

-- ========================
-- AUTH HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      EXISTS(
        SELECT 1
        FROM public.developer_users du
        WHERE du.user_id = p_user_id
          AND du.is_active = true
      )
      OR EXISTS(
        SELECT 1
        FROM auth.users u
        WHERE u.id = p_user_id
          AND lower(u.email) = lower('mostafa0falcon@gmail.com')
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pharmacy_owner(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacies p
      WHERE p.id = p_pharmacy_id
        AND p.owner_id = p_user_id
        AND p.status <> 'closed'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_pharmacy_role(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN 'developer';
  END IF;

  IF public.is_pharmacy_owner(p_pharmacy_id, p_user_id) THEN
    RETURN 'owner';
  END IF;

  SELECT pp.role
    INTO v_role
  FROM public.pharmacy_profiles pp
  WHERE pp.pharmacy_id = p_pharmacy_id
    AND pp.user_id = p_user_id
    AND pp.is_active = true
  ORDER BY pp.created_at ASC
  LIMIT 1;

  RETURN COALESCE(v_role, 'no-access');
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pharmacy_access(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_pharmacy_id UUID, p_branch_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      p_branch_id IS NULL
      OR public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
          AND (pp.branch_id IS NULL OR pp.branch_id = p_branch_id)
      )
    ),
    false
  );
$$;

-- ========================
-- PERMISSION HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.permission_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_denied_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.denied_permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_is_system_only(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_permission = 'system:all'
    OR p_permission LIKE 'developer:%'
    OR p_permission IN (
      'roles:manage',
      'auth:sessions.manage',
      'settings:system.read',
      'settings:system.write',
      'notifications:system.read'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL OR p_permission = '' THEN
    RETURN false;
  END IF;

  -- المطور يرى ويدير كل شيء من جدول developer_users فقط.
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  -- صلاحيات النظام ليست قابلة للإسناد لأصحاب الصيدليات أو الموظفين.
  IF public.permission_is_system_only(p_permission) THEN
    RETURN false;
  END IF;

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','pharmacy:delete',
      'branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:project.write','settings:branches.read','settings:branches.write','settings:tax.read','settings:tax.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:payments.write','settings:contacts.read','settings:contacts.write','settings:invoice.read','settings:invoice.write','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:notification-templates.write','settings:email.read','settings:email.write','settings:sms.read','settings:sms.write','settings:backup.read','settings:shortcuts.read','settings:shortcuts.write','settings:rewards.read','settings:rewards.write','settings:extra-units.read','settings:extra-units.write','settings:custom-labels.read','settings:custom-labels.write',
      'notifications:read','notifications:manage','notifications:templates.write',
      'prescriptions:read','delivery:read','loyalty:read','sync:read','deleted-records:read','deleted-records:restore'
    );
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read',
      'notifications:read','notifications:manage','sync:read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','purchases:read','inventory:read',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read',
      'financials:read','financials:write','reports:read','reports:export','crm:read',
      'settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read'
    );
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','purchases:read',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print',
      'items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read'
    );
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read'
    );
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read'
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

-- ========================
-- SETTING HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.is_core_system_setting_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_key LIKE 'system.%'
    OR p_key IN (
      'appName','appVersion','companyName','supportPhone','supportEmail',
      'enableAutoBackup','backupFrequency','backupRetentionDays','backupLocation',
      'enableAuditLog','auditLogRetentionDays','enableMultiBranch','enableMultiCurrency','defaultBranchId',
      'enableDarkMode','enableNotifications','sessionTimeout','maxLoginAttempts','enableTwoFactor','maintenanceMode'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_setting_row(p_pharmacy_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      p_pharmacy_id IS NULL
      OR public.has_pharmacy_access(p_pharmacy_id, auth.uid())
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_setting_row(p_pharmacy_id UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      (
        p_pharmacy_id IS NULL
        AND public.is_core_system_setting_key(p_key)
        AND public.is_developer(auth.uid())
      )
      OR (
        p_pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(p_key)
            AND public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    ),
    false
  );
$$;

-- ========================
-- TRIGGER HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ========================
-- NOTIFICATIONS
-- ========================

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

-- ========================
-- WORKSPACE / AUTH TRIGGER
-- ========================

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
  -- Never trust public signup metadata for developer access.
  -- Safe pharmacy roles may still be supplied by trusted admin invitations.
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

CREATE OR REPLACE FUNCTION public.ensure_owner_workspace(
  p_user_id UUID DEFAULT auth.uid(),
  p_project_name TEXT DEFAULT NULL,
  p_owner_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'EG',
  p_city TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP',
  p_timezone TEXT DEFAULT 'Africa/Cairo'
)
RETURNS TABLE(pharmacy_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_claim_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), NULLIF(BTRIM(p_owner_name), ''), 'صيدلية جديدة');
  v_email TEXT := NULLIF(BTRIM(p_email), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  IF v_claim_role <> 'service_role'
    AND (
      v_actor_id IS NULL
      OR (
        v_actor_id <> p_user_id
        AND NOT public.is_developer(v_actor_id)
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن تجهيز صيدلية لمستخدم آخر';
  END IF;

  IF public.is_developer(p_user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يتبع صيدلية';
  END IF;

  INSERT INTO public.pharmacies (
    owner_id, name, legal_name, status, plan, currency, country, timezone, phone, email, address
  )
  VALUES (
    p_user_id,
    v_project_name,
    v_project_name,
    'active',
    'trial',
    COALESCE(NULLIF(BTRIM(p_currency), ''), 'EGP'),
    COALESCE(NULLIF(BTRIM(p_country), ''), 'EG'),
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Africa/Cairo'),
    NULLIF(BTRIM(p_phone), ''),
    v_email,
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
  VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(BTRIM(p_city), ''), NULLIF(BTRIM(p_phone), ''), true, 'active')
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active, updated_at)
  VALUES (
    p_user_id,
    COALESCE(v_email, p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(v_email, public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = CASE WHEN public.user_profiles.global_role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status, updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    v_email,
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'صاحب الصيدلية',
    'owner',
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    'created',
    now()
  )
  ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
    branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
    email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
    title = 'صاحب الصيدلية',
    role = CASE WHEN public.pharmacy_profiles.role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    disabled_reason = NULL,
    updated_at = now();

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ========================
-- DAILY SUMMARY DATE SYNC
-- ========================

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

-- ===================================================================
-- REPORT PERFORMANCE AGGREGATIONS
-- ===================================================================

-- 1. Daily sales summary aggregation
CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  sale_date DATE,
  invoice_count BIGINT,
  total_sales NUMERIC,
  total_discounts NUMERIC,
  total_tax NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  credit_sales NUMERIC,
  item_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sale_date::DATE,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_sales,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    COALESCE(SUM(s.tax_total), 0) AS total_tax,
    COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
    COALESCE(SUM(s.total - (sl.purchase_price * sl.quantity)), 0) AS total_profit,
    COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.paid_amount ELSE 0 END), 0) AS cash_sales,
    COALESCE(SUM(CASE WHEN s.payment_method IN ('card', 'wallet', 'mixed') THEN s.paid_amount ELSE 0 END), 0) AS card_sales,
    COALESCE(SUM(CASE WHEN s.payment_method = 'credit' THEN s.total ELSE 0 END), 0) AS credit_sales,
    COALESCE(SUM(sl.quantity), 0)::BIGINT AS item_count
  FROM public.pharmacy_sales s
  LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.sale_date::DATE
  ORDER BY s.sale_date::DATE DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 2. Top selling items
CREATE OR REPLACE FUNCTION public.get_top_selling_items(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 20,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  total_quantity NUMERIC,
  total_sales NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sl.item_id,
    COALESCE(i.name_ar, sl.item_name, '') AS item_name,
    i.sku,
    SUM(sl.quantity) AS total_quantity,
    SUM(sl.net_total) AS total_sales,
    SUM(sl.purchase_price * sl.quantity) AS total_cost,
    SUM(sl.net_total - (sl.purchase_price * sl.quantity)) AS total_profit,
    COUNT(DISTINCT s.id)::BIGINT AS sale_count
  FROM public.pharmacy_sale_lines sl
  JOIN public.pharmacy_sales s ON s.id = sl.sale_id AND s.pharmacy_id = sl.pharmacy_id
  LEFT JOIN public.pharmacy_items i ON i.id = sl.item_id AND i.pharmacy_id = sl.pharmacy_id
  WHERE sl.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY sl.item_id, i.name_ar, i.sku
  ORDER BY total_sales DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) TO authenticated;

-- 3. Profit & loss summary
CREATE OR REPLACE FUNCTION public.get_profit_loss_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  period_label TEXT,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  gross_profit NUMERIC,
  gross_margin_percent NUMERIC,
  total_discounts NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
BEGIN
  v_period := to_char(p_from_date, 'YYYY-MM') || ' to ' || to_char(p_to_date, 'YYYY-MM');

  RETURN QUERY
  WITH sales_data AS (
    SELECT
      COALESCE(SUM(s.total), 0) AS total_revenue,
      COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
      COALESCE(SUM(s.discount_total), 0) AS total_discounts,
      COUNT(DISTINCT s.id)::BIGINT AS invoice_count
    FROM public.pharmacy_sales s
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status NOT IN ('void', 'cancelled')
      AND s.sale_date::DATE >= p_from_date
      AND s.sale_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  ),
  expense_data AS (
    SELECT COALESCE(SUM(amount), 0) AS total_expenses
    FROM public.pharmacy_financial_movements
    WHERE pharmacy_id = p_pharmacy_id
      AND direction = 'out'
      AND category = 'expense'
      AND movement_date::DATE >= p_from_date
      AND movement_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  )
  SELECT
    v_period AS period_label,
    sales_data.total_revenue,
    sales_data.total_cost,
    GREATEST(sales_data.total_revenue - sales_data.total_cost, 0) AS gross_profit,
    CASE WHEN sales_data.total_revenue > 0
      THEN ROUND((sales_data.total_revenue - sales_data.total_cost) / sales_data.total_revenue * 100, 2)
      ELSE 0
    END AS gross_margin_percent,
    sales_data.total_discounts,
    expense_data.total_expenses,
    GREATEST(sales_data.total_revenue - sales_data.total_cost - sales_data.total_discounts - expense_data.total_expenses, 0) AS net_profit,
    sales_data.invoice_count
  FROM sales_data, expense_data;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 4. Customer activity summary
CREATE OR REPLACE FUNCTION public.get_customer_activity_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  customer_name TEXT,
  invoice_count BIGINT,
  total_spent NUMERIC,
  total_discounts NUMERIC,
  last_visit_date TIMESTAMPTZ,
  average_invoice NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.customer_name,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_spent,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    MAX(s.sale_date) AS last_visit_date,
    ROUND(COALESCE(SUM(s.total), 0) / NULLIF(COUNT(DISTINCT s.id), 0), 2) AS average_invoice
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.customer_name IS NOT NULL
  GROUP BY s.customer_name
  ORDER BY total_spent DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 5. Tax summary
CREATE OR REPLACE FUNCTION public.get_tax_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tax_period TEXT,
  taxable_sales NUMERIC,
  tax_collected NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(s.sale_date::DATE, 'YYYY-MM') AS tax_period,
    COALESCE(SUM(s.subtotal - s.discount_total), 0) AS taxable_sales,
    COALESCE(SUM(s.tax_total), 0) AS tax_collected,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.tax_total > 0
  GROUP BY to_char(s.sale_date::DATE, 'YYYY-MM')
  ORDER BY tax_period DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- ===================================================================
-- get_user_active_pharmacy_id
-- Returns the user's active pharmacy_id based on pharmacy_profiles
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_user_active_pharmacy_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pharmacy_id
  FROM public.pharmacy_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY last_login_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_active_pharmacy_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_active_pharmacy_id() TO authenticated;


-- ===== 002_atomic_rpcs.sql =====
-- ===================================================================
-- ATOMIC RPC FUNCTIONS — Consolidated
-- Extracted from migration files 20260618001xxx–20260618012xxx
-- Order: sales (v1, v2, void) → returns → purchases → purchase returns → stock transfer → stock count approval
-- ===================================================================

-- ===================================================================
-- 1. create_cashier_sale (v1 — legacy)
-- Source: 20260618001000_atomic_cashier_sales.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_cashier_sale(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_available NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'Not allowed to create sales';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_branches
    WHERE id = p_branch_id
      AND pharmacy_id = p_pharmacy_id
      AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'Invalid branch';
  END IF;

  IF p_client_request_id IS NULL OR length(trim(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'client_request_id is required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line_row))
        FROM public.pharmacy_sale_lines line_row
        WHERE line_row.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one sale line is required';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status NOT IN ('deleted', 'inactive')
      AND NOT not_for_sale
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid item in sale';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid sale quantity for item %', v_item.name_ar;
    END IF;

    IF v_item.manage_inventory THEN
      SELECT quantity
      INTO v_available
      FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
      FOR UPDATE;

      v_available := COALESCE(v_available, 0);
      IF v_available < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_item.name_ar;
      END IF;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));
  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id,
    branch_id,
    invoice_number,
    client_request_id,
    customer_name,
    status,
    payment_status,
    payment_method,
    subtotal,
    discount_total,
    tax_total,
    total,
    paid_amount,
    due_amount,
    shipping_fee,
    rounding_adj,
    notes,
    created_by
  )
  VALUES (
    p_pharmacy_id,
    p_branch_id,
    v_invoice_number,
    p_client_request_id,
    COALESCE(NULLIF(trim(p_customer_name), ''), 'زبون نقدي'),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    COALESCE(NULLIF(trim(p_payment_method), ''), 'cash'),
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_total - v_paid, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(trim(p_notes), ''),
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_line_total := GREATEST(v_quantity * v_unit_price - v_line_discount, 0);

    INSERT INTO public.pharmacy_sale_lines (
      pharmacy_id,
      sale_id,
      item_id,
      item_name,
      barcode,
      unit,
      quantity,
      unit_price,
      purchase_price,
      discount,
      net_total
    )
    VALUES (
      p_pharmacy_id,
      v_sale.id,
      v_item.id,
      v_item.name_ar,
      NULLIF(trim(v_line->>'barcode'), ''),
      COALESCE(NULLIF(trim(v_line->>'unit'), ''), v_item.unit, 'unit'),
      v_quantity,
      v_unit_price,
      v_item.buy_price,
      v_line_discount,
      round(v_line_total, 2)
    );

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id,
      branch_id,
      item_id,
      direction,
      quantity,
      unit_price,
      total_value,
      movement_type,
      source_table,
      source_id,
      created_by
    )
    VALUES (
      p_pharmacy_id,
      p_branch_id,
      v_item.id,
      'out',
      v_quantity,
      v_unit_price,
      round(v_line_total, 2),
      'sale',
      'pharmacy_sales',
      v_sale.id,
      v_actor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(line_row))
      FROM public.pharmacy_sale_lines line_row
      WHERE line_row.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 2. create_cashier_sale_v2 (newer version with shift + FEFO)
-- Source: 20260618005000_cashier_atomic_fefo_security.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_cashier_sale_v2(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,
  p_patient_name TEXT DEFAULT NULL,
  p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_coupon public.pharmacy_coupons%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_remaining_quantity NUMERIC;
  v_alloc_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_remaining_discount NUMERIC;
  v_alloc_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_coupon_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
  v_has_batches BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تنفيذ البيع';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية البيع غير صالح';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
        FROM public.pharmacy_sale_lines sale_line
        WHERE sale_line.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_shift
  FROM public.pharmacy_shifts
  WHERE id = p_shift_id
    AND pharmacy_id = p_pharmacy_id
    AND branch_id = p_branch_id
    AND user_id = v_actor_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'جلسة الكاشير غير مفتوحة أو انتهت';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND COALESCE(not_for_sale, false) = false
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير صالح للبيع';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية البيع غير صحيحة للصنف %', v_item.name_ar;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));

  -- Coupon validation
  IF p_coupon_code IS NOT NULL AND length(BTRIM(p_coupon_code)) > 0 THEN
    SELECT * INTO v_coupon
    FROM public.pharmacy_coupons
    WHERE pharmacy_id = p_pharmacy_id
      AND code = UPPER(BTRIM(p_coupon_code))
      AND is_active = true
      AND (max_uses = 0 OR used_count < max_uses)
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      IF v_subtotal - v_line_discounts < v_coupon.min_purchase THEN
        RAISE EXCEPTION 'الطلب لا يستوفي الحد الأدنى للشراء للكوبون (%)', v_coupon.code;
      END IF;

      v_coupon_discount := CASE
        WHEN v_coupon.discount_type = 'percentage'
          THEN round((v_subtotal - v_line_discounts) * v_coupon.discount_value / 100, 2)
        ELSE v_coupon.discount_value
      END;
      v_coupon_discount := LEAST(v_coupon_discount, GREATEST(v_subtotal - v_line_discounts - v_invoice_discount, 0));
    ELSE
      RAISE EXCEPTION 'الكوبون غير صالح أو منتهي الصلاحية';
    END IF;
  END IF;

  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount - v_coupon_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_due := GREATEST(v_total - v_paid, 0);
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id, branch_id, shift_id, invoice_number, client_request_id,
    customer_name, patient_name, doctor_name, prescription_number,
    status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, rounding_adj, notes, coupon_id, coupon_discount, coupon_code, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, p_shift_id, v_invoice_number, p_client_request_id,
    COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'),
    NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''), NULLIF(BTRIM(p_prescription_number), ''),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method,
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount + v_coupon_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_due, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(BTRIM(p_notes), ''),
    CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.id ELSE NULL END,
    round(v_coupon_discount, 2),
    CASE WHEN v_coupon.id IS NOT NULL THEN UPPER(BTRIM(p_coupon_code)) ELSE NULL END,
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
        AND quantity >= v_quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'الكمية غير كافية للصنف: %', v_item.name_ar;
      END IF;
    END IF;

    v_remaining_quantity := v_quantity;
    v_remaining_discount := v_line_discount;
    SELECT EXISTS (
      SELECT 1
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
    ) INTO v_has_batches;

    FOR v_batch IN
      SELECT batch_row.*
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
        AND (batch_row.expiry_date IS NULL OR batch_row.expiry_date >= CURRENT_DATE)
      ORDER BY batch_row.expiry_date ASC NULLS LAST, batch_row.created_at ASC, batch_row.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_quantity <= 0;
      v_alloc_quantity := LEAST(v_remaining_quantity, v_batch.remaining_quantity);
      v_alloc_discount := CASE
        WHEN v_alloc_quantity = v_remaining_quantity THEN v_remaining_discount
        ELSE LEAST(v_remaining_discount, round(v_line_discount * (v_alloc_quantity / v_quantity), 2))
      END;
      v_line_total := GREATEST(v_alloc_quantity * v_unit_price - v_alloc_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, batch_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_batch.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_alloc_quantity, v_unit_price, v_item.buy_price, v_alloc_discount, round(v_line_total, 2)
      );

      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_alloc_quantity,
          updated_at = now()
      WHERE id = v_batch.id;

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'out', v_alloc_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );

      v_remaining_quantity := v_remaining_quantity - v_alloc_quantity;
      v_remaining_discount := GREATEST(v_remaining_discount - v_alloc_discount, 0);
    END LOOP;

    IF v_remaining_quantity > 0 AND v_has_batches AND (v_item.track_batch OR v_item.has_expiry) THEN
      RAISE EXCEPTION 'لا توجد تشغيلة صالحة بكمية كافية للصنف: %', v_item.name_ar;
    END IF;

    IF v_remaining_quantity > 0 THEN
      v_line_total := GREATEST(v_remaining_quantity * v_unit_price - v_remaining_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_remaining_quantity, v_unit_price, v_item.buy_price, v_remaining_discount, round(v_line_total, 2)
      );

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, 'out', v_remaining_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );
    END IF;

    -- Auto-log controlled drug dispense
    IF v_item.is_controlled THEN
      INSERT INTO public.pharmacy_controlled_drugs_log (
        pharmacy_id, item_id, branch_id, action, quantity,
        patient_name, doctor_name, prescription_number, notes,
        created_by, created_at
      ) VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, 'dispensed',
        (v_line->>'quantity')::NUMERIC,
        NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''),
        NULLIF(BTRIM(p_prescription_number), ''),
        'صرف: ' || v_sale.invoice_number,
        v_actor_id, now()
      );
    END IF;
  END LOOP;

  -- Auto-create/link prescription
  IF NULLIF(BTRIM(p_prescription_number), '') IS NOT NULL OR NULLIF(BTRIM(p_patient_name), '') IS NOT NULL THEN
    DECLARE
      v_prescription_id UUID;
    BEGIN
      SELECT id INTO v_prescription_id
      FROM public.pharmacy_prescriptions
      WHERE pharmacy_id = p_pharmacy_id
        AND patient_name = COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'))
        AND status = 'open'
        AND sale_id IS NULL
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.pharmacy_prescriptions (
          pharmacy_id, branch_id, sale_id,
          patient_name, doctor_name, diagnosis,
          status, notes, created_by,
          dispensed_by, dispensed_at
        ) VALUES (
          p_pharmacy_id, p_branch_id, v_sale.id,
          COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي')),
          NULLIF(BTRIM(p_doctor_name), ''),
          NULLIF(BTRIM(p_prescription_number), ''),
          'dispensed', v_sale.invoice_number,
          v_actor_id, v_actor_id, now()
        );
      ELSE
        UPDATE public.pharmacy_prescriptions
        SET status = 'dispensed',
            sale_id = v_sale.id,
            doctor_name = COALESCE(NULLIF(BTRIM(p_doctor_name), ''), doctor_name),
            dispensed_by = v_actor_id,
            dispensed_at = now(),
            updated_at = now()
        WHERE id = v_prescription_id;
      END IF;
    END;
  END IF;

  v_cash_paid := CASE WHEN v_method = 'cash' THEN v_paid ELSE 0 END;
  v_card_paid := CASE WHEN v_method IN ('card', 'wallet', 'mixed') THEN v_paid ELSE 0 END;

  UPDATE public.pharmacy_shifts
  SET cash_sales = COALESCE(cash_sales, 0) + v_cash_paid,
      card_sales = COALESCE(card_sales, 0) + v_card_paid,
      credit_sales = COALESCE(credit_sales, 0) + v_due,
      total_collected = COALESCE(total_collected, 0) + v_paid,
      expected_balance = COALESCE(opening_balance, 0) + COALESCE(cash_sales, 0) + v_cash_paid - COALESCE(total_expenses, 0),
      updated_at = now()
  WHERE id = p_shift_id;

  IF v_coupon.id IS NOT NULL THEN
    UPDATE public.pharmacy_coupons
    SET used_count = used_count + 1,
        updated_at = now()
    WHERE id = v_coupon.id;
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
      FROM public.pharmacy_sale_lines sale_line
      WHERE sale_line.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 3. void_cashier_sale
-- Source: 20260618005000_cashier_atomic_fefo_security.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_cashier_sale(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المبيعات';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'sale', to_jsonb(v_sale));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.pharmacy_sale_lines
    WHERE sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.unit_price, v_line.net_total,
      'sale_void', 'pharmacy_sales', v_sale.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة بيع'),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  v_cash_paid := CASE WHEN v_sale.payment_method = 'cash' THEN v_sale.paid_amount ELSE 0 END;
  v_card_paid := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_sale.paid_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_paid, 0),
        credit_sales = GREATEST(COALESCE(credit_sales, 0) - COALESCE(v_sale.due_amount, 0), 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - COALESCE(v_sale.paid_amount, 0), 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'sale', to_jsonb(v_sale));
END;
$$;

REVOKE ALL ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===================================================================
-- 4. create_sales_return
-- Source: 20260618006000_atomic_sales_returns.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_sales_return(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_reason TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_return public.pharmacy_sales_returns%ROWTYPE;
  v_sale_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_due_reduction NUMERIC := 0;
  v_refund_amount NUMERIC := 0;
  v_cash_refund NUMERIC := 0;
  v_card_refund NUMERIC := 0;
  v_return_number TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مبيعات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  SELECT *
    INTO v_return
  FROM public.pharmacy_sales_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_sales_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_sales_return_lines return_line
    JOIN public.pharmacy_sales_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.sale_line_id = v_sale_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_sale_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_sale_line.item_name;
    END IF;

    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  v_due_reduction := LEAST(GREATEST(COALESCE(v_sale.due_amount, 0), 0), v_total);
  v_refund_amount := LEAST(
    GREATEST(v_total - v_due_reduction, 0),
    GREATEST(COALESCE(v_sale.paid_amount, 0), 0)
  );
  v_return_number := 'SRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales_returns (
    pharmacy_id, branch_id, sale_id, return_number, client_request_id,
    customer_name, total, refund_amount, stock_mode, reason,
    return_date, created_by
  )
  VALUES (
    p_pharmacy_id, v_sale.branch_id, v_sale.id, v_return_number, p_client_request_id,
    v_sale.customer_name, v_total, v_refund_amount, 'restore_original_batch',
    NULLIF(BTRIM(p_reason), ''), now(), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);

    INSERT INTO public.pharmacy_sales_return_lines (
      pharmacy_id, return_id, sale_line_id, item_id, batch_id,
      quantity, unit_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_sale_line.id, v_sale_line.item_id, v_sale_line.batch_id,
      v_quantity, round(v_line_total / v_quantity, 2), v_line_total
    );

    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_sale_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_sale_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_quantity,
          updated_at = now()
      WHERE id = v_sale_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_sale_line.batch_id,
      'in', v_quantity, round(v_line_total / v_quantity, 2), v_line_total,
      'sales_return', 'pharmacy_sales_returns', v_return.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0),
      due_amount = GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0),
      payment_status = CASE
        WHEN GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0) <= 0 THEN 'paid'
        WHEN GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0) > 0 THEN 'partial'
        ELSE 'unpaid'
      END,
      updated_at = now()
  WHERE id = v_sale.id;

  IF v_refund_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, 'sales_return', 'customer_refund',
      v_refund_amount, 'out', 'pharmacy_sales_returns', v_return.id,
      'رد قيمة مرتجع الفاتورة ' || v_sale.invoice_number, now(), v_actor_id
    );
  END IF;

  v_cash_refund := CASE WHEN v_sale.payment_method = 'cash' THEN v_refund_amount ELSE 0 END;
  v_card_refund := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_refund_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL AND v_refund_amount > 0 THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_refund, 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - v_refund_amount, 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_sales_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'due_reduction', v_due_reduction,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB)
  TO authenticated, service_role;


-- ===================================================================
-- 5. create_received_purchase
-- Source: 20260618007000_atomic_received_purchases.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_received_purchase(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_supplier_id UUID,
  p_supplier_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_header_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_notes TEXT,
  p_purchase_date TIMESTAMPTZ,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_supplier public.pharmacy_partners%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_buy_price NUMERIC;
  v_sell_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_header_discount NUMERIC;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_purchase_number TEXT;
  v_batch_number TEXT;
  v_expiry_date DATE;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل المشتريات';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches
    WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'الفرع غير صالح أو مغلق';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية الشراء غير صالح';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'purchase', to_jsonb(v_purchase),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
        FROM public.pharmacy_purchase_lines purchase_line
        WHERE purchase_line.purchase_id = v_purchase.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier
    FROM public.pharmacy_partners
    WHERE id = p_supplier_id
      AND pharmacy_id = p_pharmacy_id
      AND type IN ('supplier', 'both')
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير صالح'; END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'يوجد صنف غير صالح في فاتورة الشراء'; END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_line_discount := GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0);
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'كمية الشراء غير صحيحة للصنف %', v_item.name_ar; END IF;
    IF v_buy_price < 0 THEN RAISE EXCEPTION 'سعر الشراء غير صحيح للصنف %', v_item.name_ar; END IF;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_buy_price);
    v_subtotal := v_subtotal + (v_quantity * v_buy_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  v_header_discount := LEAST(
    GREATEST(COALESCE(p_header_discount, 0), 0),
    GREATEST(v_subtotal - v_line_discounts, 0)
  );
  v_total := round(GREATEST(v_subtotal - v_line_discounts - v_header_discount + v_tax_total + v_shipping_fee, 0), 2);
  v_paid := round(LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0)), 2);
  v_due := round(GREATEST(v_total - v_paid, 0), 2);
  v_purchase_number := 'PUR-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchases (
    pharmacy_id, branch_id, purchase_number, client_request_id,
    supplier_id, supplier_name, status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, notes, purchase_date, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, v_purchase_number, p_client_request_id,
    p_supplier_id,
    COALESCE(NULLIF(BTRIM(p_supplier_name), ''), v_supplier.name, 'مورد نقدي'),
    'received',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method, round(v_subtotal, 2), round(v_line_discounts + v_header_discount, 2),
    round(v_tax_total, 2), v_total, v_paid, v_due, round(v_shipping_fee, 2),
    NULLIF(BTRIM(p_notes), ''), COALESCE(p_purchase_date, now()), v_actor_id
  )
  RETURNING * INTO v_purchase;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_sell_price := GREATEST(COALESCE((v_line->>'sell_price')::NUMERIC, v_item.sell_price), 0);
    v_line_discount := LEAST(
      GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0),
      v_quantity * v_buy_price
    );
    v_line_total := round(GREATEST(v_quantity * v_buy_price - v_line_discount, 0), 2);
    v_batch_number := NULLIF(BTRIM(v_line->>'batch_number'), '');
    v_expiry_date := NULLIF(v_line->>'expiry_date', '')::DATE;

    IF (v_item.track_batch OR v_item.has_expiry) AND v_batch_number IS NULL THEN
      v_batch_number := 'PUR-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 8));
    END IF;
    IF v_item.has_expiry AND v_expiry_date IS NULL THEN
      RAISE EXCEPTION 'تاريخ الصلاحية مطلوب للصنف %', v_item.name_ar;
    END IF;

    IF v_batch_number IS NOT NULL OR v_expiry_date IS NOT NULL OR v_item.track_batch OR v_item.has_expiry THEN
      INSERT INTO public.pharmacy_item_batches (
        pharmacy_id, item_id, branch_id, batch_number, expiry_date,
        quantity, remaining_quantity, unit, cost_price, source_type, source_id
      )
      VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, v_batch_number, v_expiry_date,
        v_quantity, v_quantity, COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
        v_buy_price, 'purchase', v_purchase.id::TEXT
      )
      RETURNING * INTO v_batch;
    ELSE
      v_batch.id := NULL;
    END IF;

    INSERT INTO public.pharmacy_purchase_lines (
      pharmacy_id, purchase_id, item_id, batch_id, item_name, unit,
      batch_number, expiry_date, quantity, buy_price, sell_price, discount, net_total
    )
    VALUES (
      p_pharmacy_id, v_purchase.id, v_item.id, v_batch.id, v_item.name_ar,
      COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
      v_batch_number, v_expiry_date, v_quantity, v_buy_price, v_sell_price,
      v_line_discount, v_line_total
    );

    IF v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (p_pharmacy_id, p_branch_id, v_item.id, v_quantity, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    UPDATE public.pharmacy_items
    SET buy_price = v_buy_price,
        sell_price = CASE WHEN v_sell_price > 0 THEN v_sell_price ELSE sell_price END,
        updated_at = now()
    WHERE id = v_item.id AND pharmacy_id = p_pharmacy_id;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'in', v_quantity,
      v_buy_price, v_line_total, 'purchase', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF p_supplier_id IS NOT NULL AND v_due > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = COALESCE(balance, 0) + v_due,
        updated_at = now()
    WHERE id = p_supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_paid > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, 'purchase', 'supplier_payment', v_paid, 'out',
      'pharmacy_purchases', v_purchase.id,
      'سداد فاتورة شراء ' || v_purchase.purchase_number,
      COALESCE(p_purchase_date, now()), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
      FROM public.pharmacy_purchase_lines purchase_line
      WHERE purchase_line.purchase_id = v_purchase.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 6. void_received_purchase
-- Source: 20260618007000_atomic_received_purchases.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_received_purchase(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المشتريات';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'purchase', to_jsonb(v_purchase));
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id
        AND quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن مخزون الصنف % تم استخدامه', COALESCE(v_line.item_name, v_item.name_ar);
    END IF;

    IF v_line.batch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_item_batches
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id
        AND remaining_quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن كمية من التشغيلة % تم صرفها', COALESCE(v_line.batch_number, 'المستلمة');
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_line.quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id;
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_line.item_id, v_line.batch_id,
      'out', v_line.quantity, v_line.buy_price, v_line.net_total,
      'purchase_void', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.supplier_id IS NOT NULL AND v_purchase.due_amount > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = GREATEST(COALESCE(balance, 0) - v_purchase.due_amount, 0),
        updated_at = now()
    WHERE id = v_purchase.supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_purchase.paid_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_void', 'supplier_refund',
      v_purchase.paid_amount, 'in', 'pharmacy_purchases', v_purchase.id,
      'عكس سداد فاتورة شراء ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  UPDATE public.pharmacy_purchases
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة شراء مستلمة'),
      updated_at = now()
  WHERE id = p_purchase_id
  RETURNING * INTO v_purchase;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'purchase', to_jsonb(v_purchase));
END;
$$;

REVOKE ALL ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===================================================================
-- 7. create_purchase_return
-- Source: 20260618009000_atomic_purchase_returns_rpc.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_purchase_return(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_stock_mode TEXT DEFAULT 'restock',
  p_reason TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_return_number TEXT;
  v_stock_mode TEXT := COALESCE(NULLIF(BTRIM(p_stock_mode), ''), 'restock');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مشتريات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  IF v_stock_mode NOT IN ('restock', 'write-off') THEN
    RAISE EXCEPTION 'نظام المخزون غير صالح';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_purchase_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة الشراء غير موجودة';
  END IF;

  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_purchase_return_lines return_line
    JOIN public.pharmacy_purchase_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.purchase_line_id = v_purchase_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_purchase_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_purchase_line.item_name;
    END IF;

    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  v_return_number := 'PRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchase_returns (
    pharmacy_id, branch_id, purchase_id, return_number, client_request_id,
    supplier_name, total, refund_amount, stock_mode, reason, created_by
  )
  VALUES (
    p_pharmacy_id, v_purchase.branch_id, v_purchase.id, v_return_number, p_client_request_id,
    v_purchase.supplier_name, v_total, v_total, v_stock_mode,
    NULLIF(BTRIM(p_reason), ''), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);

    INSERT INTO public.pharmacy_purchase_return_lines (
      pharmacy_id, return_id, purchase_line_id, item_id, batch_id,
      quantity, unit, buy_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_purchase_line.id, v_purchase_line.item_id, v_purchase_line.batch_id,
      v_quantity, v_purchase_line.unit, v_purchase_line.buy_price, v_line_total
    );

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_purchase_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF v_stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = GREATEST(quantity - v_quantity, 0),
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_purchase.branch_id
          AND item_id = v_purchase_line.item_id;
      END IF;

      IF v_purchase_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = GREATEST(remaining_quantity - v_quantity, 0),
            updated_at = now()
        WHERE id = v_purchase_line.batch_id
          AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_purchase_line.item_id, v_purchase_line.batch_id,
      'out', v_quantity, v_purchase_line.buy_price, v_line_total,
      CASE WHEN v_stock_mode = 'restock' THEN 'purchase_return' ELSE 'purchase_return_write_off' END,
      'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET paid_amount = GREATEST(COALESCE(paid_amount, 0), 0),
        due_amount = GREATEST(COALESCE(due_amount, 0) - v_total, 0),
        payment_status = CASE
          WHEN GREATEST(COALESCE(due_amount, 0) - v_total, 0) <= 0 THEN 'paid'
          WHEN GREATEST(COALESCE(paid_amount, 0), 0) > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE id = v_purchase.id;

    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_return', 'supplier_refund',
      v_total, 'in', 'pharmacy_purchase_returns', v_return.id,
      'مرتجع مشتريات للفاتورة ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_purchase_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 8. void_purchase_return
-- Source: 20260618009000_atomic_purchase_returns_rpc.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_purchase_return(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_line public.pharmacy_purchase_return_lines%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء مرتجعات المشتريات';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE id = p_return_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'مرتجع الشراء غير موجود';
  END IF;

  IF v_return.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'return', to_jsonb(v_return));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_return.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع المرتجع';
  END IF;

  IF v_return.purchase_id IS NOT NULL THEN
    SELECT * INTO v_purchase
    FROM public.pharmacy_purchases
    WHERE id = v_return.purchase_id AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;
  END IF;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_return_lines
    WHERE return_id = p_return_id AND pharmacy_id = p_pharmacy_id
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF v_return.stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = quantity + v_line.quantity,
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_return.branch_id
          AND item_id = v_line.item_id;
      END IF;

      IF v_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = remaining_quantity + v_line.quantity,
            updated_at = now()
        WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_return.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.buy_price, v_line.total,
      'purchase_return_void', 'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.id IS NOT NULL AND v_return.total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET due_amount = COALESCE(due_amount, 0) + v_return.total,
        payment_status = CASE
          WHEN COALESCE(due_amount, 0) + v_return.total > 0 THEN 'unpaid'
          ELSE payment_status
        END,
        updated_at = now()
    WHERE id = v_purchase.id;
  END IF;

  UPDATE public.pharmacy_purchase_returns
  SET voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء مرتجع شراء'),
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_return;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'return', to_jsonb(v_return));
END;
$$;

REVOKE ALL ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===================================================================
-- 9. complete_stock_transfer
-- Source: 20260618012000_operational_p2_transfers_counts_sync.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.complete_stock_transfer(
  p_pharmacy_id UUID,
  p_transfer_id UUID,
  p_actor_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.pharmacy_stock_transfers%ROWTYPE;
  v_line JSONB;
  v_item public.pharmacy_items%ROWTYPE;
  v_item_id UUID;
  v_qty NUMERIC;
  v_unit TEXT;
  v_remaining NUMERIC;
  v_moved_count INT := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:transfer.write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد التحويل المخزني';
  END IF;

  SELECT * INTO v_transfer
  FROM public.pharmacy_stock_transfers
  WHERE id = p_transfer_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود';
  END IF;

  IF v_transfer.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'duplicate', true);
  END IF;

  IF v_transfer.status IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ تحويل ملغي';
  END IF;

  IF v_transfer.from_branch_id = v_transfer.to_branch_id THEN
    RAISE EXCEPTION 'فرع المصدر والوجهة متطابقان';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches b
    WHERE b.pharmacy_id = p_pharmacy_id
      AND b.id IN (v_transfer.from_branch_id, v_transfer.to_branch_id)
    GROUP BY b.pharmacy_id
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'فروع التحويل لا تتبع نفس الصيدلية';
  END IF;

  IF jsonb_typeof(COALESCE(v_transfer.lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_transfer.lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'التحويل لا يحتوي على أصناف';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_transfer.lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::NUMERIC, 0);
    v_unit := NULLIF(BTRIM(COALESCE(v_line->>'unit', '')), '');

    IF v_item_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات أحد أصناف التحويل غير صحيحة';
    END IF;

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_item_id AND pharmacy_id = p_pharmacy_id AND status <> 'deleted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود داخل التحويل';
    END IF;

    IF COALESCE(v_item.manage_inventory, true) THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_qty,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND item_id = v_item_id
        AND branch_id = v_transfer.from_branch_id
        AND quantity >= v_qty
      RETURNING quantity INTO v_remaining;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'كمية غير كافية للصنف: %', v_item.name_ar;
      END IF;

      INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
      VALUES (p_pharmacy_id, v_item_id, v_transfer.to_branch_id, v_qty, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
                    updated_at = now();

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, item_id, batch_id, branch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      ) VALUES
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.from_branch_id, 'out', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_out', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      ),
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.to_branch_id, 'in', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_in', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      );

      v_moved_count := v_moved_count + 1;
    END IF;
  END LOOP;

  UPDATE public.pharmacy_stock_transfers
  SET status = 'completed',
      notes = CASE
        WHEN NULLIF(BTRIM(COALESCE(p_notes, '')), '') IS NULL THEN notes
        WHEN NULLIF(BTRIM(COALESCE(notes, '')), '') IS NULL THEN BTRIM(p_notes)
        ELSE notes || E'\n' || BTRIM(p_notes)
      END,
      updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'moved_lines', v_moved_count);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===================================================================
-- 10. approve_stock_count_variance (FINAL version)
-- Source: 20260618012000_operational_p2_transfers_counts_sync.sql
-- This is the FINAL version that supersedes 20260618010000.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.approve_stock_count_variance(
  p_pharmacy_id UUID,
  p_count_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_count public.pharmacy_stock_counts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_current_qty NUMERIC := 0;
  v_variance NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:stocktake', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد الجرد';
  END IF;

  SELECT * INTO v_count
  FROM public.pharmacy_stock_counts
  WHERE id = p_count_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الجرد غير موجود';
  END IF;

  IF v_count.status IN ('approved', 'void') THEN
    RAISE EXCEPTION 'سجل الجرد معتمد أو ملغي مسبقاً';
  END IF;

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND COALESCE(v_item.manage_inventory, true) THEN
    SELECT COALESCE(quantity, 0) INTO v_current_qty
    FROM public.pharmacy_stock_balances
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id
    FOR UPDATE;

    v_current_qty := COALESCE(v_current_qty, 0);
    v_variance := COALESCE(v_count.counted_qty, 0) - v_current_qty;

    INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
    VALUES (p_pharmacy_id, v_count.item_id, v_count.branch_id, GREATEST(COALESCE(v_count.counted_qty, 0), 0), now())
    ON CONFLICT (pharmacy_id, item_id, branch_id)
    DO UPDATE SET quantity = GREATEST(COALESCE(v_count.counted_qty, 0), 0), updated_at = now();

    IF v_variance != 0 THEN
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
        CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
        ABS(v_variance), COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * ABS(v_variance),
        'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
      );
    END IF;
  ELSE
    v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      expected_qty = COALESCE(v_current_qty, expected_qty),
      variance = v_variance,
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===== 003_rls_policies.sql =====
-- ===================================================================
-- RLS POLICIES — Consolidated
-- Organized by table alphabetically, using FINAL/LATEST version of each policy.
-- Dynamic DO blocks from migrations are converted to explicit CREATE POLICY statements.
-- ===================================================================

-- ===================================================================
-- developer_% tables (all 18 developer tables)
-- Source: 20260618004000 (final) — converted from dynamic DO block
-- ===================================================================

DO $$DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'developer\_%'
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS developer_only_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY developer_only_all ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', tbl);
  END LOOP;
END$$;


-- ===================================================================
-- pharmacies
-- Source: 20260618004000 (final — identical to 20260617001000)
-- ===================================================================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacies_select ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_insert ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_update ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_delete ON public.pharmacies;

CREATE POLICY pharmacies_select ON public.pharmacies
FOR SELECT USING (public.has_pharmacy_access(id) OR owner_id = auth.uid());

CREATE POLICY pharmacies_insert ON public.pharmacies
FOR INSERT WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_update ON public.pharmacies
FOR UPDATE USING (public.is_developer() OR owner_id = auth.uid())
WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_delete ON public.pharmacies
FOR DELETE USING (public.is_developer());


-- ===================================================================
-- pharmacy_audit_events
-- Source: 20260617011000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_audit_events_select ON public.pharmacy_audit_events;
DROP POLICY IF EXISTS pharmacy_audit_events_insert ON public.pharmacy_audit_events;

CREATE POLICY pharmacy_audit_events_select ON public.pharmacy_audit_events
FOR SELECT USING (
  public.is_developer()
  OR public.user_pharmacy_role(pharmacy_id) = 'owner'
  OR public.user_has_permission(pharmacy_id, 'auth:audit.read')
);

CREATE POLICY pharmacy_audit_events_insert ON public.pharmacy_audit_events
FOR INSERT WITH CHECK (
  public.is_developer()
  OR public.has_pharmacy_access(pharmacy_id)
);


-- ===================================================================
-- pharmacy_backups
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_backups;

CREATE POLICY tenant_select ON public.pharmacy_backups
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_backups
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_backups
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_backups
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_barcode_paper_settings
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_barcode_paper_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_barcode_paper_settings;

CREATE POLICY tenant_select ON public.pharmacy_barcode_paper_settings
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_barcode_paper_settings
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_barcode_paper_settings
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_barcode_paper_settings
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_branches
-- Source: 20260618004000 (final — uses user_has_permission with granular permissions)
-- ===================================================================
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_branches_select ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_insert ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_update ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_delete ON public.pharmacy_branches;

CREATE POLICY pharmacy_branches_select ON public.pharmacy_branches
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'branches:read'));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'branches:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'branches:delete'));


-- ===================================================================
-- pharmacy_cash_registers
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_cash_registers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_cash_registers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_cash_registers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_cash_registers;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_cash_registers
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_cash_registers
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_cash_registers
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_damaged_stock
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_damaged_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_damaged_stock;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_damaged_stock;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_damaged_stock;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_damaged_stock
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_damaged_stock
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_damaged_stock
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_deleted_items_audit
-- Source: 20260617003000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_deleted_items_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deleted_items_audit_select ON public.pharmacy_deleted_items_audit;
CREATE POLICY deleted_items_audit_select
ON public.pharmacy_deleted_items_audit FOR SELECT
USING (
  public.is_developer(auth.uid())
  OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
);


-- ===================================================================
-- pharmacy_expenses
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_expenses;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_expenses;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_expenses;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_expenses
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_expenses
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_expenses
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_financial_movements
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_financial_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_financial_movements;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_financial_movements;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_financial_movements;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_financial_movements
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_financial_movements
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_financial_movements
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_inapp_deleted_notifications
-- Source: 20260618004000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON public.pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
ON public.pharmacy_inapp_deleted_notifications FOR SELECT
USING (auth.uid() = user_id OR public.is_developer(auth.uid()));


-- ===================================================================
-- pharmacy_inapp_notifications
-- Source: 20260617002000 (final — not redefined in 20260618004000)
-- ===================================================================
ALTER TABLE public.pharmacy_inapp_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_owner_select ON pharmacy_inapp_notifications;
DROP POLICY IF EXISTS notif_owner_insert ON pharmacy_inapp_notifications;
DROP POLICY IF EXISTS notif_owner_update ON pharmacy_inapp_notifications;

CREATE POLICY notif_owner_select
ON pharmacy_inapp_notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY notif_owner_insert
ON pharmacy_inapp_notifications FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY notif_owner_update
ON pharmacy_inapp_notifications FOR UPDATE
USING (auth.uid() = user_id);


-- ===================================================================
-- pharmacy_inventory_snapshots
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_inventory_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_inventory_snapshots;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_inventory_snapshots;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_inventory_snapshots;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_inventory_snapshots
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_inventory_snapshots
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_inventory_snapshots
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_invoice_designs
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_invoice_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_invoice_designs;

CREATE POLICY tenant_select ON public.pharmacy_invoice_designs
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_invoice_designs
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_invoice_designs
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_invoice_designs
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_invoice_drafts
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_invoice_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_invoice_drafts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_invoice_drafts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_invoice_drafts;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_invoice_drafts
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_invoice_drafts
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_invoice_drafts
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_item_alternatives
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_alternatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_alternatives;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_alternatives;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_alternatives;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_alternatives
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_alternatives
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_alternatives
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_barcodes
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_barcodes;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_barcodes;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_barcodes;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_barcodes
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_barcodes
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_barcodes
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_batches
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_batches;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_batches;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_batches;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_item_batches
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_item_batches
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_item_batches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_units
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_units;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_units;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_units;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_units
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_units
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_units
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_variants
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_variants;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_variants;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_variants;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_variants
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_variants
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_variants
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_warranties
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_warranties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_warranties;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_warranties;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_warranties;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_warranties
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_warranties
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_warranties
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_items
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_items;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_items;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_items;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_items
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_items
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_items
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_notification_templates
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_notification_templates;

CREATE POLICY tenant_select ON public.pharmacy_notification_templates
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_notification_templates
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_notification_templates
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_notification_templates
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_partners
-- Source: 20260617001000 (original DO block — not refined in later migrations)
-- ===================================================================
ALTER TABLE public.pharmacy_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_partners;

CREATE POLICY tenant_select ON public.pharmacy_partners
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_partners
FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_update ON public.pharmacy_partners
FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id))
WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_delete ON public.pharmacy_partners
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_payment_allocations
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_payment_allocations;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_payment_allocations;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_payment_allocations;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_payment_allocations
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_update ON public.pharmacy_payment_allocations
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_delete ON public.pharmacy_payment_allocations
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_payments
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_payments;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_payments;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_payments;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_payments
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_payments
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_payments
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_prescriptions
-- Source: 20260618011000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_prescriptions_read ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_read ON public.pharmacy_prescriptions
  FOR SELECT TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid())
  );

DROP POLICY IF EXISTS pharmacy_prescriptions_write ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_write ON public.pharmacy_prescriptions
  FOR ALL TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  )
  WITH CHECK (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  );


-- ===================================================================
-- pharmacy_price_groups
-- Source: 20260618011000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_price_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_price_groups_read ON public.pharmacy_price_groups;
DROP POLICY IF EXISTS pharmacy_price_groups_write ON public.pharmacy_price_groups;

CREATE POLICY pharmacy_price_groups_read ON public.pharmacy_price_groups
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:read', auth.uid()));

CREATE POLICY pharmacy_price_groups_write ON public.pharmacy_price_groups
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()));


-- ===================================================================
-- pharmacy_profiles
-- Source: 20260618004000 (final — _final policies)
-- ===================================================================
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_read_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete_final ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_read_final ON public.pharmacy_profiles
FOR SELECT USING (
  public.is_developer()
  OR user_id = auth.uid()
  OR public.user_has_permission(pharmacy_id, 'users:read')
);

CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);


-- ===================================================================
-- pharmacy_purchase_lines
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_update ON public.pharmacy_purchase_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_orders
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_orders;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_orders;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_orders;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_orders
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchase_orders
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_orders
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_return_lines
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_return_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_return_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_return_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_return_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_update ON public.pharmacy_purchase_return_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_return_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_returns
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_returns;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_returns;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_returns;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_returns
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchase_returns
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_returns
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchases
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchases;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchases;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchases;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchases
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchases
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchases
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_receipt_printers
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_receipt_printers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_receipt_printers;

CREATE POLICY tenant_select ON public.pharmacy_receipt_printers
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_receipt_printers
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_receipt_printers
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_receipt_printers
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_register_transactions
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_register_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_register_transactions;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_register_transactions;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_register_transactions;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_register_transactions
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_update ON public.pharmacy_register_transactions
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_delete ON public.pharmacy_register_transactions
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_sale_lines
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sale_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sale_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sale_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sale_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_sale_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_sale_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_sale_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_sales
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_sales
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_sales
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales_return_lines
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales_return_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales_return_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales_return_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_sales_return_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_sales_return_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_sales_return_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales_returns
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales_returns;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales_returns;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales_returns;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_sales_returns
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_sales_returns
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_sales_returns
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_settings
-- Source: 20260618004000 (final — inline settings policies)
-- ===================================================================
ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;

CREATE POLICY pharmacy_settings_select
ON public.pharmacy_settings
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND (
    pharmacy_id IS NULL
    OR public.has_pharmacy_access(pharmacy_id, auth.uid())
  )
);

CREATE POLICY pharmacy_settings_insert
ON public.pharmacy_settings
FOR INSERT
WITH CHECK (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
);

CREATE POLICY pharmacy_settings_update
ON public.pharmacy_settings
FOR UPDATE
USING (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
)
WITH CHECK (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
);

CREATE POLICY pharmacy_settings_delete
ON public.pharmacy_settings
FOR DELETE
USING (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
      )
    )
  )
);


-- ===================================================================
-- pharmacy_shifts
-- Source: 20260617001000 (original DO block — not refined in later migrations)
-- ===================================================================
ALTER TABLE public.pharmacy_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_shifts;

CREATE POLICY tenant_select ON public.pharmacy_shifts
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_insert ON public.pharmacy_shifts
FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_shifts
FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_shifts
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_stock_balances
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_balances;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_balances;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_balances;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_balances
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_balances
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_balances
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_counts
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_counts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_counts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_counts;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_counts
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_counts
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_counts
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_movements
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_movements;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_movements;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_movements;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_movements
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_movements
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_movements
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_transfers
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_transfers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_transfers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_transfers;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_transfers
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_stock_transfers
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_stock_transfers
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_suspended_invoices
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_suspended_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_suspended_invoices;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_suspended_invoices;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_suspended_invoices;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_suspended_invoices
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_suspended_invoices
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_suspended_invoices
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_tasks
-- Source: 20260618010000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_tenant_select ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_insert ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_update ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_delete ON public.pharmacy_tasks;

CREATE POLICY task_tenant_select ON public.pharmacy_tasks
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_insert ON public.pharmacy_tasks
  FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_update ON public.pharmacy_tasks
  FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_delete ON public.pharmacy_tasks
  FOR DELETE USING (public.has_pharmacy_access(pharmacy_id));


-- ===================================================================
-- pharmacy_tax_group_members
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_group_members;

CREATE POLICY tenant_select ON public.pharmacy_tax_group_members
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_group_members
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_group_members
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_group_members
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_tax_groups
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_groups;

CREATE POLICY tenant_select ON public.pharmacy_tax_groups
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_groups
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_groups
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_groups
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_tax_rates
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_rates;

CREATE POLICY tenant_select ON public.pharmacy_tax_rates
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_rates
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_rates
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_rates
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- user_profiles
-- Source: 20260618004000 (final — identical to 20260617001000)
-- ===================================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON public.user_profiles;

CREATE POLICY user_profiles_select ON public.user_profiles
FOR SELECT USING (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_insert ON public.user_profiles
FOR INSERT WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_update ON public.user_profiles
FOR UPDATE USING (public.is_developer() OR user_id = auth.uid())
WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_delete ON public.user_profiles
FOR DELETE USING (public.is_developer());


-- ===== 004_triggers_views_constraints.sql =====
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


-- ===== 005_data_migrations.sql =====
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


-- ===== 20260617000000_pharmacy_system_complete_schema.sql =====
-- ===================================================================
-- PHARMACY SYSTEM - COMPLETE DATABASE SCHEMA
-- نظام الصيدلية الشامل - الإدارة والحسابات المتكاملة
-- Architecture: UUID PKs + pharmacy_id FK (multi-tenant)
-- Source: pharmacy (13) + old-pharmacy (11) + new-pharmacy (5 migs)
-- ===================================================================

-- ========================
-- 0. EXTENSIONS
-- ========================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ========================
-- 1. CORE / TENANCY
-- ========================

CREATE TABLE IF NOT EXISTS pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  commercial_registry TEXT,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','suspended','closed')),
  plan TEXT DEFAULT 'trial' NOT NULL,
  currency TEXT DEFAULT 'EGP' NOT NULL,
  country TEXT DEFAULT 'EG',
  timezone TEXT DEFAULT 'Africa/Cairo',
  logo_url TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_name TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

CREATE TABLE IF NOT EXISTS pharmacy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK(role IN ('admin','manager','pharmacist','cashier','viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, user_id)
);

-- ========================
-- 2. PARTNERS (Customers + Suppliers unified)
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('customer','supplier','both')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_limit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'الرئيسي' NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  phone TEXT,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 3. ITEMS / INVENTORY
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_item_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  parent_id UUID REFERENCES pharmacy_item_groups(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  group_id UUID REFERENCES pharmacy_item_groups(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES pharmacy_item_brands(id) ON DELETE SET NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  sku TEXT,
  category TEXT,
  unit TEXT DEFAULT 'unit' NOT NULL,
  manufacturer_name TEXT,
  item_type TEXT DEFAULT 'stocked' NOT NULL CHECK(item_type IN ('stocked','service','digital','consignment')),
  buy_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  old_sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  manage_inventory BOOLEAN DEFAULT true NOT NULL,
  not_for_sale BOOLEAN DEFAULT false NOT NULL,
  min_stock NUMERIC(14,3) DEFAULT 0,
  max_stock NUMERIC(14,3) DEFAULT 0,
  opening_stock NUMERIC(14,3) DEFAULT 0,
  has_expiry BOOLEAN DEFAULT false,
  track_batch BOOLEAN DEFAULT false,
  is_controlled BOOLEAN DEFAULT false,
  requires_prescription BOOLEAN DEFAULT false,
  expiry_date DATE,
  image_url TEXT,
  search_text TEXT DEFAULT '' NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, sku)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, barcode)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  factor NUMERIC(14,3) DEFAULT 1 NOT NULL CHECK(factor > 0),
  barcode TEXT,
  sell_price NUMERIC(14,2),
  is_base BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, item_id, unit_name)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sell_price NUMERIC(14,2),
  barcode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_item_warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_days INT NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_item_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  alternative_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  priority INT DEFAULT 0 NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, item_id, alternative_item_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_item_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  batch_number TEXT,
  expiry_date DATE,
  quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  remaining_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  unit TEXT,
  cost_price NUMERIC(14,2) DEFAULT 0,
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 4. STOCK MANAGEMENT
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_stock_balances (
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, item_id, branch_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out','adjust')),
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  movement_type TEXT NOT NULL,
  source_table TEXT,
  source_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  to_branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  transfer_number TEXT,
  lines JSONB DEFAULT '[]'::jsonb NOT NULL,
  total_items INT DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'completed' NOT NULL CHECK(status IN ('draft','completed','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, transfer_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_damaged_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit TEXT,
  reason TEXT,
  cost_value NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'posted',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  expected_qty NUMERIC(14,3) DEFAULT 0,
  counted_qty NUMERIC(14,3) DEFAULT 0,
  variance NUMERIC(14,3) DEFAULT 0,
  unit TEXT,
  notes TEXT,
  status TEXT DEFAULT 'posted',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  total_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  total_purchase_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_sale_value NUMERIC(14,2) DEFAULT 0 NOT NULL,
  items JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 5. SALES
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  customer_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT 'زبون نقدي' NOT NULL,
  status TEXT DEFAULT 'invoice' NOT NULL,
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0,
  rounding_adj NUMERIC(14,2) DEFAULT 0,
  shift_id UUID,
  notes TEXT,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  reversal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  item_name TEXT,
  barcode TEXT,
  unit TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  purchase_price NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES pharmacy_sales(id) ON DELETE SET NULL,
  return_number TEXT NOT NULL,
  customer_name TEXT DEFAULT 'زبون نقدي' NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  stock_mode TEXT,
  reason TEXT,
  return_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, return_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_sales_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES pharmacy_sales_returns(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_suspended_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT 'زبون نقدي',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(14,2) DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_invoice_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  draft_type TEXT NOT NULL CHECK(draft_type IN ('sale','purchase','expense','return')),
  title TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 6. PURCHASES
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  purchase_number TEXT NOT NULL,
  supplier_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  status TEXT DEFAULT 'received' NOT NULL,
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, purchase_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES pharmacy_purchases(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  purchase_id UUID REFERENCES pharmacy_purchases(id) ON DELETE SET NULL,
  return_number TEXT NOT NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  stock_mode TEXT,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, return_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_purchase_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES pharmacy_purchase_returns(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  expected_date DATE,
  lines JSONB DEFAULT '[]'::jsonb NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL CHECK(status IN ('pending','approved','ordered','received','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 7. EXPENSES
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES pharmacy_expense_categories(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  category_id UUID REFERENCES pharmacy_expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payment_method TEXT DEFAULT 'cash' NOT NULL,
  paid_to TEXT,
  notes TEXT,
  expense_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 8. PAYMENTS / TRANSACTIONS
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  partner_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('sale','purchase','expense','return','transfer')),
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  payment_method TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  notes TEXT,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES pharmacy_payments(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 9. ORDERS / E-COMMERCE
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  customer_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'عميل',
  shipping_address_id UUID REFERENCES pharmacy_customer_addresses(id) ON DELETE SET NULL,
  shipping_fee NUMERIC(14,2) DEFAULT 0 NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  tax_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  due_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  payment_status TEXT DEFAULT 'unpaid' NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','preparing','shipped','delivered','cancelled','returned')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, order_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES pharmacy_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 10. COUPONS & BUNDLES
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
  discount_value NUMERIC(14,2) NOT NULL,
  min_purchase NUMERIC(14,2) DEFAULT 0,
  max_uses INT DEFAULT 0,
  used_count INT DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

CREATE TABLE IF NOT EXISTS pharmacy_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  total_original_price NUMERIC(14,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL REFERENCES pharmacy_bundles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bundle_id, item_id)
);

-- ========================
-- 11. ACCOUNTING
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
  parent_id UUID REFERENCES pharmacy_chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, code)
);

CREATE TABLE IF NOT EXISTS pharmacy_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  description TEXT,
  source_table TEXT,
  source_id UUID,
  total_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, entry_number)
);

CREATE TABLE IF NOT EXISTS pharmacy_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES pharmacy_journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES pharmacy_chart_of_accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_account_balances (
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES pharmacy_chart_of_accounts(id) ON DELETE RESTRICT,
  period TEXT NOT NULL,
  opening_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  opening_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  debit_movements NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_movements NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_debit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, account_id, period)
);

CREATE TABLE IF NOT EXISTS pharmacy_tax_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

CREATE TABLE IF NOT EXISTS pharmacy_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  date_key TEXT NOT NULL,
  sales_count INT DEFAULT 0 NOT NULL,
  sales_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sales_profit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  purchases_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  expenses_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  returns_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_profit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_cash NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_card NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_credit NUMERIC(14,2) DEFAULT 0 NOT NULL,
  payments_other NUMERIC(14,2) DEFAULT 0 NOT NULL,
  collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, branch_id, date_key)
);

CREATE TABLE IF NOT EXISTS pharmacy_financial_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  source_table TEXT,
  source_id UUID,
  description TEXT,
  movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_barcode_label_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rows INT NOT NULL DEFAULT 6,
  cols INT NOT NULL DEFAULT 4,
  margins TEXT DEFAULT '10,10,10,10',
  spacing TEXT DEFAULT '2,2',
  label_width_mm NUMERIC(6,2) NOT NULL DEFAULT 50,
  label_height_mm NUMERIC(6,2) NOT NULL DEFAULT 30,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 12. CASH MANAGEMENT
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_cash_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'closed' NOT NULL CHECK(status IN ('open','closed')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_register_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  register_id UUID NOT NULL REFERENCES pharmacy_cash_registers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('sale','expense','in','out','refund','withdraw','deposit')),
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE RESTRICT,
  register_id UUID REFERENCES pharmacy_cash_registers(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
  closing_balance NUMERIC(14,2),
  expected_balance NUMERIC(14,2),
  difference NUMERIC(14,2) DEFAULT 0 NOT NULL,
  cash_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  card_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  credit_sales NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_collected NUMERIC(14,2) DEFAULT 0 NOT NULL,
  total_expenses NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'open' NOT NULL CHECK(status IN ('open','closed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 13. LOYALTY SYSTEM
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  points INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, partner_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('earn','redeem','expire','adjust')),
  points INT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_loyalty_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE CASCADE,
  total_earned INT DEFAULT 0 NOT NULL,
  total_redeemed INT DEFAULT 0 NOT NULL,
  total_expired INT DEFAULT 0 NOT NULL,
  current_balance INT DEFAULT 0 NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, partner_id)
);

-- ========================
-- 14. MANUFACTURING
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_manufacturing_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  product_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  yield_quantity NUMERIC(14,3) DEFAULT 1 NOT NULL,
  cost_price NUMERIC(14,2) DEFAULT 0,
  sell_price NUMERIC(14,2) DEFAULT 0,
  instructions TEXT,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','inactive','archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES pharmacy_manufacturing_recipes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit TEXT,
  wastage_pct NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, item_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_manufacturing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES pharmacy_manufacturing_recipes(id) ON DELETE RESTRICT,
  batch_number TEXT,
  product_item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  expiry_date DATE,
  status TEXT DEFAULT 'completed' NOT NULL CHECK(status IN ('planned','in_progress','completed','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 15. CONTROLLED DRUGS
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_controlled_drugs_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('received','dispensed','destroyed','transfer','adjustment')),
  quantity NUMERIC(14,3) NOT NULL,
  patient_name TEXT,
  doctor_name TEXT,
  prescription_number TEXT,
  id_number TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 16. CONSIGNMENT STOCK
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_consignment_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES pharmacy_partners(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES pharmacy_branches(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  sold_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  returned_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  commission_pct NUMERIC(5,2) DEFAULT 0 NOT NULL,
  cost_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','settled','returned')),
  settlement_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 17. HR / EMPLOYEES
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  position TEXT NOT NULL,
  salary NUMERIC(14,2) DEFAULT 0 NOT NULL,
  salary_type TEXT DEFAULT 'monthly' CHECK(salary_type IN ('monthly','weekly','daily','hourly')),
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true NOT NULL,
  national_id TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  check_in TIMESTAMPTZ NOT NULL,
  check_out TIMESTAMPTZ,
  hours_worked NUMERIC(6,2),
  status TEXT DEFAULT 'present' NOT NULL CHECK(status IN ('present','late','absent','excused')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, employee_id, date_key)
);

CREATE TABLE IF NOT EXISTS pharmacy_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('annual','sick','emergency','unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_used INT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES pharmacy_employees(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, employee_id, day_of_week)
);

-- ========================
-- 18. SESSIONS / SECURITY
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(token)
);

CREATE TABLE IF NOT EXISTS pharmacy_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  permissions JSONB DEFAULT '[]'::jsonb NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name)
);

-- ========================
-- 19. NOTIFICATIONS & COMMUNICATION
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES pharmacy_notifications(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'sent' NOT NULL,
  provider TEXT DEFAULT 'twilio',
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 20. ACTIVITY / AUDIT
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_activity_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 21. REPORTS / EXPORTS
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule TEXT,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows_total INT DEFAULT 0 NOT NULL,
  rows_inserted INT DEFAULT 0 NOT NULL,
  rows_skipped INT DEFAULT 0 NOT NULL,
  errors TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_document_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft' NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================
-- 22. PAYMENT LINKS
-- ========================

CREATE TABLE IF NOT EXISTS pharmacy_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES pharmacy_sales(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','paid','expired','cancelled')),
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================================================================
-- DEVELOPER / SYSTEM TABLES
-- ===================================================================

CREATE TABLE IF NOT EXISTS developer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer' CHECK(role IN ('super_admin','developer','maintainer')),
  is_active BOOLEAN DEFAULT true NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  developer_id UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','error','critical')),
  source TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  conditions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_release_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  changelog TEXT,
  min_app_version TEXT,
  is_required BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT false NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID REFERENCES developer_release_versions(id) ON DELETE SET NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','deploying','success','failed','rolled_back')),
  log TEXT,
  deployed_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS developer_error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'error' CHECK(level IN ('error','fatal')),
  message TEXT NOT NULL,
  stack_trace TEXT,
  url TEXT,
  user_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INT,
  duration_ms INT,
  user_id UUID,
  request_body TEXT,
  response_body TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_sql_sync_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK(issue_type IN ('schema_mismatch','missing_column','type_conflict','constraint_violation')),
  payload JSONB DEFAULT '{}'::jsonb,
  resolved BOOLEAN DEFAULT false NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK(task_type IN ('cleanup','backup','migration','index','vacuum','sync','other')),
  schedule TEXT,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'idle' NOT NULL CHECK(status IN ('idle','running','success','failed','disabled')),
  log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_users(id) ON DELETE CASCADE,
  impersonated_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS developer_module_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  dependencies TEXT[] DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_permission_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  module TEXT NOT NULL,
  is_granted BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role, permission, module)
);

CREATE TABLE IF NOT EXISTS developer_table_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description TEXT,
  category TEXT,
  sync_enabled BOOLEAN DEFAULT true NOT NULL,
  audit_enabled BOOLEAN DEFAULT false NOT NULL,
  retention_days INT DEFAULT 365,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_build_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','passing','failing','skipped')),
  duration_ms INT,
  details TEXT,
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS developer_backup_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size_bytes BIGINT DEFAULT 0,
  tables_count INT DEFAULT 0,
  rows_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('in_progress','completed','failed','restored')),
  file_path TEXT,
  checksum TEXT,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('up','down')),
  checksum TEXT,
  duration_ms INT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  executed_by UUID REFERENCES developer_users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(14,2) NOT NULL,
  unit TEXT DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('healthy','warning','critical')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================================================================
-- INDEXES
-- ===================================================================
CREATE INDEX IF NOT EXISTS idx_pharmacy_pharmacy_id ON pharmacy_profiles(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_partner_pharmacy ON pharmacy_partners(pharmacy_id, type);
CREATE INDEX IF NOT EXISTS idx_item_pharmacy ON pharmacy_items(pharmacy_id, group_id);
CREATE INDEX IF NOT EXISTS idx_item_search ON pharmacy_items USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barcode_item ON pharmacy_item_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_batch_item ON pharmacy_item_batches(item_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_stock_balance ON pharmacy_stock_balances(pharmacy_id, item_id);
CREATE INDEX IF NOT EXISTS idx_sale_pharmacy ON pharmacy_sales(pharmacy_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sale_customer ON pharmacy_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_pharmacy ON pharmacy_purchases(pharmacy_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON pharmacy_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expense_date ON pharmacy_expenses(pharmacy_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_source ON pharmacy_payments(pharmacy_id, source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_activity_pharmacy ON pharmacy_activity_feed(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_user ON pharmacy_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_source ON pharmacy_journal_entries(pharmacy_id, source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_daily_summary ON pharmacy_daily_summary(pharmacy_id, branch_id, date_key);
CREATE INDEX IF NOT EXISTS idx_api_logs ON developer_api_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events ON developer_error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events ON developer_audit_events(created_at DESC);

-- ===================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================================================================
-- AUTO-REGISTER TABLES IN developer_table_registry
-- =================================================================--
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'pharmacies','pharmacy_branches','pharmacy_profiles',
    'pharmacy_partners','pharmacy_customer_addresses',
    'pharmacy_item_groups','pharmacy_item_brands','pharmacy_items',
    'pharmacy_item_barcodes','pharmacy_item_units','pharmacy_item_variants',
    'pharmacy_item_warranties','pharmacy_item_alternatives','pharmacy_item_batches',
    'pharmacy_stock_balances','pharmacy_stock_movements','pharmacy_stock_transfers',
    'pharmacy_damaged_stock','pharmacy_stock_counts','pharmacy_inventory_snapshots',
    'pharmacy_sales','pharmacy_sale_lines','pharmacy_sales_returns','pharmacy_sales_return_lines',
    'pharmacy_suspended_invoices','pharmacy_invoice_drafts',
    'pharmacy_purchases','pharmacy_purchase_lines','pharmacy_purchase_returns','pharmacy_purchase_return_lines','pharmacy_purchase_orders',
    'pharmacy_expense_categories','pharmacy_expenses',
    'pharmacy_payments','pharmacy_payment_allocations',
    'pharmacy_orders','pharmacy_order_lines',
    'pharmacy_coupons','pharmacy_bundles','pharmacy_bundle_items',
    'pharmacy_chart_of_accounts','pharmacy_journal_entries','pharmacy_journal_lines','pharmacy_account_balances',
    'pharmacy_tax_groups','pharmacy_daily_summary','pharmacy_financial_movements','pharmacy_barcode_label_sheets',
    'pharmacy_cash_registers','pharmacy_register_transactions','pharmacy_shifts',
    'pharmacy_loyalty_points','pharmacy_loyalty_transactions','pharmacy_loyalty_balances',
    'pharmacy_manufacturing_recipes','pharmacy_recipe_ingredients','pharmacy_manufacturing_batches',
    'pharmacy_controlled_drugs_log','pharmacy_consignment_stock',
    'pharmacy_employees','pharmacy_attendance','pharmacy_leave','pharmacy_employee_shifts',
    'pharmacy_user_sessions','pharmacy_api_tokens',
    'pharmacy_notifications','pharmacy_deleted_notifications','pharmacy_sms_log',
    'pharmacy_activity_feed',
    'pharmacy_saved_reports','pharmacy_import_logs','pharmacy_document_drafts',
    'pharmacy_payment_links'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    INSERT INTO developer_table_registry (table_name, display_name, category, sync_enabled)
    VALUES (tbl, tbl, 'pharmacy', true)
    ON CONFLICT (table_name) DO NOTHING;
  END LOOP;

  INSERT INTO developer_table_registry (table_name, display_name, category, sync_enabled)
  VALUES
    ('developer_users','Developer Users','developer',false),
    ('developer_access_logs','Access Logs','developer',false),
    ('developer_audit_events','Audit Events','developer',false),
    ('developer_feature_flags','Feature Flags','developer',false),
    ('developer_release_versions','Releases','developer',false),
    ('developer_deployments','Deployments','developer',false),
    ('developer_error_events','Errors','developer',false),
    ('developer_api_logs','API Logs','developer',false),
    ('developer_sql_sync_issues','Sync Issues','developer',false),
    ('developer_maintenance_tasks','Maintenance','developer',false),
    ('developer_impersonation_sessions','Impersonation','developer',false),
    ('developer_module_registry','Modules','developer',false),
    ('developer_permission_matrix','Permissions','developer',false),
    ('developer_table_registry','Table Registry','developer',false),
    ('developer_build_checks','Build Checks','developer',false),
    ('developer_backup_snapshots','Backups','developer',false),
    ('developer_migration_runs','Migration Runs','developer',false),
    ('developer_health_checks','Health Checks','developer',false)
  ON CONFLICT (table_name) DO NOTHING;
END;
$$;


-- ===== 20260617001000_auth_rbac_tenancy_hardening.sql =====
-- ===================================================================
-- AUTH / RBAC / TENANCY HARDENING
-- Developer > Owner > Pharmacy Employees
-- يمنع اختلاط بيانات الصيدليات ويثبت صلاحيات المستخدمين على مستوى الداتا بيز
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========================
-- 1. USER PROFILE DATA
-- ========================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  global_role TEXT NOT NULL DEFAULT 'no-access'
    CHECK(global_role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(lower(email));

-- ========================
-- 2. NORMALIZE PHARMACY MEMBERSHIPS
-- ========================
ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_branch_id ON public.pharmacy_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_role ON public.pharmacy_profiles(role);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_active ON public.pharmacy_profiles(pharmacy_id, user_id, is_active);

-- ========================
-- 3. DEVELOPER SEED BY OWNER EMAIL
-- ========================
INSERT INTO public.developer_users (user_id, role, is_active, permissions)
SELECT u.id, 'super_admin', true, ARRAY['system:all']::TEXT[]
FROM auth.users u
WHERE lower(u.email) = lower('mostafa0falcon@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  permissions = ARRAY['system:all']::TEXT[],
  updated_at = now();

-- ========================
-- 4. AUTH HELPER FUNCTIONS
-- ========================
CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    EXISTS(
      SELECT 1
      FROM public.developer_users du
      WHERE du.user_id = p_user_id
        AND du.is_active = true
    )
    OR EXISTS(
      SELECT 1
      FROM auth.users u
      WHERE u.id = p_user_id
        AND lower(u.email) = lower('mostafa0falcon@gmail.com')
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pharmacy_owner(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    EXISTS(
      SELECT 1
      FROM public.pharmacies p
      WHERE p.id = p_pharmacy_id
        AND p.owner_id = p_user_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_pharmacy_role(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN 'developer';
  END IF;

  IF public.is_pharmacy_owner(p_pharmacy_id, p_user_id) THEN
    RETURN 'owner';
  END IF;

  SELECT pp.role
    INTO v_role
  FROM public.pharmacy_profiles pp
  WHERE pp.pharmacy_id = p_pharmacy_id
    AND pp.user_id = p_user_id
    AND pp.is_active = true
  LIMIT 1;

  RETURN COALESCE(v_role, 'no-access');
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pharmacy_access(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND pp.role <> 'no-access'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_pharmacy_id UUID, p_branch_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_branch_id IS NULL
    OR public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND pp.role <> 'no-access'
        AND (pp.branch_id IS NULL OR pp.branch_id = p_branch_id)
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.user_pharmacy_role(p_pharmacy_id, p_user_id) IN ('developer','owner','admin');
$$;

-- ========================
-- 5. AUTH USER TRIGGER
-- ========================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'no-access');
  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    v_role := 'developer';
  END IF;

  INSERT INTO public.user_profiles (user_id, email, username, full_name, phone, avatar_url, global_role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'display_name'),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'mobile'),
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
    updated_at = now();

  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ========================
-- 6. RLS: USER PROFILES
-- ========================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON public.user_profiles;

CREATE POLICY user_profiles_select ON public.user_profiles
FOR SELECT USING (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_insert ON public.user_profiles
FOR INSERT WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_update ON public.user_profiles
FOR UPDATE USING (public.is_developer() OR user_id = auth.uid())
WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_delete ON public.user_profiles
FOR DELETE USING (public.is_developer());

-- ========================
-- 7. RLS: CORE TENANCY TABLES
-- ========================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacies_select ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_insert ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_update ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_delete ON public.pharmacies;

CREATE POLICY pharmacies_select ON public.pharmacies
FOR SELECT USING (public.has_pharmacy_access(id) OR owner_id = auth.uid());

CREATE POLICY pharmacies_insert ON public.pharmacies
FOR INSERT WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_update ON public.pharmacies
FOR UPDATE USING (public.is_developer() OR owner_id = auth.uid())
WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_delete ON public.pharmacies
FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS pharmacy_branches_select ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_insert ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_update ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_delete ON public.pharmacy_branches;

CREATE POLICY pharmacy_branches_select ON public.pharmacy_branches
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner'));

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_select ON public.pharmacy_profiles
FOR SELECT USING (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_insert ON public.pharmacy_profiles
FOR INSERT WITH CHECK (public.can_manage_pharmacy_users(pharmacy_id));

CREATE POLICY pharmacy_profiles_update ON public.pharmacy_profiles
FOR UPDATE USING (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid())
WITH CHECK (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_delete ON public.pharmacy_profiles
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner'));

-- ========================
-- 8. RLS: ALL PHARMACY TABLES WITH pharmacy_id
-- ========================
DO $$
DECLARE
  tbl TEXT;
  has_branch BOOLEAN;
  branch_guard TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'pharmacy_id'
      AND c.table_name NOT IN ('pharmacies', 'pharmacy_branches', 'pharmacy_profiles')
      AND c.table_name NOT LIKE 'developer_%'
      AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_name
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns bc
      WHERE bc.table_schema = 'public'
        AND bc.table_name = tbl
        AND bc.column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)' ELSE '' END;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT USING (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id)%s) WITH CHECK (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin''))',
      tbl
    );
  END LOOP;
END;
$$;

-- ========================
-- 9. RLS: DEVELOPER TABLES
-- ========================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'developer_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS developer_only_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY developer_only_all ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', tbl);
  END LOOP;
END;
$$;

-- ========================
-- 10. AUDIT HELPERS / UPDATED_AT TRIGGERS
-- ========================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER touch_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacy_profiles_updated_at ON public.pharmacy_profiles;
CREATE TRIGGER touch_pharmacy_profiles_updated_at
BEFORE UPDATE ON public.pharmacy_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ========================
-- 11. BACKFILL PROFILES FROM AUTH USERS / OWNERS
-- ========================
INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name'),
  COALESCE(u.raw_user_meta_data->>'phone', u.raw_user_meta_data->>'mobile'),
  CASE WHEN lower(u.email) = lower('mostafa0falcon@gmail.com') THEN 'developer' ELSE COALESCE(u.raw_user_meta_data->>'role', 'no-access') END,
  true
FROM auth.users u
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
  phone = COALESCE(public.user_profiles.phone, EXCLUDED.phone),
  global_role = CASE WHEN public.user_profiles.global_role = 'no-access' THEN EXCLUDED.global_role ELSE public.user_profiles.global_role END,
  updated_at = now();

INSERT INTO public.pharmacy_profiles (pharmacy_id, user_id, role, is_active, permissions, email, full_name)
SELECT
  p.id,
  p.owner_id,
  'owner',
  true,
  '[]'::jsonb,
  u.email,
  COALESCE(up.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name')
FROM public.pharmacies p
JOIN auth.users u ON u.id = p.owner_id
LEFT JOIN public.user_profiles up ON up.user_id = u.id
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = 'owner',
  is_active = true,
  email = EXCLUDED.email,
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  updated_at = now();

INSERT INTO public.developer_table_registry (table_name, display_name, category, sync_enabled, audit_enabled)
VALUES
  ('user_profiles', 'User Profiles', 'auth', true, true),
  ('pharmacy_profiles', 'Pharmacy User Memberships', 'auth', true, true),
  ('pharmacies', 'Pharmacies', 'tenant', true, true),
  ('pharmacy_branches', 'Pharmacy Branches', 'tenant', true, true)
ON CONFLICT (table_name) DO UPDATE SET
  category = EXCLUDED.category,
  sync_enabled = EXCLUDED.sync_enabled,
  audit_enabled = EXCLUDED.audit_enabled,
  updated_at = now();


-- ===== 20260617002000_notifications_system.sql =====
-- ===================================================================
-- NOTIFICATIONS SYSTEM - In-App Notifications + Deleted Audit
-- ===================================================================

-- ========================
-- IN-APP NOTIFICATIONS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_inapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info' CHECK(notif_type IN ('warning','success','info','error')),
  href TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_user_created
  ON pharmacy_inapp_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_active
  ON pharmacy_inapp_notifications(user_id, read, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE pharmacy_inapp_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_owner_select ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_select
  ON pharmacy_inapp_notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS notif_owner_insert ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_insert
  ON pharmacy_inapp_notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS notif_owner_update ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_update
  ON pharmacy_inapp_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- ========================
-- DELETED NOTIFICATIONS AUDIT
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_inapp_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  was_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inapp_deleted_notif_user
  ON pharmacy_inapp_deleted_notifications(user_id, deleted_at DESC);

ALTER TABLE pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
  ON pharmacy_inapp_deleted_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- ========================
-- TRIGGER: auto-archive on soft-delete
-- ========================
CREATE OR REPLACE FUNCTION fn_archive_deleted_notification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO pharmacy_inapp_deleted_notifications (
      user_id, original_id, title, description, notif_type, href, was_read, created_at, deleted_by
    ) VALUES (
      NEW.user_id, NEW.id, NEW.title, NEW.description, NEW.notif_type,
      NEW.href, NEW.read, NEW.created_at, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_archive_deleted_notification ON pharmacy_inapp_notifications;

CREATE TRIGGER trg_archive_deleted_notification
  BEFORE UPDATE OF deleted_at ON pharmacy_inapp_notifications
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION fn_archive_deleted_notification();


-- ===== 20260617003000_items_soft_delete_filters.sql =====
-- ===================================================================
-- ITEMS LIST UX SUPPORT
-- Soft delete metadata + fast filters for companies, units, expiry, stock alerts
-- ===================================================================

ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8,3) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_scope_status
  ON public.pharmacy_items(pharmacy_id, branch_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_manufacturer
  ON public.pharmacy_items(pharmacy_id, lower(manufacturer_name));

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_expiry
  ON public.pharmacy_items(pharmacy_id, expiry_date)
  WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_deleted
  ON public.pharmacy_items(pharmacy_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL OR status = 'deleted';

CREATE INDEX IF NOT EXISTS idx_pharmacy_item_units_filter
  ON public.pharmacy_item_units(pharmacy_id, item_id, unit_name);

CREATE TABLE IF NOT EXISTS public.pharmacy_deleted_items_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deleted_items_audit_scope
  ON public.pharmacy_deleted_items_audit(pharmacy_id, deleted_at DESC);

ALTER TABLE public.pharmacy_deleted_items_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deleted_items_audit_select ON public.pharmacy_deleted_items_audit;
CREATE POLICY deleted_items_audit_select
  ON public.pharmacy_deleted_items_audit FOR SELECT
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
  );


-- ===== 20260617004000_real_settings_integration.sql =====
-- Real application settings store
-- Keeps every option saved per pharmacy and makes it readable by the running system.

CREATE TABLE IF NOT EXISTS public.pharmacy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, key)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_lookup
  ON public.pharmacy_settings(pharmacy_id, key);

CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_updated
  ON public.pharmacy_settings(pharmacy_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.touch_pharmacy_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharmacy_settings_updated_at ON public.pharmacy_settings;
CREATE TRIGGER trg_pharmacy_settings_updated_at
  BEFORE UPDATE ON public.pharmacy_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pharmacy_settings_updated_at();

ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_settings;

CREATE POLICY pharmacy_settings_select
ON public.pharmacy_settings
FOR SELECT
USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY pharmacy_settings_insert
ON public.pharmacy_settings
FOR INSERT
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY pharmacy_settings_update
ON public.pharmacy_settings
FOR UPDATE
USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY pharmacy_settings_delete
ON public.pharmacy_settings
FOR DELETE
USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===== 20260617005000_system_settings_developer_only.sql =====
-- Developer-only protection for core system/application settings.
-- Owners can still read them, but only the developer can change app identity/version/system runtime switches.

CREATE OR REPLACE FUNCTION public.is_core_system_setting_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_key LIKE 'system.%'
    OR p_key IN (
      'appName',
      'appVersion',
      'companyName',
      'supportPhone',
      'supportEmail',
      'enableAutoBackup',
      'backupFrequency',
      'backupRetentionDays',
      'backupLocation',
      'enableAuditLog',
      'auditLogRetentionDays',
      'enableMultiBranch',
      'enableMultiCurrency',
      'defaultBranchId',
      'enableDarkMode',
      'enableNotifications',
      'sessionTimeout',
      'maxLoginAttempts',
      'enableTwoFactor',
      'maintenanceMode'
    ),
    false
  );
$$;

DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;

CREATE POLICY pharmacy_settings_insert
ON public.pharmacy_settings
FOR INSERT
WITH CHECK (
  public.is_developer(auth.uid())
  OR (
    NOT public.is_core_system_setting_key(key)
    AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
  )
);

CREATE POLICY pharmacy_settings_update
ON public.pharmacy_settings
FOR UPDATE
USING (
  public.is_developer(auth.uid())
  OR (
    NOT public.is_core_system_setting_key(key)
    AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
  )
)
WITH CHECK (
  public.is_developer(auth.uid())
  OR (
    NOT public.is_core_system_setting_key(key)
    AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
  )
);

CREATE POLICY pharmacy_settings_delete
ON public.pharmacy_settings
FOR DELETE
USING (
  public.is_developer(auth.uid())
  OR (
    NOT public.is_core_system_setting_key(key)
    AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
  )
);


-- ===== 20260617006000_global_system_settings.sql =====
-- Global system settings are not tenant/pharmacy settings.
-- Developer can edit them without selecting an active pharmacy; all authenticated app users can read them.

ALTER TABLE public.pharmacy_settings
  ALTER COLUMN pharmacy_id DROP NOT NULL;

-- Remove possible duplicate global rows before creating the unique global index.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_settings_global_key
  ON public.pharmacy_settings(key)
  WHERE pharmacy_id IS NULL;

-- Promote the latest previously tenant-scoped system values to global defaults when no global value exists yet.
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

DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;

CREATE POLICY pharmacy_settings_select
ON public.pharmacy_settings
FOR SELECT
USING (
  pharmacy_id IS NULL
  OR public.has_pharmacy_access(pharmacy_id, auth.uid())
);

CREATE POLICY pharmacy_settings_insert
ON public.pharmacy_settings
FOR INSERT
WITH CHECK (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
);

CREATE POLICY pharmacy_settings_update
ON public.pharmacy_settings
FOR UPDATE
USING (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
)
WITH CHECK (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
      )
    )
  )
);

CREATE POLICY pharmacy_settings_delete
ON public.pharmacy_settings
FOR DELETE
USING (
  (
    pharmacy_id IS NULL
    AND public.is_developer(auth.uid())
  )
  OR (
    pharmacy_id IS NOT NULL
    AND (
      public.is_developer(auth.uid())
      OR (
        NOT public.is_core_system_setting_key(key)
        AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
      )
    )
  )
);


-- ===== 20260617007000_settings_permissions_final.sql =====
-- Final settings permissions model
-- 1) system.* settings are global and developer-only for writes.
-- 2) pharmacy-scoped settings are editable by developer / owner / admin / manager.
-- 3) all authenticated users with pharmacy access can read their pharmacy settings; global settings are readable by authenticated app users.

ALTER TABLE public.pharmacy_settings
  ALTER COLUMN pharmacy_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.is_core_system_setting_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_key LIKE 'system.%'
    OR p_key IN (
      'appName',
      'appVersion',
      'companyName',
      'supportPhone',
      'supportEmail',
      'enableAutoBackup',
      'backupFrequency',
      'backupRetentionDays',
      'backupLocation',
      'enableAuditLog',
      'auditLogRetentionDays',
      'enableMultiBranch',
      'enableMultiCurrency',
      'defaultBranchId',
      'enableDarkMode',
      'enableNotifications',
      'sessionTimeout',
      'maxLoginAttempts',
      'enableTwoFactor',
      'maintenanceMode'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_setting_row(p_pharmacy_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      p_pharmacy_id IS NULL
      OR public.has_pharmacy_access(p_pharmacy_id, auth.uid())
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_setting_row(p_pharmacy_id UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      (
        p_pharmacy_id IS NULL
        AND public.is_core_system_setting_key(p_key)
        AND public.is_developer(auth.uid())
      )
      OR (
        p_pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(p_key)
            AND public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    ),
    false
  );
$$;

-- Keep a single global value for each key.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_settings_global_key
  ON public.pharmacy_settings(key)
  WHERE pharmacy_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_key
  ON public.pharmacy_settings(key);

ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_settings;

CREATE POLICY pharmacy_settings_select
ON public.pharmacy_settings
FOR SELECT
USING (public.can_read_setting_row(pharmacy_id));

CREATE POLICY pharmacy_settings_insert
ON public.pharmacy_settings
FOR INSERT
WITH CHECK (public.can_write_setting_row(pharmacy_id, key));

CREATE POLICY pharmacy_settings_update
ON public.pharmacy_settings
FOR UPDATE
USING (public.can_write_setting_row(pharmacy_id, key))
WITH CHECK (public.can_write_setting_row(pharmacy_id, key));

CREATE POLICY pharmacy_settings_delete
ON public.pharmacy_settings
FOR DELETE
USING (public.can_write_setting_row(pharmacy_id, key));


-- ===== 20260617008000_settings_modules_complete.sql =====
-- Complete real settings modules used by the settings UI.
-- These tables are tenant-scoped, protected with RLS, and no longer depend on local-only SQLite tables.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pharmacy_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  rate_type TEXT NOT NULL DEFAULT 'percent',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_tax_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.pharmacy_tax_groups(id) ON DELETE CASCADE,
  tax_rate_id UUID NOT NULL REFERENCES public.pharmacy_tax_rates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, tax_rate_id)
);

ALTER TABLE public.pharmacy_tax_groups
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.pharmacy_invoice_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'standard',
  primary_color TEXT DEFAULT '#1e40af',
  secondary_color TEXT DEFAULT '#f8fafc',
  accent_color TEXT DEFAULT '#3b82f6',
  is_default BOOLEAN NOT NULL DEFAULT false,
  show_logo BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  show_header BOOLEAN NOT NULL DEFAULT true,
  header_text TEXT DEFAULT '',
  header_subtitle_1 TEXT DEFAULT '',
  header_subtitle_2 TEXT DEFAULT '',
  header_subtitle_3 TEXT DEFAULT '',
  show_footer BOOLEAN NOT NULL DEFAULT true,
  footer_text TEXT DEFAULT 'شكراً لتعاملكم معنا',
  show_tax BOOLEAN NOT NULL DEFAULT true,
  show_discount BOOLEAN NOT NULL DEFAULT true,
  show_barcode BOOLEAN NOT NULL DEFAULT true,
  show_qr BOOLEAN NOT NULL DEFAULT true,
  qr_enabled BOOLEAN NOT NULL DEFAULT true,
  qr_show_business_name BOOLEAN NOT NULL DEFAULT true,
  qr_show_invoice_no BOOLEAN NOT NULL DEFAULT true,
  qr_show_date BOOLEAN NOT NULL DEFAULT true,
  qr_show_total BOOLEAN NOT NULL DEFAULT true,
  qr_show_tax BOOLEAN NOT NULL DEFAULT true,
  show_customer_info BOOLEAN NOT NULL DEFAULT true,
  show_customer_id BOOLEAN NOT NULL DEFAULT false,
  show_customer_tax BOOLEAN NOT NULL DEFAULT true,
  show_phone BOOLEAN NOT NULL DEFAULT true,
  show_address BOOLEAN NOT NULL DEFAULT true,
  show_shipping BOOLEAN NOT NULL DEFAULT false,
  show_item_image BOOLEAN NOT NULL DEFAULT false,
  show_item_code BOOLEAN NOT NULL DEFAULT true,
  show_item_brand BOOLEAN NOT NULL DEFAULT false,
  show_item_unit BOOLEAN NOT NULL DEFAULT true,
  show_total_qty BOOLEAN NOT NULL DEFAULT true,
  show_payment_info BOOLEAN NOT NULL DEFAULT true,
  show_total_in_words BOOLEAN NOT NULL DEFAULT true,
  show_signature BOOLEAN NOT NULL DEFAULT false,
  show_currency BOOLEAN NOT NULL DEFAULT true,
  paper_size TEXT NOT NULL DEFAULT 'A4',
  font_family TEXT NOT NULL DEFAULT 'Cairo',
  font_size INTEGER NOT NULL DEFAULT 12,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_barcode_paper_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_width NUMERIC(10,2) DEFAULT 297,
  page_height NUMERIC(10,2) DEFAULT 210,
  left_margin NUMERIC(10,2) DEFAULT 10,
  right_margin NUMERIC(10,2) DEFAULT 10,
  top_margin NUMERIC(10,2) DEFAULT 10,
  bottom_margin NUMERIC(10,2) DEFAULT 10,
  label_width NUMERIC(10,2) DEFAULT 70,
  label_height NUMERIC(10,2) DEFAULT 40,
  columns INTEGER DEFAULT 3,
  rows INTEGER DEFAULT 4,
  gap_horizontal NUMERIC(10,2) DEFAULT 2,
  gap_vertical NUMERIC(10,2) DEFAULT 2,
  font_size INTEGER DEFAULT 8,
  barcode_symbology TEXT DEFAULT 'Code-128',
  show_price BOOLEAN NOT NULL DEFAULT true,
  show_name BOOLEAN NOT NULL DEFAULT true,
  show_barcode BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_receipt_printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  printer_type TEXT NOT NULL DEFAULT 'thermal',
  interface_type TEXT NOT NULL DEFAULT 'usb',
  ip_address TEXT DEFAULT '',
  port INTEGER DEFAULT 9100,
  paper_width INTEGER DEFAULT 80,
  characters_per_line INTEGER DEFAULT 42,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'in_app',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  auto_send BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, scenario, channel)
);

CREATE TABLE IF NOT EXISTS public.pharmacy_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_size BIGINT,
  type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'created',
  storage_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  restored_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_tax_rates_scope ON public.pharmacy_tax_rates(pharmacy_id, status, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_tax_group_members_group ON public.pharmacy_tax_group_members(pharmacy_id, group_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_invoice_designs_scope ON public.pharmacy_invoice_designs(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_barcode_paper_scope ON public.pharmacy_barcode_paper_settings(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_receipt_printers_scope ON public.pharmacy_receipt_printers(pharmacy_id, is_default DESC, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_notification_templates_scope ON public.pharmacy_notification_templates(pharmacy_id, scenario, channel);
CREATE INDEX IF NOT EXISTS idx_pharmacy_backups_scope ON public.pharmacy_backups(pharmacy_id, created_at DESC) WHERE deleted_at IS NULL;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_tax_rates',
    'pharmacy_tax_group_members',
    'pharmacy_tax_groups',
    'pharmacy_invoice_designs',
    'pharmacy_barcode_paper_settings',
    'pharmacy_receipt_printers',
    'pharmacy_notification_templates',
    'pharmacy_backups'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', tbl, tbl);
    IF tbl <> 'pharmacy_tax_group_members' THEN
      EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', tbl, tbl);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format('CREATE POLICY tenant_select ON public.%I FOR SELECT USING (public.has_pharmacy_access(pharmacy_id))', tbl);
    EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin'',''manager''))', tbl);
    EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin'',''manager'')) WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin'',''manager''))', tbl);
    EXECUTE format('CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin''))', tbl);
  END LOOP;
END $$;


-- ===== 20260617009000_auth_permissions_page_gates_final.sql =====
-- Final permissions hardening for page/section/action gates.
-- This migration keeps RLS aligned with the frontend permission model:
-- page access, section access, action buttons, and sensitive field access.

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

CREATE OR REPLACE FUNCTION public.permission_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN p_permission NOT LIKE 'developer:%' AND p_permission <> 'system:all' AND p_permission <> 'settings:system.write';
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','roles:manage','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','notifications:templates.write','sync:read','deleted-records:read','deleted-records:restore'
    ) OR (p_permission LIKE 'settings:%' AND p_permission NOT IN ('settings:system.write','settings:system.read','settings:backup.write'));
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','sync:read'
    ) OR p_permission IN (
      'settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN ('sales:read','purchases:read','inventory:read','items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','financials:read','financials:write','reports:read','reports:export','crm:read','settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read');
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN ('sales:read','sales:write','purchases:read','inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print','items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read');
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id), false);
$$;

DROP POLICY IF EXISTS pharmacy_branches_select ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_insert ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_update ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_delete ON public.pharmacy_branches;

CREATE POLICY pharmacy_branches_select ON public.pharmacy_branches
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'branches:read'));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'branches:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'branches:delete'));

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_select ON public.pharmacy_profiles
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'users:read') OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_insert ON public.pharmacy_profiles
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'users:write'));

CREATE POLICY pharmacy_profiles_update ON public.pharmacy_profiles
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'users:write') OR user_id = auth.uid())
WITH CHECK (public.user_has_permission(pharmacy_id, 'users:write') OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_delete ON public.pharmacy_profiles
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'users:delete'));


-- ===== 20260617010000_users_management_final.sql =====
-- ===================================================================
-- USERS / ROLES / PERMISSIONS FINALIZATION
-- إغلاق نظام المستخدمين: إضافة/تعديل/إيقاف/صلاحيات/فرع
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_role ON public.pharmacy_profiles(pharmacy_id, role, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_branch ON public.pharmacy_profiles(pharmacy_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);

-- Ensure every pharmacy owner has an explicit membership row so the users module
-- can display/protect the owner consistently.
INSERT INTO public.pharmacy_profiles (
  pharmacy_id,
  user_id,
  role,
  is_active,
  email,
  full_name,
  phone,
  title,
  permissions,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.owner_id,
  'owner',
  true,
  up.email,
  COALESCE(up.full_name, split_part(up.email, '@', 1)),
  up.phone,
  'صاحب الصيدلية',
  '[]'::jsonb,
  now(),
  now()
FROM public.pharmacies p
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = CASE WHEN public.pharmacy_profiles.role IN ('developer','owner') THEN public.pharmacy_profiles.role ELSE 'owner' END,
  is_active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.user_pharmacy_role(p_pharmacy_id, p_user_id) = 'owner'
    OR public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.user_pharmacy_role(p_pharmacy_id, p_user_id) = 'owner'
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_read_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete_final ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_read_final ON public.pharmacy_profiles
FOR SELECT USING (
  public.is_developer()
  OR user_id = auth.uid()
  OR public.user_has_permission(pharmacy_id, 'users:read')
);

CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('developer', 'owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);


-- ===== 20260617011000_finalize_users_permissions_settings_audit.sql =====
-- ===================================================================
-- FINALIZE USERS / PERMISSIONS / SETTINGS / AUDIT
-- ===================================================================

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS denied_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'linked',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_denied_permissions
  ON public.pharmacy_profiles USING GIN (denied_permissions);

CREATE TABLE IF NOT EXISTS public.pharmacy_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  source TEXT NOT NULL DEFAULT 'system',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_scope
  ON public.pharmacy_audit_events(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_actor
  ON public.pharmacy_audit_events(actor_id, created_at DESC);

ALTER TABLE public.pharmacy_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_audit_events_select ON public.pharmacy_audit_events;
DROP POLICY IF EXISTS pharmacy_audit_events_insert ON public.pharmacy_audit_events;

CREATE POLICY pharmacy_audit_events_select ON public.pharmacy_audit_events
FOR SELECT USING (
  public.is_developer()
  OR public.user_pharmacy_role(pharmacy_id) = 'owner'
  OR public.user_has_permission(pharmacy_id, 'auth:audit.read')
);

CREATE POLICY pharmacy_audit_events_insert ON public.pharmacy_audit_events
FOR INSERT WITH CHECK (
  public.is_developer()
  OR public.has_pharmacy_access(pharmacy_id)
);

CREATE OR REPLACE FUNCTION public.permission_denied_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.denied_permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN p_permission NOT LIKE 'developer:%' AND p_permission <> 'system:all' AND p_permission <> 'settings:system.write';
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','roles:manage','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','notifications:templates.write','sync:read','deleted-records:read','deleted-records:restore'
    ) OR (p_permission LIKE 'settings:%' AND p_permission NOT IN ('settings:system.write','settings:system.read','settings:backup.write'));
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','sync:read'
    ) OR p_permission IN (
      'settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN ('sales:read','purchases:read','inventory:read','items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','financials:read','financials:write','reports:read','reports:export','crm:read','settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read');
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN ('sales:read','sales:write','purchases:read','inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print','items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read');
  END IF;

  RETURN false;
END;
$$;


-- ===== 20260617012000_owner_employee_developer_table_fix.sql =====
-- ===================================================================
-- OWNER / EMPLOYEE / DEVELOPER SEPARATION FIX
-- يثبت أن المطور ليس مستخدم صيدلية، وصاحب الصيدلية ينشأ له كيان صيدلية وفرع رئيسي تلقائيًا
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) المطورين في جدول developer_users فقط، وليس كعضوية داخل pharmacy_profiles.
DELETE FROM public.pharmacy_profiles pp
USING public.developer_users du
WHERE pp.user_id = du.user_id
  AND pp.role = 'developer';

UPDATE public.pharmacy_profiles
SET role = 'no-access', updated_at = now()
WHERE role = 'developer';

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

-- 2) تأكيد وجود فرع رئيسي لكل صيدلية قديمة.
INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, is_default, status)
SELECT p.id, 'MAIN', 'الفرع الرئيسي', true, 'active'
FROM public.pharmacies p
WHERE NOT EXISTS (
  SELECT 1 FROM public.pharmacy_branches b WHERE b.pharmacy_id = p.id
)
ON CONFLICT (pharmacy_id, code) DO NOTHING;

-- 3) تأكيد وجود عضوية owner لصاحب كل صيدلية.
INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, role, is_active, permissions, denied_permissions)
SELECT
  p.id,
  COALESCE(b_default.id, b_any.id),
  p.owner_id,
  up.email,
  up.full_name,
  'owner',
  true,
  '[]'::jsonb,
  '[]'::jsonb
FROM public.pharmacies p
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT id FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id AND b.is_default = true
  ORDER BY b.created_at ASC LIMIT 1
) b_default ON true
LEFT JOIN LATERAL (
  SELECT id FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id
  ORDER BY b.created_at ASC LIMIT 1
) b_any ON true
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = 'owner',
  is_active = true,
  branch_id = COALESCE(EXCLUDED.branch_id, public.pharmacy_profiles.branch_id),
  email = COALESCE(public.pharmacy_profiles.email, EXCLUDED.email),
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  updated_at = now();

-- 4) فصل صلاحيات النظام العامة عن صلاحيات الصيدلية.
CREATE OR REPLACE FUNCTION public.permission_is_system_only(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_permission = 'system:all'
    OR p_permission LIKE 'developer:%'
    OR p_permission IN ('roles:manage','auth:sessions.manage','settings:system.read','settings:system.write','notifications:system.read'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  IF public.permission_is_system_only(p_permission) THEN
    RETURN false;
  END IF;

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','notifications:templates.write','sync:read','deleted-records:read','deleted-records:restore'
    ) OR (p_permission LIKE 'settings:%' AND NOT public.permission_is_system_only(p_permission) AND p_permission <> 'settings:backup.write');
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','sync:read',
      'settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','purchases:read','inventory:read','items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','financials:read','financials:write','reports:read','reports:export','crm:read','settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read');
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','purchases:read','inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print','items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read');
  END IF;

  RETURN false;
END;
$$;

-- 5) صاحب الصيدلية يستطيع إدارة مستخدمي وفروع صيدليته، والمطور يستطيع كل شيء دون عضوية صيدلية.
CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

-- 6) Trigger آمن: أي owner جديد يتعمل له صيدلية + فرع رئيسي + عضوية owner تلقائيًا.
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
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'no-access');
  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    v_role := 'developer';
  END IF;

  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'display_name', ''));
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.raw_user_meta_data->>'mobile', ''));
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
    updated_at = now();

  IF v_role = 'developer' THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();

    RETURN NEW;
  END IF;

  IF v_role = 'owner' THEN
    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (NEW.id, v_project_name, v_project_name, v_currency, v_country, v_timezone, v_phone, NEW.email, v_city, 'active', 'trial')
    ON CONFLICT (owner_id) DO UPDATE SET
      updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', v_city, v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET
      is_default = true,
      status = 'active',
      updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, role, is_active, permissions, denied_permissions)
    VALUES (v_pharmacy_id, v_branch_id, NEW.id, NEW.email, v_full_name, v_phone, 'owner', true, '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
      branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
      email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
      full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
      phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
      role = 'owner',
      is_active = true,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 7) سياسات نهائية لعضويات الصيدلية: owner يتضاف فقط من سيرفر/تريجر، والمستخدمون لا يضيفون owner أو developer.
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_profiles_read_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete_final ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_read_final ON public.pharmacy_profiles
FOR SELECT USING (
  public.is_developer()
  OR user_id = auth.uid()
  OR public.user_has_permission(pharmacy_id, 'users:read')
);

CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('developer', 'owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);


-- ===== 20260618001000_atomic_cashier_sales.sql =====
-- Atomic, idempotent cashier sale creation.
-- The function validates tenant/branch access and derives prices from the database.

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_client_request
  ON public.pharmacy_sales(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_cashier_sale(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_available NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'Not allowed to create sales';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_branches
    WHERE id = p_branch_id
      AND pharmacy_id = p_pharmacy_id
      AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'Invalid branch';
  END IF;

  IF p_client_request_id IS NULL OR length(trim(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'client_request_id is required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line_row))
        FROM public.pharmacy_sale_lines line_row
        WHERE line_row.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one sale line is required';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status NOT IN ('deleted', 'inactive')
      AND NOT not_for_sale
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid item in sale';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid sale quantity for item %', v_item.name_ar;
    END IF;

    IF v_item.manage_inventory THEN
      SELECT quantity
      INTO v_available
      FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
      FOR UPDATE;

      v_available := COALESCE(v_available, 0);
      IF v_available < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_item.name_ar;
      END IF;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));
  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id,
    branch_id,
    invoice_number,
    client_request_id,
    customer_name,
    status,
    payment_status,
    payment_method,
    subtotal,
    discount_total,
    tax_total,
    total,
    paid_amount,
    due_amount,
    shipping_fee,
    rounding_adj,
    notes,
    created_by
  )
  VALUES (
    p_pharmacy_id,
    p_branch_id,
    v_invoice_number,
    p_client_request_id,
    COALESCE(NULLIF(trim(p_customer_name), ''), 'زبون نقدي'),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    COALESCE(NULLIF(trim(p_payment_method), ''), 'cash'),
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_total - v_paid, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(trim(p_notes), ''),
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_line_total := GREATEST(v_quantity * v_unit_price - v_line_discount, 0);

    INSERT INTO public.pharmacy_sale_lines (
      pharmacy_id,
      sale_id,
      item_id,
      item_name,
      barcode,
      unit,
      quantity,
      unit_price,
      purchase_price,
      discount,
      net_total
    )
    VALUES (
      p_pharmacy_id,
      v_sale.id,
      v_item.id,
      v_item.name_ar,
      NULLIF(trim(v_line->>'barcode'), ''),
      COALESCE(NULLIF(trim(v_line->>'unit'), ''), v_item.unit, 'unit'),
      v_quantity,
      v_unit_price,
      v_item.buy_price,
      v_line_discount,
      round(v_line_total, 2)
    );

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id,
      branch_id,
      item_id,
      direction,
      quantity,
      unit_price,
      total_value,
      movement_type,
      source_table,
      source_id,
      created_by
    )
    VALUES (
      p_pharmacy_id,
      p_branch_id,
      v_item.id,
      'out',
      v_quantity,
      v_unit_price,
      round(v_line_total, 2),
      'sale',
      'pharmacy_sales',
      v_sale.id,
      v_actor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(line_row))
      FROM public.pharmacy_sale_lines line_row
      WHERE line_row.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) TO authenticated, service_role;


-- ===== 20260618002000_operation_level_rls.sql =====
-- Replace broad tenant write policies on core operational tables with
-- permission-aware policies. Reads remain tenant/branch scoped.

DO $$
DECLARE
  tbl TEXT;
  has_branch BOOLEAN;
  branch_guard TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_sales',
    'pharmacy_sale_lines',
    'pharmacy_sales_returns',
    'pharmacy_sales_return_lines',
    'pharmacy_suspended_invoices',
    'pharmacy_invoice_drafts'
  ]
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE
      WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)'
      ELSE ''
    END;

    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, ''sales:write'')%s)',
      tbl,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.user_has_permission(pharmacy_id, ''sales:write'')%s) WITH CHECK (public.user_has_permission(pharmacy_id, ''sales:write'')%s)',
      tbl,
      branch_guard,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''sales:void''))',
      tbl
    );
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_items',
    'pharmacy_item_barcodes',
    'pharmacy_item_units',
    'pharmacy_item_variants',
    'pharmacy_item_warranties',
    'pharmacy_item_alternatives',
    'pharmacy_item_batches',
    'pharmacy_stock_balances',
    'pharmacy_stock_movements',
    'pharmacy_stock_transfers',
    'pharmacy_damaged_stock',
    'pharmacy_stock_counts',
    'pharmacy_inventory_snapshots'
  ]
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE
      WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)'
      ELSE ''
    END;

    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:create''))%s)',
      tbl,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:update''))%s) WITH CHECK ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:update''))%s)',
      tbl,
      branch_guard,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''inventory:delete''))',
      tbl
    );
  END LOOP;
END;
$$;


-- ===== 20260618003000_owner_workspace_bootstrap.sql =====
-- ===================================================================
-- OWNER WORKSPACE BOOTSTRAP
-- صاحب الحساب ينشئ صيدليته ويصبح مالكها تلقائيا، بينما المطور يظل عالميا.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.ensure_owner_workspace(
  p_user_id UUID DEFAULT auth.uid(),
  p_project_name TEXT DEFAULT NULL,
  p_owner_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'EG',
  p_city TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP',
  p_timezone TEXT DEFAULT 'Africa/Cairo'
)
RETURNS TABLE(pharmacy_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_claim_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), 'صيدلية جديدة');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  IF v_claim_role <> 'service_role'
    AND (
      v_actor_id IS NULL
      OR (
        v_actor_id <> p_user_id
        AND NOT public.is_developer(v_actor_id)
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن تجهيز صيدلية لمستخدم آخر';
  END IF;

  IF public.is_developer(p_user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يتبع صيدلية';
  END IF;

  INSERT INTO public.pharmacies (
    owner_id,
    name,
    legal_name,
    status,
    plan,
    currency,
    country,
    timezone,
    phone,
    email,
    address
  )
  VALUES (
    p_user_id,
    v_project_name,
    v_project_name,
    'active',
    'trial',
    COALESCE(NULLIF(BTRIM(p_currency), ''), 'EGP'),
    COALESCE(NULLIF(BTRIM(p_country), ''), 'EG'),
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Africa/Cairo'),
    NULLIF(BTRIM(p_phone), ''),
    NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (
    pharmacy_id,
    code,
    name,
    address,
    phone,
    is_default,
    status
  )
  VALUES (
    v_pharmacy_id,
    'MAIN',
    'الفرع الرئيسي',
    NULLIF(BTRIM(p_city), ''),
    NULLIF(BTRIM(p_phone), ''),
    true,
    'active'
  )
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (
    user_id,
    email,
    full_name,
    phone,
    global_role,
    is_active,
    updated_at
  )
  VALUES (
    p_user_id,
    COALESCE(NULLIF(BTRIM(p_email), ''), p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(NULLIF(BTRIM(p_email), ''), public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = 'owner',
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id,
    branch_id,
    user_id,
    email,
    full_name,
    phone,
    title,
    role,
    is_active,
    permissions,
    denied_permissions,
    invite_status,
    updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'صاحب الصيدلية',
    'owner',
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    'created',
    now()
  )
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

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;


-- ===== 20260618004000_final_tables_auth_owner_developer_clean.sql =====
-- ===================================================================
-- PHARMACY SYSTEM - FINAL TABLES / AUTH / OWNER / DEVELOPER CLEAN FIX
-- يرفع بعد المايجريشن القديمة مباشرة لإصلاح الجداول والصلاحيات نهائياً
-- الهدف:
-- 1) المطور في developer_users فقط وليس مستخدم صيدلية.
-- 2) صاحب الصيدلية يتعمل له صيدلية + فرع رئيسي + عضوية owner تلقائياً.
-- 3) صاحب الصيدلية يدير فروعه وموظفيه وصلاحياتهم فقط.
-- 4) جدول كل الصلاحيات/صلاحيات النظام للمطور فقط.
-- 5) إصلاح تعارض جدول deleted notifications القديم مع in-app notifications.
-- ===================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===================================================================
-- 1) CORE AUTH TABLES SAFETY
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  global_role TEXT NOT NULL DEFAULT 'no-access',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_global_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_global_role_check
  CHECK (global_role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE TABLE IF NOT EXISTS public.developer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.developer_users DROP CONSTRAINT IF EXISTS developer_users_role_check;
ALTER TABLE public.developer_users
  ADD CONSTRAINT developer_users_role_check
  CHECK (role IN ('super_admin','developer','maintainer'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_developer_users_user_id ON public.developer_users(user_id);

-- seed main developer account by email when it exists in auth.users
INSERT INTO public.developer_users (user_id, role, is_active, permissions)
SELECT u.id, 'super_admin', true, ARRAY['system:all']::TEXT[]
FROM auth.users u
WHERE lower(u.email) = lower('mostafa0falcon@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  permissions = ARRAY['system:all']::TEXT[],
  updated_at = now();

-- ===================================================================
-- 2) PHARMACY MEMBERSHIP TABLE NORMALIZATION
-- ===================================================================

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS denied_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'linked',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

UPDATE public.pharmacy_profiles
SET
  permissions = COALESCE(permissions, '[]'::jsonb),
  denied_permissions = COALESCE(denied_permissions, '[]'::jsonb),
  invite_status = CASE
    WHEN invite_status IN ('created','invited','linked','pending','accepted','disabled') THEN invite_status
    ELSE 'linked'
  END,
  updated_at = now()
WHERE permissions IS NULL
   OR denied_permissions IS NULL
   OR invite_status IS NULL
   OR invite_status = ''
   OR invite_status NOT IN ('created','invited','linked','pending','accepted','disabled');

ALTER TABLE public.pharmacy_profiles
  ALTER COLUMN permissions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN permissions SET NOT NULL,
  ALTER COLUMN denied_permissions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN denied_permissions SET NOT NULL,
  ALTER COLUMN invite_status SET DEFAULT 'linked',
  ALTER COLUMN invite_status SET NOT NULL;

-- المطور لا يدخل pharmacy_profiles نهائياً.
DELETE FROM public.pharmacy_profiles pp
USING public.developer_users du
WHERE pp.user_id = du.user_id;

-- أي role قديم باسم developer يتقفل بدل ما يكسر constraint.
UPDATE public.pharmacy_profiles
SET role = 'no-access', updated_at = now()
WHERE role = 'developer';

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK (role IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_invite_status_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_invite_status_check
  CHECK (invite_status IN ('created','invited','linked','pending','accepted','disabled'));

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_profiles_pharmacy_id_user_id_key
  ON public.pharmacy_profiles(pharmacy_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_role ON public.pharmacy_profiles(pharmacy_id, role, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_branch ON public.pharmacy_profiles(pharmacy_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_permissions ON public.pharmacy_profiles USING GIN (permissions);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_denied_permissions ON public.pharmacy_profiles USING GIN (denied_permissions);

-- ===================================================================
-- 3) AUTH / TENANCY HELPER FUNCTIONS
-- ===================================================================

CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      EXISTS(
        SELECT 1
        FROM public.developer_users du
        WHERE du.user_id = p_user_id
          AND du.is_active = true
      )
      OR EXISTS(
        SELECT 1
        FROM auth.users u
        WHERE u.id = p_user_id
          AND lower(u.email) = lower('mostafa0falcon@gmail.com')
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pharmacy_owner(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacies p
      WHERE p.id = p_pharmacy_id
        AND p.owner_id = p_user_id
        AND p.status <> 'closed'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_pharmacy_role(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN 'developer';
  END IF;

  IF public.is_pharmacy_owner(p_pharmacy_id, p_user_id) THEN
    RETURN 'owner';
  END IF;

  SELECT pp.role
    INTO v_role
  FROM public.pharmacy_profiles pp
  WHERE pp.pharmacy_id = p_pharmacy_id
    AND pp.user_id = p_user_id
    AND pp.is_active = true
  ORDER BY pp.created_at ASC
  LIMIT 1;

  RETURN COALESCE(v_role, 'no-access');
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pharmacy_access(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_pharmacy_id UUID, p_branch_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      p_branch_id IS NULL
      OR public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
          AND (pp.branch_id IS NULL OR pp.branch_id = p_branch_id)
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_denied_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.denied_permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_is_system_only(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_permission = 'system:all'
    OR p_permission LIKE 'developer:%'
    OR p_permission IN (
      'roles:manage',
      'auth:sessions.manage',
      'settings:system.read',
      'settings:system.write',
      'notifications:system.read'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL OR p_permission = '' THEN
    RETURN false;
  END IF;

  -- المطور يرى ويدير كل شيء من جدول developer_users فقط.
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  -- صلاحيات النظام ليست قابلة للإسناد لأصحاب الصيدليات أو الموظفين.
  IF public.permission_is_system_only(p_permission) THEN
    RETURN false;
  END IF;

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','pharmacy:delete',
      'branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:project.write','settings:branches.read','settings:branches.write','settings:tax.read','settings:tax.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:payments.write','settings:contacts.read','settings:contacts.write','settings:invoice.read','settings:invoice.write','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:notification-templates.write','settings:email.read','settings:email.write','settings:sms.read','settings:sms.write','settings:backup.read','settings:shortcuts.read','settings:shortcuts.write','settings:rewards.read','settings:rewards.write','settings:extra-units.read','settings:extra-units.write','settings:custom-labels.read','settings:custom-labels.write',
      'notifications:read','notifications:manage','notifications:templates.write',
      'prescriptions:read','delivery:read','loyalty:read','sync:read','deleted-records:read','deleted-records:restore'
    );
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read',
      'notifications:read','notifications:manage','sync:read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','purchases:read','inventory:read',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read',
      'financials:read','financials:write','reports:read','reports:export','crm:read',
      'settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read'
    );
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','purchases:read',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print',
      'items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read'
    );
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read'
    );
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read'
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

-- ===================================================================
-- 4) OWNER WORKSPACE CREATION
-- ===================================================================

CREATE OR REPLACE FUNCTION public.ensure_owner_workspace(
  p_user_id UUID DEFAULT auth.uid(),
  p_project_name TEXT DEFAULT NULL,
  p_owner_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'EG',
  p_city TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP',
  p_timezone TEXT DEFAULT 'Africa/Cairo'
)
RETURNS TABLE(pharmacy_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_claim_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), NULLIF(BTRIM(p_owner_name), ''), 'صيدلية جديدة');
  v_email TEXT := NULLIF(BTRIM(p_email), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  IF v_claim_role <> 'service_role'
    AND (
      v_actor_id IS NULL
      OR (
        v_actor_id <> p_user_id
        AND NOT public.is_developer(v_actor_id)
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن تجهيز صيدلية لمستخدم آخر';
  END IF;

  IF public.is_developer(p_user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يتبع صيدلية';
  END IF;

  INSERT INTO public.pharmacies (
    owner_id, name, legal_name, status, plan, currency, country, timezone, phone, email, address
  )
  VALUES (
    p_user_id,
    v_project_name,
    v_project_name,
    'active',
    'trial',
    COALESCE(NULLIF(BTRIM(p_currency), ''), 'EGP'),
    COALESCE(NULLIF(BTRIM(p_country), ''), 'EG'),
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Africa/Cairo'),
    NULLIF(BTRIM(p_phone), ''),
    v_email,
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
  VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(BTRIM(p_city), ''), NULLIF(BTRIM(p_phone), ''), true, 'active')
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active, updated_at)
  VALUES (
    p_user_id,
    COALESCE(v_email, p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(v_email, public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = CASE WHEN public.user_profiles.global_role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status, updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    v_email,
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'صاحب الصيدلية',
    'owner',
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    'created',
    now()
  )
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

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

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
  -- Never trust public signup metadata for developer access.
  -- Safe pharmacy roles may still be supplied by trusted admin invitations.
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

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ===================================================================
-- 5) BACKFILL OLD DATA
-- ===================================================================

-- default branch for old pharmacies
INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, is_default, status)
SELECT p.id, 'MAIN', 'الفرع الرئيسي', true, 'active'
FROM public.pharmacies p
WHERE NOT EXISTS (SELECT 1 FROM public.pharmacy_branches b WHERE b.pharmacy_id = p.id)
ON CONFLICT (pharmacy_id, code) DO UPDATE SET
  is_default = true,
  status = 'active',
  updated_at = now();

-- keep only one default branch per pharmacy before creating the partial unique index
WITH ranked_branches AS (
  SELECT id, row_number() OVER (PARTITION BY pharmacy_id ORDER BY is_default DESC, created_at ASC, id ASC) AS rn
  FROM public.pharmacy_branches
)
UPDATE public.pharmacy_branches b
SET is_default = (r.rn = 1), updated_at = now()
FROM ranked_branches r
WHERE b.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_branches_one_default
  ON public.pharmacy_branches(pharmacy_id)
  WHERE is_default = true;

-- owner membership for every pharmacy
INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
SELECT
  p.id,
  b.id,
  p.owner_id,
  COALESCE(up.email, u.email),
  COALESCE(up.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  COALESCE(up.phone, u.raw_user_meta_data->>'phone', u.raw_user_meta_data->>'mobile'),
  'صاحب الصيدلية',
  'owner',
  true,
  '[]'::jsonb,
  '[]'::jsonb,
  'created'
FROM public.pharmacies p
JOIN auth.users u ON u.id = p.owner_id
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT id
  FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id
  ORDER BY b.is_default DESC, b.created_at ASC
  LIMIT 1
) b ON true
WHERE NOT public.is_developer(p.owner_id)
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
  email = COALESCE(public.pharmacy_profiles.email, EXCLUDED.email),
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  phone = COALESCE(public.pharmacy_profiles.phone, EXCLUDED.phone),
  title = 'صاحب الصيدلية',
  role = 'owner',
  is_active = true,
  disabled_reason = NULL,
  updated_at = now();

-- old owner signups that were stuck with no pharmacy
DO $$
DECLARE
  r RECORD;
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_full_name TEXT;
  v_phone TEXT;
  v_project_name TEXT;
BEGIN
  FOR r IN
    SELECT u.*,
           up.global_role,
           up.full_name AS profile_full_name,
           up.phone AS profile_phone
    FROM auth.users u
    LEFT JOIN public.user_profiles up ON up.user_id = u.id
    WHERE NOT public.is_developer(u.id)
      AND NOT EXISTS (SELECT 1 FROM public.pharmacies p WHERE p.owner_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.pharmacy_profiles pp WHERE pp.user_id = u.id AND pp.role <> 'no-access')
      AND (
        COALESCE(u.raw_user_meta_data->>'role', '') = 'owner'
        OR NULLIF(u.raw_user_meta_data->>'project_name', '') IS NOT NULL
        OR NULLIF(u.raw_user_meta_data->>'pharmacy_name', '') IS NOT NULL
        OR up.global_role = 'owner'
      )
  LOOP
    v_full_name := COALESCE(NULLIF(r.profile_full_name, ''), NULLIF(r.raw_user_meta_data->>'full_name', ''), NULLIF(r.raw_user_meta_data->>'display_name', ''), split_part(r.email, '@', 1));
    v_phone := COALESCE(NULLIF(r.profile_phone, ''), NULLIF(r.raw_user_meta_data->>'phone', ''), NULLIF(r.raw_user_meta_data->>'mobile', ''));
    v_project_name := COALESCE(NULLIF(r.raw_user_meta_data->>'project_name', ''), NULLIF(r.raw_user_meta_data->>'pharmacy_name', ''), v_full_name, r.email, 'صيدلية جديدة');

    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (
      r.id,
      v_project_name,
      v_project_name,
      COALESCE(NULLIF(r.raw_user_meta_data->>'currency', ''), 'EGP'),
      COALESCE(NULLIF(r.raw_user_meta_data->>'country', ''), 'EG'),
      COALESCE(NULLIF(r.raw_user_meta_data->>'timezone', ''), 'Africa/Cairo'),
      v_phone,
      r.email,
      NULLIF(r.raw_user_meta_data->>'city', ''),
      'active',
      'trial'
    )
    ON CONFLICT (owner_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(r.raw_user_meta_data->>'city', ''), v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET is_default = true, status = 'active', updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active)
    VALUES (r.id, r.email, v_full_name, v_phone, 'owner', true)
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
      phone = COALESCE(public.user_profiles.phone, EXCLUDED.phone),
      global_role = 'owner',
      is_active = true,
      updated_at = now();

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
    VALUES (v_pharmacy_id, v_branch_id, r.id, r.email, v_full_name, v_phone, 'صاحب الصيدلية', 'owner', true, '[]'::jsonb, '[]'::jsonb, 'created')
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET role = 'owner', is_active = true, disabled_reason = NULL, updated_at = now();
  END LOOP;
END;
$$;

-- final safety: no developer rows in pharmacy_profiles
DELETE FROM public.pharmacy_profiles pp
WHERE public.is_developer(pp.user_id);

-- ===================================================================
-- 6) RLS POLICIES - FINAL MODEL
-- ===================================================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON public.user_profiles;

CREATE POLICY user_profiles_select ON public.user_profiles
FOR SELECT USING (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_insert ON public.user_profiles
FOR INSERT WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_update ON public.user_profiles
FOR UPDATE USING (public.is_developer() OR user_id = auth.uid())
WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_delete ON public.user_profiles
FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS pharmacies_select ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_insert ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_update ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_delete ON public.pharmacies;

CREATE POLICY pharmacies_select ON public.pharmacies
FOR SELECT USING (public.has_pharmacy_access(id) OR owner_id = auth.uid());

CREATE POLICY pharmacies_insert ON public.pharmacies
FOR INSERT WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_update ON public.pharmacies
FOR UPDATE USING (public.is_developer() OR owner_id = auth.uid())
WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_delete ON public.pharmacies
FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS pharmacy_branches_select ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_insert ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_update ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_delete ON public.pharmacy_branches;

CREATE POLICY pharmacy_branches_select ON public.pharmacy_branches
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'branches:read'));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'branches:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'branches:delete'));

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_read_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete_final ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_read_final ON public.pharmacy_profiles
FOR SELECT USING (
  public.is_developer()
  OR user_id = auth.uid()
  OR public.user_has_permission(pharmacy_id, 'users:read')
);

-- owner/admin/manager can add employees only. owner rows are created by trusted server/trigger, not by normal UI insert.
CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);

-- developer_* tables are developer-only.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'developer_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS developer_only_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY developer_only_all ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', tbl);
  END LOOP;
END;
$$;

-- ===================================================================
-- 7) SETTINGS SAFETY - SYSTEM SETTINGS ARE GLOBAL/DEVELOPER ONLY
-- ===================================================================

CREATE OR REPLACE FUNCTION public.is_core_system_setting_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_key LIKE 'system.%'
    OR p_key IN (
      'appName','appVersion','companyName','supportPhone','supportEmail',
      'enableAutoBackup','backupFrequency','backupRetentionDays','backupLocation',
      'enableAuditLog','auditLogRetentionDays','enableMultiBranch','enableMultiCurrency','defaultBranchId',
      'enableDarkMode','enableNotifications','sessionTimeout','maxLoginAttempts','enableTwoFactor','maintenanceMode'
    ),
    false
  );
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pharmacy_settings'
  ) THEN
    ALTER TABLE public.pharmacy_settings ALTER COLUMN pharmacy_id DROP NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_settings_global_key
      ON public.pharmacy_settings(key)
      WHERE pharmacy_id IS NULL;

    ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_select ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_update ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_settings;

    CREATE POLICY pharmacy_settings_select
    ON public.pharmacy_settings
    FOR SELECT
    USING (
      auth.uid() IS NOT NULL
      AND (
        pharmacy_id IS NULL
        OR public.has_pharmacy_access(pharmacy_id, auth.uid())
      )
    );

    CREATE POLICY pharmacy_settings_insert
    ON public.pharmacy_settings
    FOR INSERT
    WITH CHECK (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    );

    CREATE POLICY pharmacy_settings_update
    ON public.pharmacy_settings
    FOR UPDATE
    USING (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    )
    WITH CHECK (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    );

    CREATE POLICY pharmacy_settings_delete
    ON public.pharmacy_settings
    FOR DELETE
    USING (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
          )
        )
      )
    );
  END IF;
END;
$$;

-- ===================================================================
-- 8) FIX IN-APP DELETED NOTIFICATIONS TABLE CONFLICT
-- ===================================================================
-- The old schema already has pharmacy_deleted_notifications for pharmacy_notifications.
-- The in-app notifications audit must use a separate table to avoid missing columns/runtime errors.

CREATE TABLE IF NOT EXISTS public.pharmacy_inapp_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  was_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inapp_deleted_notif_user
  ON public.pharmacy_inapp_deleted_notifications(user_id, deleted_at DESC);

ALTER TABLE public.pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON public.pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
ON public.pharmacy_inapp_deleted_notifications FOR SELECT
USING (auth.uid() = user_id OR public.is_developer(auth.uid()));

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

-- ===================================================================
-- 9) CASHIER TABLE INTEGRITY
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_open_user
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id, status, opened_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_shift_id
  ON public.pharmacy_sales(shift_id)
  WHERE shift_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pharmacy_sales_shift_id_fkey'
      AND conrelid = 'public.pharmacy_sales'::regclass
  ) THEN
    ALTER TABLE public.pharmacy_sales
      ADD CONSTRAINT pharmacy_sales_shift_id_fkey
      FOREIGN KEY (shift_id)
      REFERENCES public.pharmacy_shifts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

-- ===================================================================
-- 10) UPDATED_AT TRIGGERS
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

COMMIT;


-- ===== 20260618005000_cashier_atomic_fefo_security.sql =====
-- Atomic cashier sale v2:
-- - validates the open shift
-- - applies permissions server-side
-- - deducts stock safely under row locks
-- - consumes the nearest valid expiry batches first (FEFO)
-- - updates the cashier shift in the same transaction

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_client_request
  ON public.pharmacy_sales(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_cashier_sale_v2(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,
  p_patient_name TEXT DEFAULT NULL,
  p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_coupon public.pharmacy_coupons%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_remaining_quantity NUMERIC;
  v_alloc_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_remaining_discount NUMERIC;
  v_alloc_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_coupon_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
  v_has_batches BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تنفيذ البيع';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية البيع غير صالح';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
        FROM public.pharmacy_sale_lines sale_line
        WHERE sale_line.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_shift
  FROM public.pharmacy_shifts
  WHERE id = p_shift_id
    AND pharmacy_id = p_pharmacy_id
    AND branch_id = p_branch_id
    AND user_id = v_actor_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'جلسة الكاشير غير مفتوحة أو انتهت';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND COALESCE(not_for_sale, false) = false
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير صالح للبيع';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية البيع غير صحيحة للصنف %', v_item.name_ar;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));

  -- Coupon validation
  IF p_coupon_code IS NOT NULL AND length(BTRIM(p_coupon_code)) > 0 THEN
    SELECT * INTO v_coupon
    FROM public.pharmacy_coupons
    WHERE pharmacy_id = p_pharmacy_id
      AND code = UPPER(BTRIM(p_coupon_code))
      AND is_active = true
      AND (max_uses = 0 OR used_count < max_uses)
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      IF v_subtotal - v_line_discounts < v_coupon.min_purchase THEN
        RAISE EXCEPTION 'الطلب لا يستوفي الحد الأدنى للشراء للكوبون (%)', v_coupon.code;
      END IF;

      v_coupon_discount := CASE
        WHEN v_coupon.discount_type = 'percentage'
          THEN round((v_subtotal - v_line_discounts) * v_coupon.discount_value / 100, 2)
        ELSE v_coupon.discount_value
      END;
      v_coupon_discount := LEAST(v_coupon_discount, GREATEST(v_subtotal - v_line_discounts - v_invoice_discount, 0));
    ELSE
      RAISE EXCEPTION 'الكوبون غير صالح أو منتهي الصلاحية';
    END IF;
  END IF;

  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount - v_coupon_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_due := GREATEST(v_total - v_paid, 0);
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id, branch_id, shift_id, invoice_number, client_request_id,
    customer_name, patient_name, doctor_name, prescription_number,
    status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, rounding_adj, notes, coupon_id, coupon_discount, coupon_code, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, p_shift_id, v_invoice_number, p_client_request_id,
    COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'),
    NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''), NULLIF(BTRIM(p_prescription_number), ''),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method,
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount + v_coupon_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_due, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(BTRIM(p_notes), ''),
    CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.id ELSE NULL END,
    round(v_coupon_discount, 2),
    CASE WHEN v_coupon.id IS NOT NULL THEN UPPER(BTRIM(p_coupon_code)) ELSE NULL END,
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
        AND quantity >= v_quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'الكمية غير كافية للصنف: %', v_item.name_ar;
      END IF;
    END IF;

    v_remaining_quantity := v_quantity;
    v_remaining_discount := v_line_discount;
    SELECT EXISTS (
      SELECT 1
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
    ) INTO v_has_batches;

    FOR v_batch IN
      SELECT batch_row.*
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
        AND (batch_row.expiry_date IS NULL OR batch_row.expiry_date >= CURRENT_DATE)
      ORDER BY batch_row.expiry_date ASC NULLS LAST, batch_row.created_at ASC, batch_row.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_quantity <= 0;
      v_alloc_quantity := LEAST(v_remaining_quantity, v_batch.remaining_quantity);
      v_alloc_discount := CASE
        WHEN v_alloc_quantity = v_remaining_quantity THEN v_remaining_discount
        ELSE LEAST(v_remaining_discount, round(v_line_discount * (v_alloc_quantity / v_quantity), 2))
      END;
      v_line_total := GREATEST(v_alloc_quantity * v_unit_price - v_alloc_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, batch_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_batch.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_alloc_quantity, v_unit_price, v_item.buy_price, v_alloc_discount, round(v_line_total, 2)
      );

      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_alloc_quantity,
          updated_at = now()
      WHERE id = v_batch.id;

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'out', v_alloc_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );

      v_remaining_quantity := v_remaining_quantity - v_alloc_quantity;
      v_remaining_discount := GREATEST(v_remaining_discount - v_alloc_discount, 0);
    END LOOP;

    IF v_remaining_quantity > 0 AND v_has_batches AND (v_item.track_batch OR v_item.has_expiry) THEN
      RAISE EXCEPTION 'لا توجد تشغيلة صالحة بكمية كافية للصنف: %', v_item.name_ar;
    END IF;

    IF v_remaining_quantity > 0 THEN
      v_line_total := GREATEST(v_remaining_quantity * v_unit_price - v_remaining_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_remaining_quantity, v_unit_price, v_item.buy_price, v_remaining_discount, round(v_line_total, 2)
      );

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, 'out', v_remaining_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );
    END IF;

    -- Auto-log controlled drug dispense
    IF v_item.is_controlled THEN
      INSERT INTO public.pharmacy_controlled_drugs_log (
        pharmacy_id, item_id, branch_id, action, quantity,
        patient_name, doctor_name, prescription_number, notes,
        created_by, created_at
      ) VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, 'dispensed',
        (v_line->>'quantity')::NUMERIC,
        NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''),
        NULLIF(BTRIM(p_prescription_number), ''),
        'صرف: ' || v_sale.invoice_number,
        v_actor_id, now()
      );
    END IF;
  END LOOP;

  -- Auto-create/link prescription
  IF NULLIF(BTRIM(p_prescription_number), '') IS NOT NULL OR NULLIF(BTRIM(p_patient_name), '') IS NOT NULL THEN
    DECLARE
      v_prescription_id UUID;
    BEGIN
      SELECT id INTO v_prescription_id
      FROM public.pharmacy_prescriptions
      WHERE pharmacy_id = p_pharmacy_id
        AND patient_name = COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'))
        AND status = 'open'
        AND sale_id IS NULL
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.pharmacy_prescriptions (
          pharmacy_id, branch_id, sale_id,
          patient_name, doctor_name, diagnosis,
          status, notes, created_by,
          dispensed_by, dispensed_at
        ) VALUES (
          p_pharmacy_id, p_branch_id, v_sale.id,
          COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي')),
          NULLIF(BTRIM(p_doctor_name), ''),
          NULLIF(BTRIM(p_prescription_number), ''),
          'dispensed', v_sale.invoice_number,
          v_actor_id, v_actor_id, now()
        );
      ELSE
        UPDATE public.pharmacy_prescriptions
        SET status = 'dispensed',
            sale_id = v_sale.id,
            doctor_name = COALESCE(NULLIF(BTRIM(p_doctor_name), ''), doctor_name),
            dispensed_by = v_actor_id,
            dispensed_at = now(),
            updated_at = now()
        WHERE id = v_prescription_id;
      END IF;
    END;
  END IF;

  v_cash_paid := CASE WHEN v_method = 'cash' THEN v_paid ELSE 0 END;
  v_card_paid := CASE WHEN v_method IN ('card', 'wallet', 'mixed') THEN v_paid ELSE 0 END;

  UPDATE public.pharmacy_shifts
  SET cash_sales = COALESCE(cash_sales, 0) + v_cash_paid,
      card_sales = COALESCE(card_sales, 0) + v_card_paid,
      credit_sales = COALESCE(credit_sales, 0) + v_due,
      total_collected = COALESCE(total_collected, 0) + v_paid,
      expected_balance = COALESCE(opening_balance, 0) + COALESCE(cash_sales, 0) + v_cash_paid - COALESCE(total_expenses, 0),
      updated_at = now()
  WHERE id = p_shift_id;

  IF v_coupon.id IS NOT NULL THEN
    UPDATE public.pharmacy_coupons
    SET used_count = used_count + 1,
        updated_at = now()
    WHERE id = v_coupon.id;
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
      FROM public.pharmacy_sale_lines sale_line
      WHERE sale_line.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_cashier_sale(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المبيعات';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'sale', to_jsonb(v_sale));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.pharmacy_sale_lines
    WHERE sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.unit_price, v_line.net_total,
      'sale_void', 'pharmacy_sales', v_sale.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة بيع'),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  v_cash_paid := CASE WHEN v_sale.payment_method = 'cash' THEN v_sale.paid_amount ELSE 0 END;
  v_card_paid := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_sale.paid_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_paid, 0),
        credit_sales = GREATEST(COALESCE(credit_sales, 0) - COALESCE(v_sale.due_amount, 0), 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - COALESCE(v_sale.paid_amount, 0), 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'sale', to_jsonb(v_sale));
END;
$$;

REVOKE ALL ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===== 20260618006000_atomic_sales_returns.sql =====
-- Atomic invoice-linked sales returns.
-- Returns are tied to the original sale line and batch so quantities cannot be
-- returned twice and batch stock is restored accurately.

ALTER TABLE public.pharmacy_sales_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_sales_return_lines
  ADD COLUMN IF NOT EXISTS sale_line_id UUID REFERENCES public.pharmacy_sale_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_client_request
  ON public.pharmacy_sales_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_sale_line
  ON public.pharmacy_sales_return_lines(pharmacy_id, sale_line_id);

CREATE OR REPLACE FUNCTION public.create_sales_return(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_reason TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_return public.pharmacy_sales_returns%ROWTYPE;
  v_sale_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_due_reduction NUMERIC := 0;
  v_refund_amount NUMERIC := 0;
  v_cash_refund NUMERIC := 0;
  v_card_refund NUMERIC := 0;
  v_return_number TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مبيعات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  SELECT *
    INTO v_return
  FROM public.pharmacy_sales_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_sales_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  -- Validate all requested quantities under row locks and calculate the net
  -- value from the original discounted sale line.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_sales_return_lines return_line
    JOIN public.pharmacy_sales_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.sale_line_id = v_sale_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_sale_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_sale_line.item_name;
    END IF;

    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  -- The return settles outstanding credit first. Only the remaining value is
  -- refunded, preventing cash refunds against unpaid invoice value.
  v_due_reduction := LEAST(GREATEST(COALESCE(v_sale.due_amount, 0), 0), v_total);
  v_refund_amount := LEAST(
    GREATEST(v_total - v_due_reduction, 0),
    GREATEST(COALESCE(v_sale.paid_amount, 0), 0)
  );
  v_return_number := 'SRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales_returns (
    pharmacy_id, branch_id, sale_id, return_number, client_request_id,
    customer_name, total, refund_amount, stock_mode, reason,
    return_date, created_by
  )
  VALUES (
    p_pharmacy_id, v_sale.branch_id, v_sale.id, v_return_number, p_client_request_id,
    v_sale.customer_name, v_total, v_refund_amount, 'restore_original_batch',
    NULLIF(BTRIM(p_reason), ''), now(), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);

    INSERT INTO public.pharmacy_sales_return_lines (
      pharmacy_id, return_id, sale_line_id, item_id, batch_id,
      quantity, unit_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_sale_line.id, v_sale_line.item_id, v_sale_line.batch_id,
      v_quantity, round(v_line_total / v_quantity, 2), v_line_total
    );

    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_sale_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_sale_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_quantity,
          updated_at = now()
      WHERE id = v_sale_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_sale_line.batch_id,
      'in', v_quantity, round(v_line_total / v_quantity, 2), v_line_total,
      'sales_return', 'pharmacy_sales_returns', v_return.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0),
      due_amount = GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0),
      payment_status = CASE
        WHEN GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0) <= 0 THEN 'paid'
        WHEN GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0) > 0 THEN 'partial'
        ELSE 'unpaid'
      END,
      updated_at = now()
  WHERE id = v_sale.id;

  IF v_refund_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, 'sales_return', 'customer_refund',
      v_refund_amount, 'out', 'pharmacy_sales_returns', v_return.id,
      'رد قيمة مرتجع الفاتورة ' || v_sale.invoice_number, now(), v_actor_id
    );
  END IF;

  v_cash_refund := CASE WHEN v_sale.payment_method = 'cash' THEN v_refund_amount ELSE 0 END;
  v_card_refund := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_refund_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL AND v_refund_amount > 0 THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_refund, 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - v_refund_amount, 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_sales_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'due_reduction', v_due_reduction,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB)
  TO authenticated, service_role;


-- ===== 20260618007000_atomic_received_purchases.sql =====
-- Atomic received purchase invoices:
-- invoice + lines + batches + stock + supplier balance + financial movement.

ALTER TABLE public.pharmacy_purchases
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_purchase_lines
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS batch_number TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_client_request
  ON public.pharmacy_purchases(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase
  ON public.pharmacy_purchase_lines(pharmacy_id, purchase_id, created_at);

CREATE OR REPLACE FUNCTION public.create_received_purchase(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_supplier_id UUID,
  p_supplier_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_header_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_notes TEXT,
  p_purchase_date TIMESTAMPTZ,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_supplier public.pharmacy_partners%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_buy_price NUMERIC;
  v_sell_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_header_discount NUMERIC;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_purchase_number TEXT;
  v_batch_number TEXT;
  v_expiry_date DATE;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل المشتريات';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches
    WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'الفرع غير صالح أو مغلق';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية الشراء غير صالح';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'purchase', to_jsonb(v_purchase),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
        FROM public.pharmacy_purchase_lines purchase_line
        WHERE purchase_line.purchase_id = v_purchase.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier
    FROM public.pharmacy_partners
    WHERE id = p_supplier_id
      AND pharmacy_id = p_pharmacy_id
      AND type IN ('supplier', 'both')
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير صالح'; END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'يوجد صنف غير صالح في فاتورة الشراء'; END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_line_discount := GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0);
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'كمية الشراء غير صحيحة للصنف %', v_item.name_ar; END IF;
    IF v_buy_price < 0 THEN RAISE EXCEPTION 'سعر الشراء غير صحيح للصنف %', v_item.name_ar; END IF;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_buy_price);
    v_subtotal := v_subtotal + (v_quantity * v_buy_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  v_header_discount := LEAST(
    GREATEST(COALESCE(p_header_discount, 0), 0),
    GREATEST(v_subtotal - v_line_discounts, 0)
  );
  v_total := round(GREATEST(v_subtotal - v_line_discounts - v_header_discount + v_tax_total + v_shipping_fee, 0), 2);
  v_paid := round(LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0)), 2);
  v_due := round(GREATEST(v_total - v_paid, 0), 2);
  v_purchase_number := 'PUR-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchases (
    pharmacy_id, branch_id, purchase_number, client_request_id,
    supplier_id, supplier_name, status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, notes, purchase_date, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, v_purchase_number, p_client_request_id,
    p_supplier_id,
    COALESCE(NULLIF(BTRIM(p_supplier_name), ''), v_supplier.name, 'مورد نقدي'),
    'received',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method, round(v_subtotal, 2), round(v_line_discounts + v_header_discount, 2),
    round(v_tax_total, 2), v_total, v_paid, v_due, round(v_shipping_fee, 2),
    NULLIF(BTRIM(p_notes), ''), COALESCE(p_purchase_date, now()), v_actor_id
  )
  RETURNING * INTO v_purchase;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_sell_price := GREATEST(COALESCE((v_line->>'sell_price')::NUMERIC, v_item.sell_price), 0);
    v_line_discount := LEAST(
      GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0),
      v_quantity * v_buy_price
    );
    v_line_total := round(GREATEST(v_quantity * v_buy_price - v_line_discount, 0), 2);
    v_batch_number := NULLIF(BTRIM(v_line->>'batch_number'), '');
    v_expiry_date := NULLIF(v_line->>'expiry_date', '')::DATE;

    IF (v_item.track_batch OR v_item.has_expiry) AND v_batch_number IS NULL THEN
      v_batch_number := 'PUR-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 8));
    END IF;
    IF v_item.has_expiry AND v_expiry_date IS NULL THEN
      RAISE EXCEPTION 'تاريخ الصلاحية مطلوب للصنف %', v_item.name_ar;
    END IF;

    IF v_batch_number IS NOT NULL OR v_expiry_date IS NOT NULL OR v_item.track_batch OR v_item.has_expiry THEN
      INSERT INTO public.pharmacy_item_batches (
        pharmacy_id, item_id, branch_id, batch_number, expiry_date,
        quantity, remaining_quantity, unit, cost_price, source_type, source_id
      )
      VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, v_batch_number, v_expiry_date,
        v_quantity, v_quantity, COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
        v_buy_price, 'purchase', v_purchase.id::TEXT
      )
      RETURNING * INTO v_batch;
    ELSE
      v_batch.id := NULL;
    END IF;

    INSERT INTO public.pharmacy_purchase_lines (
      pharmacy_id, purchase_id, item_id, batch_id, item_name, unit,
      batch_number, expiry_date, quantity, buy_price, sell_price, discount, net_total
    )
    VALUES (
      p_pharmacy_id, v_purchase.id, v_item.id, v_batch.id, v_item.name_ar,
      COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
      v_batch_number, v_expiry_date, v_quantity, v_buy_price, v_sell_price,
      v_line_discount, v_line_total
    );

    IF v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (p_pharmacy_id, p_branch_id, v_item.id, v_quantity, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    UPDATE public.pharmacy_items
    SET buy_price = v_buy_price,
        sell_price = CASE WHEN v_sell_price > 0 THEN v_sell_price ELSE sell_price END,
        updated_at = now()
    WHERE id = v_item.id AND pharmacy_id = p_pharmacy_id;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'in', v_quantity,
      v_buy_price, v_line_total, 'purchase', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF p_supplier_id IS NOT NULL AND v_due > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = COALESCE(balance, 0) + v_due,
        updated_at = now()
    WHERE id = p_supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_paid > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, 'purchase', 'supplier_payment', v_paid, 'out',
      'pharmacy_purchases', v_purchase.id,
      'سداد فاتورة شراء ' || v_purchase.purchase_number,
      COALESCE(p_purchase_date, now()), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
      FROM public.pharmacy_purchase_lines purchase_line
      WHERE purchase_line.purchase_id = v_purchase.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_received_purchase(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المشتريات';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'purchase', to_jsonb(v_purchase));
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  -- Validate availability first so the whole cancellation fails before any
  -- mutation if stock from this receipt has already been consumed.
  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id
        AND quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن مخزون الصنف % تم استخدامه', COALESCE(v_line.item_name, v_item.name_ar);
    END IF;

    IF v_line.batch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_item_batches
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id
        AND remaining_quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن كمية من التشغيلة % تم صرفها', COALESCE(v_line.batch_number, 'المستلمة');
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_line.quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id;
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_line.item_id, v_line.batch_id,
      'out', v_line.quantity, v_line.buy_price, v_line.net_total,
      'purchase_void', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.supplier_id IS NOT NULL AND v_purchase.due_amount > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = GREATEST(COALESCE(balance, 0) - v_purchase.due_amount, 0),
        updated_at = now()
    WHERE id = v_purchase.supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_purchase.paid_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_void', 'supplier_refund',
      v_purchase.paid_amount, 'in', 'pharmacy_purchases', v_purchase.id,
      'عكس سداد فاتورة شراء ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  UPDATE public.pharmacy_purchases
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة شراء مستلمة'),
      updated_at = now()
  WHERE id = p_purchase_id
  RETURNING * INTO v_purchase;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'purchase', to_jsonb(v_purchase));
END;
$$;

REVOKE ALL ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===== 20260618008000_schema_integrity_and_rls_hardening.sql =====
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


-- ===== 20260618009000_atomic_purchase_returns_rpc.sql =====
-- Atomic purchase returns RPCs.
-- Mirrors the sales return pattern but adapted for purchase invoices.
-- Returns deduct stock (or write-off), update batch remaining quantity,
-- settle supplier balance, and record financial movements in one transaction.

ALTER TABLE public.pharmacy_purchase_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.pharmacy_purchase_return_lines
  ADD COLUMN IF NOT EXISTS purchase_line_id UUID REFERENCES public.pharmacy_purchase_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_returns_client_request
  ON public.pharmacy_purchase_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_purchase_line
  ON public.pharmacy_purchase_return_lines(pharmacy_id, purchase_line_id);

CREATE OR REPLACE FUNCTION public.create_purchase_return(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_stock_mode TEXT DEFAULT 'restock',
  p_reason TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_return_number TEXT;
  v_stock_mode TEXT := COALESCE(NULLIF(BTRIM(p_stock_mode), ''), 'restock');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مشتريات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  IF v_stock_mode NOT IN ('restock', 'write-off') THEN
    RAISE EXCEPTION 'نظام المخزون غير صالح';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_purchase_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة الشراء غير موجودة';
  END IF;

  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_purchase_return_lines return_line
    JOIN public.pharmacy_purchase_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.purchase_line_id = v_purchase_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_purchase_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_purchase_line.item_name;
    END IF;

    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  v_return_number := 'PRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchase_returns (
    pharmacy_id, branch_id, purchase_id, return_number, client_request_id,
    supplier_name, total, refund_amount, stock_mode, reason, created_by
  )
  VALUES (
    p_pharmacy_id, v_purchase.branch_id, v_purchase.id, v_return_number, p_client_request_id,
    v_purchase.supplier_name, v_total, v_total, v_stock_mode,
    NULLIF(BTRIM(p_reason), ''), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);

    INSERT INTO public.pharmacy_purchase_return_lines (
      pharmacy_id, return_id, purchase_line_id, item_id, batch_id,
      quantity, unit, buy_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_purchase_line.id, v_purchase_line.item_id, v_purchase_line.batch_id,
      v_quantity, v_purchase_line.unit, v_purchase_line.buy_price, v_line_total
    );

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_purchase_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF v_stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = GREATEST(quantity - v_quantity, 0),
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_purchase.branch_id
          AND item_id = v_purchase_line.item_id;
      END IF;

      IF v_purchase_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = GREATEST(remaining_quantity - v_quantity, 0),
            updated_at = now()
        WHERE id = v_purchase_line.batch_id
          AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_purchase_line.item_id, v_purchase_line.batch_id,
      'out', v_quantity, v_purchase_line.buy_price, v_line_total,
      CASE WHEN v_stock_mode = 'restock' THEN 'purchase_return' ELSE 'purchase_return_write_off' END,
      'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET paid_amount = GREATEST(COALESCE(paid_amount, 0), 0),
        due_amount = GREATEST(COALESCE(due_amount, 0) - v_total, 0),
        payment_status = CASE
          WHEN GREATEST(COALESCE(due_amount, 0) - v_total, 0) <= 0 THEN 'paid'
          WHEN GREATEST(COALESCE(paid_amount, 0), 0) > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE id = v_purchase.id;

    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_return', 'supplier_refund',
      v_total, 'in', 'pharmacy_purchase_returns', v_return.id,
      'مرتجع مشتريات للفاتورة ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_purchase_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_purchase_return(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_line public.pharmacy_purchase_return_lines%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء مرتجعات المشتريات';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE id = p_return_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'مرتجع الشراء غير موجود';
  END IF;

  IF v_return.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'return', to_jsonb(v_return));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_return.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع المرتجع';
  END IF;

  IF v_return.purchase_id IS NOT NULL THEN
    SELECT * INTO v_purchase
    FROM public.pharmacy_purchases
    WHERE id = v_return.purchase_id AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;
  END IF;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_return_lines
    WHERE return_id = p_return_id AND pharmacy_id = p_pharmacy_id
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF v_return.stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = quantity + v_line.quantity,
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_return.branch_id
          AND item_id = v_line.item_id;
      END IF;

      IF v_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = remaining_quantity + v_line.quantity,
            updated_at = now()
        WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_return.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.buy_price, v_line.total,
      'purchase_return_void', 'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.id IS NOT NULL AND v_return.total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET due_amount = COALESCE(due_amount, 0) + v_return.total,
        payment_status = CASE
          WHEN COALESCE(due_amount, 0) + v_return.total > 0 THEN 'unpaid'
          ELSE payment_status
        END,
        updated_at = now()
    WHERE id = v_purchase.id;
  END IF;

  UPDATE public.pharmacy_purchase_returns
  SET voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء مرتجع شراء'),
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_return;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'return', to_jsonb(v_return));
END;
$$;

REVOKE ALL ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===== 20260618010000_tasks_table_import_stock_approval.sql =====
-- Tasks table, items import, and stock count approval RPC

-- 0. Add approval columns to stock counts
ALTER TABLE public.pharmacy_stock_counts
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- 1. Pharmacy Tasks table
CREATE TABLE IF NOT EXISTS public.pharmacy_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tasks_pharmacy ON public.pharmacy_tasks(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON public.pharmacy_tasks(pharmacy_id, completed);

-- Use the same tenant-isolation pattern as other tables: has_pharmacy_access
DROP POLICY IF EXISTS task_tenant_select ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_insert ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_update ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_delete ON public.pharmacy_tasks;
CREATE POLICY task_tenant_select ON public.pharmacy_tasks
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY task_tenant_insert ON public.pharmacy_tasks
  FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY task_tenant_update ON public.pharmacy_tasks
  FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY task_tenant_delete ON public.pharmacy_tasks
  FOR DELETE USING (public.has_pharmacy_access(pharmacy_id));

-- 2. Items import logs reference
ALTER TABLE public.pharmacy_import_logs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '[]'::jsonb;

-- 3. Stock count approval RPC
CREATE OR REPLACE FUNCTION public.approve_stock_count_variance(
  p_pharmacy_id UUID,
  p_count_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_count public.pharmacy_stock_counts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_variance NUMERIC;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:stocktake', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد الجرد';
  END IF;

  SELECT * INTO v_count
  FROM public.pharmacy_stock_counts
  WHERE id = p_count_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الجرد غير موجود';
  END IF;

  IF v_count.status IN ('approved', 'void') THEN
    RAISE EXCEPTION 'سجل الجرد معتمد أو ملغي مسبقاً';
  END IF;

  v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND v_item.manage_inventory AND v_variance != 0 THEN
    UPDATE public.pharmacy_stock_balances
    SET quantity = GREATEST(COALESCE(quantity, 0) + v_variance, 0),
        updated_at = now()
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
      CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
      ABS(v_variance), 0, 0,
      'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
    );
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      variance = v_variance,
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===== 20260618011000_operational_p0_fixes.sql =====
-- P0 operational fixes for real cashier/inventory delivery.
-- 1) Missing production tables used by the UI/API.
-- 2) Opening stock must be reflected in real stock balances/movements.
-- 3) Prevent more than one open cashier shift for the same user/branch.

CREATE TABLE IF NOT EXISTS public.pharmacy_price_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  discount_percent NUMERIC(7,3) DEFAULT 0 NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  markup_percent NUMERIC(7,3) DEFAULT 0 NOT NULL CHECK (markup_percent >= 0 AND markup_percent <= 1000),
  is_default BOOLEAN DEFAULT false NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL CHECK (status IN ('active','inactive')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name),
  UNIQUE(pharmacy_id, code)
);

CREATE TABLE IF NOT EXISTS public.pharmacy_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.pharmacy_sales(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL DEFAULT 'مريض',
  doctor_name TEXT,
  diagnosis TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'open' NOT NULL CHECK (status IN ('open','dispensed','cancelled','archived')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_price_groups_pharmacy
  ON public.pharmacy_price_groups(pharmacy_id, status, name);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_pharmacy
  ON public.pharmacy_prescriptions(pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_patient
  ON public.pharmacy_prescriptions(pharmacy_id, patient_name);

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

DROP INDEX IF EXISTS public.idx_pharmacy_shifts_one_open_per_cashier_branch;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_shifts_one_open_per_cashier_branch
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id)
  WHERE status = 'open';

-- Backfill opening_stock into the real stock tables for old items that were created before this fix.
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

ALTER TABLE public.pharmacy_price_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_price_groups_read ON public.pharmacy_price_groups;
CREATE POLICY pharmacy_price_groups_read ON public.pharmacy_price_groups
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:read', auth.uid()));

DROP POLICY IF EXISTS pharmacy_price_groups_write ON public.pharmacy_price_groups;
CREATE POLICY pharmacy_price_groups_write ON public.pharmacy_price_groups
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()));

DROP POLICY IF EXISTS pharmacy_prescriptions_read ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_read ON public.pharmacy_prescriptions
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()));

DROP POLICY IF EXISTS pharmacy_prescriptions_write ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_write ON public.pharmacy_prescriptions
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()));


-- ===== 20260618012000_operational_p2_transfers_counts_sync.sql =====
-- P2 operational hardening: stock transfers, stock count approval, and sync/audit indexes.

-- 1) Keep transfer status compatible with existing UI/API flows.
ALTER TABLE public.pharmacy_stock_transfers
  DROP CONSTRAINT IF EXISTS pharmacy_stock_transfers_status_check;
ALTER TABLE public.pharmacy_stock_transfers
  ADD CONSTRAINT pharmacy_stock_transfers_status_check
  CHECK (status IN ('draft','pending','completed','cancelled','void','posted'));

CREATE INDEX IF NOT EXISTS idx_stock_transfers_scope_status
  ON public.pharmacy_stock_transfers(pharmacy_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_counts_scope_status
  ON public.pharmacy_stock_counts(pharmacy_id, branch_id, status, created_at DESC);

-- 2) Atomic branch transfer: validates stock in source, moves quantity, writes movements.
CREATE OR REPLACE FUNCTION public.complete_stock_transfer(
  p_pharmacy_id UUID,
  p_transfer_id UUID,
  p_actor_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.pharmacy_stock_transfers%ROWTYPE;
  v_line JSONB;
  v_item public.pharmacy_items%ROWTYPE;
  v_item_id UUID;
  v_qty NUMERIC;
  v_unit TEXT;
  v_remaining NUMERIC;
  v_moved_count INT := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:transfer.write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد التحويل المخزني';
  END IF;

  SELECT * INTO v_transfer
  FROM public.pharmacy_stock_transfers
  WHERE id = p_transfer_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود';
  END IF;

  IF v_transfer.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'duplicate', true);
  END IF;

  IF v_transfer.status IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ تحويل ملغي';
  END IF;

  IF v_transfer.from_branch_id = v_transfer.to_branch_id THEN
    RAISE EXCEPTION 'فرع المصدر والوجهة متطابقان';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches b
    WHERE b.pharmacy_id = p_pharmacy_id
      AND b.id IN (v_transfer.from_branch_id, v_transfer.to_branch_id)
    GROUP BY b.pharmacy_id
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'فروع التحويل لا تتبع نفس الصيدلية';
  END IF;

  IF jsonb_typeof(COALESCE(v_transfer.lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_transfer.lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'التحويل لا يحتوي على أصناف';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_transfer.lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::NUMERIC, 0);
    v_unit := NULLIF(BTRIM(COALESCE(v_line->>'unit', '')), '');

    IF v_item_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات أحد أصناف التحويل غير صحيحة';
    END IF;

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_item_id AND pharmacy_id = p_pharmacy_id AND status <> 'deleted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود داخل التحويل';
    END IF;

    IF COALESCE(v_item.manage_inventory, true) THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_qty,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND item_id = v_item_id
        AND branch_id = v_transfer.from_branch_id
        AND quantity >= v_qty
      RETURNING quantity INTO v_remaining;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'كمية غير كافية للصنف: %', v_item.name_ar;
      END IF;

      INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
      VALUES (p_pharmacy_id, v_item_id, v_transfer.to_branch_id, v_qty, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
                    updated_at = now();

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, item_id, batch_id, branch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      ) VALUES
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.from_branch_id, 'out', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_out', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      ),
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.to_branch_id, 'in', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_in', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      );

      v_moved_count := v_moved_count + 1;
    END IF;
  END LOOP;

  UPDATE public.pharmacy_stock_transfers
  SET status = 'completed',
      notes = CASE
        WHEN NULLIF(BTRIM(COALESCE(p_notes, '')), '') IS NULL THEN notes
        WHEN NULLIF(BTRIM(COALESCE(notes, '')), '') IS NULL THEN BTRIM(p_notes)
        ELSE notes || E'\n' || BTRIM(p_notes)
      END,
      updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'moved_lines', v_moved_count);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) TO authenticated, service_role;

-- 3) Safer stock-count approval: creates balance row when missing and always targets counted quantity logically.
CREATE OR REPLACE FUNCTION public.approve_stock_count_variance(
  p_pharmacy_id UUID,
  p_count_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_count public.pharmacy_stock_counts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_current_qty NUMERIC := 0;
  v_variance NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:stocktake', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد الجرد';
  END IF;

  SELECT * INTO v_count
  FROM public.pharmacy_stock_counts
  WHERE id = p_count_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الجرد غير موجود';
  END IF;

  IF v_count.status IN ('approved', 'void') THEN
    RAISE EXCEPTION 'سجل الجرد معتمد أو ملغي مسبقاً';
  END IF;

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND COALESCE(v_item.manage_inventory, true) THEN
    SELECT COALESCE(quantity, 0) INTO v_current_qty
    FROM public.pharmacy_stock_balances
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id
    FOR UPDATE;

    v_current_qty := COALESCE(v_current_qty, 0);
    v_variance := COALESCE(v_count.counted_qty, 0) - v_current_qty;

    INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
    VALUES (p_pharmacy_id, v_count.item_id, v_count.branch_id, GREATEST(COALESCE(v_count.counted_qty, 0), 0), now())
    ON CONFLICT (pharmacy_id, item_id, branch_id)
    DO UPDATE SET quantity = GREATEST(COALESCE(v_count.counted_qty, 0), 0), updated_at = now();

    IF v_variance != 0 THEN
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
        CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
        ABS(v_variance), COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * ABS(v_variance),
        'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
      );
    END IF;
  ELSE
    v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      expected_qty = COALESCE(v_current_qty, expected_qty),
      variance = v_variance,
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===== 20260618013000_operational_p3_item_import_extended_fields.sql =====
-- P3: extended product import fields compatible with the client's Excel template.
-- Safe for existing databases: all columns are additive.

ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS sub_category TEXT,
  ADD COLUMN IF NOT EXISTS barcode_type TEXT,
  ADD COLUMN IF NOT EXISTS expiry_period_value NUMERIC(14,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_period_unit TEXT,
  ADD COLUMN IF NOT EXISTS tax_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selling_price_tax_type TEXT,
  ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS variation_name TEXT,
  ADD COLUMN IF NOT EXISTS variation_values TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS variation_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS purchase_price_including_tax NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_price_excluding_tax NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_margin NUMERIC(8,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_stock_location TEXT,
  ADD COLUMN IF NOT EXISTS serial_tracking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS weight NUMERIC(14,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rack TEXT,
  ADD COLUMN IF NOT EXISTS shelf_row TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS product_description TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_1 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_2 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_3 TEXT,
  ADD COLUMN IF NOT EXISTS custom_field_4 TEXT,
  ADD COLUMN IF NOT EXISTS product_locations TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS import_metadata JSONB DEFAULT '{}'::JSONB;

ALTER TABLE public.pharmacy_item_variants
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_sub_category
  ON public.pharmacy_items(pharmacy_id, lower(sub_category));

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_storage_location
  ON public.pharmacy_items(pharmacy_id, rack, shelf_row, position);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_product_type
  ON public.pharmacy_items(pharmacy_id, product_type);

CREATE INDEX IF NOT EXISTS idx_item_variants_sku
  ON public.pharmacy_item_variants(pharmacy_id, sku)
  WHERE sku IS NOT NULL AND sku <> '';


-- ===== 20260618015000_item_units_suppliers_closure.sql =====
-- P4 operational closure: item unit equations + supplier views safety.

ALTER TABLE public.pharmacy_item_units
  ADD COLUMN IF NOT EXISTS main_unit TEXT,
  ADD COLUMN IF NOT EXISTS sub_unit TEXT,
  ADD COLUMN IF NOT EXISTS qty_per_main_unit NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS unit_raw TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.pharmacy_item_units
SET
  main_unit = COALESCE(main_unit, CASE WHEN is_base THEN unit_name ELSE unit_name END),
  sub_unit = COALESCE(sub_unit, unit_name),
  qty_per_main_unit = COALESCE(qty_per_main_unit, factor, 1),
  unit_raw = COALESCE(unit_raw, unit_name),
  updated_at = COALESCE(updated_at, now())
WHERE main_unit IS NULL
   OR sub_unit IS NULL
   OR qty_per_main_unit IS NULL
   OR unit_raw IS NULL;

CREATE INDEX IF NOT EXISTS idx_item_units_item_equation
  ON public.pharmacy_item_units(pharmacy_id, item_id, is_base, factor);

CREATE INDEX IF NOT EXISTS idx_partners_supplier_lookup
  ON public.pharmacy_partners(pharmacy_id, type, status, name);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_lookup
  ON public.pharmacy_purchases(pharmacy_id, supplier_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_partner_lookup
  ON public.pharmacy_payments(pharmacy_id, partner_id, payment_date DESC);


-- ===== 20260618016000_global_units_and_alternatives_ui.sql =====
-- Adds a clean global units table used by settings/add-item dropdowns.
-- Item-specific equations remain in pharmacy_item_units.
--
-- This migration is intentionally reconciliatory: some environments already
-- have a partially-created pharmacy_units table. CREATE TABLE IF NOT EXISTS
-- does not add missing columns to an existing table, so normalize it before
-- creating indexes or using ON CONFLICT.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, unit_name)
);

ALTER TABLE public.pharmacy_units
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.pharmacy_units
SET
  is_active = COALESCE(is_active, true),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, created_at, now())
WHERE is_active IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL;

ALTER TABLE public.pharmacy_units
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

-- Keep the oldest row when an earlier/manual table creation allowed duplicates.
WITH ranked_units AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pharmacy_id, unit_name
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.pharmacy_units
)
DELETE FROM public.pharmacy_units units
USING ranked_units duplicate
WHERE units.id = duplicate.id
  AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_units_pharmacy_id_unit_name_key
  ON public.pharmacy_units(pharmacy_id, unit_name);

-- Most dropdown reads only request active units. A partial index is smaller
-- and cheaper to maintain than storing the boolean inside every index entry.
DROP INDEX IF EXISTS public.idx_pharmacy_units_lookup;
CREATE INDEX idx_pharmacy_units_lookup
  ON public.pharmacy_units(pharmacy_id, unit_name)
  WHERE is_active = true;

INSERT INTO public.pharmacy_units (pharmacy_id, unit_name)
SELECT DISTINCT pharmacy_id, NULLIF(TRIM(unit_name), '')
FROM public.pharmacy_item_units
WHERE NULLIF(TRIM(unit_name), '') IS NOT NULL
ON CONFLICT (pharmacy_id, unit_name) DO NOTHING;

INSERT INTO public.pharmacy_units (pharmacy_id, unit_name)
SELECT p.id, unit_name
FROM public.pharmacies p
CROSS JOIN (
  VALUES ('وحدة'), ('علبة'), ('شريط'), ('قرص'), ('زجاجة'), ('كيس'), ('عبوة')
) AS defaults(unit_name)
ON CONFLICT (pharmacy_id, unit_name) DO NOTHING;

COMMIT;


-- ===== 20260618017000_legacy_function_conflict_cleanup.sql =====
-- Remove obsolete RPCs left by the legacy document-based schema.
-- The current application does not call these functions; keeping them makes
-- schema validation fail because their old tables/columns no longer exist.

BEGIN;

DO $$
DECLARE
  legacy_function RECORD;
  legacy_names CONSTANT TEXT[] := ARRAY[
    'pharmacy_upsert_doc',
    'create_pharmacy_sale_transaction',
    'create_pharmacy_purchase_atomic',
    'create_pharmacy_stock_count_atomic',
    'create_pharmacy_price_update_atomic',
    'create_pharmacy_sale_atomic',
    'safe_adjust_pharmacy_stock',
    'close_pharmacy_cashier_shift',
    'create_pharmacy_purchase_transaction',
    'void_pharmacy_purchase',
    'create_sale_atomic',
    'open_pharmacy_cashier_shift',
    'revoke_employee_login',
    'void_pharmacy_expense',
    'grant_employee_login',
    'create_purchase_atomic',
    'create_shift_atomic',
    'create_pharmacy_return_atomic',
    'create_pharmacy_expense_atomic',
    'create_pharmacy_shift_atomic',
    'create_pharmacy_stock_transfer_atomic',
    'create_pharmacy_damaged_stock_atomic',
    'void_pharmacy_sale'
  ];
BEGIN
  FOR legacy_function IN
    SELECT procedure.oid::regprocedure AS signature
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY (legacy_names)
  LOOP
    EXECUTE format('DROP FUNCTION %s', legacy_function.signature);
  END LOOP;
END;
$$;

-- Re-deploy ensure_owner_workspace instead of using ALTER FUNCTION SET plpgsql.variable_conflict.
-- Supabase SQL editor/API roles cannot set plpgsql.variable_conflict, so this
-- definition avoids the conflict by using explicit variable names and ON CONSTRAINT.
CREATE OR REPLACE FUNCTION public.ensure_owner_workspace(
  p_user_id UUID DEFAULT auth.uid(),
  p_project_name TEXT DEFAULT NULL,
  p_owner_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'EG',
  p_city TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP',
  p_timezone TEXT DEFAULT 'Africa/Cairo'
)
RETURNS TABLE(pharmacy_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_claim_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), NULLIF(BTRIM(p_owner_name), ''), 'صيدلية جديدة');
  v_email TEXT := NULLIF(BTRIM(p_email), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  IF v_claim_role <> 'service_role'
    AND (
      v_actor_id IS NULL
      OR (
        v_actor_id <> p_user_id
        AND NOT public.is_developer(v_actor_id)
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن تجهيز صيدلية لمستخدم آخر';
  END IF;

  IF public.is_developer(p_user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يتبع صيدلية';
  END IF;

  INSERT INTO public.pharmacies (
    owner_id, name, legal_name, status, plan, currency, country, timezone, phone, email, address
  )
  VALUES (
    p_user_id,
    v_project_name,
    v_project_name,
    'active',
    'trial',
    COALESCE(NULLIF(BTRIM(p_currency), ''), 'EGP'),
    COALESCE(NULLIF(BTRIM(p_country), ''), 'EG'),
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Africa/Cairo'),
    NULLIF(BTRIM(p_phone), ''),
    v_email,
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
  VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(BTRIM(p_city), ''), NULLIF(BTRIM(p_phone), ''), true, 'active')
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active, updated_at)
  VALUES (
    p_user_id,
    COALESCE(v_email, p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(v_email, public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = CASE WHEN public.user_profiles.global_role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status, updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    v_email,
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'صاحب الصيدلية',
    'owner',
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    'created',
    now()
  )
  ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
    branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
    email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
    title = 'صاحب الصيدلية',
    role = CASE WHEN public.pharmacy_profiles.role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    disabled_reason = NULL,
    updated_at = now();

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;


-- ===== 20260618018000_final_schema_conflicts_no_privileged_settings.sql =====
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


-- ===== 20260619000000_performance_indexes.sql =====
-- Performance indexes for pharmacy inventory operations

-- pharmacy_stock_movements: no indexes previously; this table is queried by
-- pharmacy_id + item_id (per-item history), pharmacy_id + branch_id (branch
-- filter), and pharmacy_id + movement_type + created_at (list view).
CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_item
  ON public.pharmacy_stock_movements(pharmacy_id, item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_branch
  ON public.pharmacy_stock_movements(pharmacy_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_type
  ON public.pharmacy_stock_movements(pharmacy_id, movement_type, created_at DESC);

-- pharmacy_stock_balances: composite index for branch-filtered queries
-- (existing index is only pharmacy_id + item_id).
CREATE INDEX IF NOT EXISTS idx_stock_balances_branch
  ON public.pharmacy_stock_balances(pharmacy_id, branch_id, item_id);

-- pharmacy_item_batches: composite index for batch lookups by pharmacy+branch
-- (existing index is item_id + expiry_date only).
CREATE INDEX IF NOT EXISTS idx_item_batches_pharmacy_branch
  ON public.pharmacy_item_batches(pharmacy_id, branch_id, item_id);

-- pharmacy_item_barcodes: composite index for item-scoped barcode lookups
-- (existing index is barcode only).
CREATE INDEX IF NOT EXISTS idx_item_barcodes_pharmacy_item
  ON public.pharmacy_item_barcodes(pharmacy_id, item_id);

-- pharmacy_damaged_stock: no index exists; queried by pharmacy_id
CREATE INDEX IF NOT EXISTS idx_damaged_stock_pharmacy
  ON public.pharmacy_damaged_stock(pharmacy_id, created_at DESC);

-- pharmacy_item_units: index for sub-unit filter queries
CREATE INDEX IF NOT EXISTS idx_item_units_pharmacy_item
  ON public.pharmacy_item_units(pharmacy_id, item_id);


-- ===== 20260619001000_items_cycle_integrity_and_fast_filters.sql =====
-- Complete item-cycle integrity, audit and fast server-side filters.
-- This migration is additive and preserves legacy data before resolving conflicts.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_item_barcode(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(
    regexp_replace(
      translate(trim(COALESCE(p_value, '')), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '[[:space:]-]+', '', 'g'
    ), chr(8206), ''), chr(8207), '')
$$;

CREATE TABLE IF NOT EXISTS public.pharmacy_item_barcode_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.pharmacy_items(id) ON DELETE SET NULL,
  source_table TEXT NOT NULL,
  source_id UUID,
  barcode TEXT NOT NULL,
  normalized_barcode TEXT NOT NULL,
  conflict_with_item_id UUID REFERENCES public.pharmacy_items(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_barcode_conflicts_scope
  ON public.pharmacy_item_barcode_conflicts(pharmacy_id, created_at DESC);

-- Archive then remove duplicate main barcode rows created by legacy formatting differences.
WITH ranked AS (
  SELECT b.*,
         row_number() OVER (
           PARTITION BY b.pharmacy_id, public.normalize_item_barcode(b.barcode)
           ORDER BY b.is_primary DESC, b.created_at, b.id
         ) AS rn,
         first_value(b.item_id) OVER (
           PARTITION BY b.pharmacy_id, public.normalize_item_barcode(b.barcode)
           ORDER BY b.is_primary DESC, b.created_at, b.id
         ) AS kept_item_id
  FROM public.pharmacy_item_barcodes b
  WHERE public.normalize_item_barcode(b.barcode) <> ''
), archived AS (
  INSERT INTO public.pharmacy_item_barcode_conflicts(
    pharmacy_id, item_id, source_table, source_id, barcode, normalized_barcode,
    conflict_with_item_id, payload
  )
  SELECT pharmacy_id, item_id, 'pharmacy_item_barcodes', id, barcode,
         public.normalize_item_barcode(barcode), kept_item_id, to_jsonb(ranked)
  FROM ranked
  WHERE rn > 1
  RETURNING source_id
)
DELETE FROM public.pharmacy_item_barcodes b
USING archived a
WHERE b.id = a.source_id;

-- Normalization is safe after legacy duplicates were archived and removed.
UPDATE public.pharmacy_item_barcodes
SET barcode = public.normalize_item_barcode(barcode)
WHERE barcode IS DISTINCT FROM public.normalize_item_barcode(barcode);

UPDATE public.pharmacy_item_units
SET barcode = NULLIF(public.normalize_item_barcode(barcode), ''), updated_at = now()
WHERE barcode IS NOT NULL
  AND barcode IS DISTINCT FROM NULLIF(public.normalize_item_barcode(barcode), '');

-- A unit barcode cannot duplicate a main barcode or another unit barcode.
WITH ranked_units AS (
  SELECT u.*,
         row_number() OVER (
           PARTITION BY u.pharmacy_id, public.normalize_item_barcode(u.barcode)
           ORDER BY u.is_base DESC, u.created_at, u.id
         ) AS rn,
         first_value(u.item_id) OVER (
           PARTITION BY u.pharmacy_id, public.normalize_item_barcode(u.barcode)
           ORDER BY u.is_base DESC, u.created_at, u.id
         ) AS kept_item_id
  FROM public.pharmacy_item_units u
  WHERE NULLIF(public.normalize_item_barcode(u.barcode), '') IS NOT NULL
), conflicts AS (
  SELECT r.*,
         EXISTS (
           SELECT 1 FROM public.pharmacy_item_barcodes b
           WHERE b.pharmacy_id = r.pharmacy_id
             AND public.normalize_item_barcode(b.barcode) = public.normalize_item_barcode(r.barcode)
         ) AS conflicts_main
  FROM ranked_units r
), archived AS (
  INSERT INTO public.pharmacy_item_barcode_conflicts(
    pharmacy_id, item_id, source_table, source_id, barcode, normalized_barcode,
    conflict_with_item_id, payload
  )
  SELECT pharmacy_id, item_id, 'pharmacy_item_units', id, barcode,
         public.normalize_item_barcode(barcode), kept_item_id, to_jsonb(conflicts)
  FROM conflicts
  WHERE rn > 1 OR conflicts_main
  RETURNING source_id
)
UPDATE public.pharmacy_item_units u
SET barcode = NULL, updated_at = now()
FROM archived a
WHERE u.id = a.source_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_barcodes_normalized
  ON public.pharmacy_item_barcodes(pharmacy_id, public.normalize_item_barcode(barcode))
  WHERE public.normalize_item_barcode(barcode) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_unit_barcodes_normalized
  ON public.pharmacy_item_units(pharmacy_id, public.normalize_item_barcode(barcode))
  WHERE NULLIF(public.normalize_item_barcode(barcode), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_unique_item_barcode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barcode TEXT := public.normalize_item_barcode(NEW.barcode);
  v_item_id UUID;
BEGIN
  IF v_barcode = '' THEN
    IF TG_TABLE_NAME = 'pharmacy_item_barcodes' THEN
      RAISE EXCEPTION 'barcode_required' USING ERRCODE = '23514';
    END IF;
    NEW.barcode := NULL;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.pharmacy_id::text || ':' || v_barcode, 0));
  NEW.barcode := v_barcode;

  IF TG_TABLE_NAME = 'pharmacy_item_barcodes' THEN
    SELECT u.item_id INTO v_item_id
    FROM public.pharmacy_item_units u
    WHERE u.pharmacy_id = NEW.pharmacy_id
      AND public.normalize_item_barcode(u.barcode) = v_barcode
      AND (TG_OP = 'INSERT' OR u.id IS DISTINCT FROM NEW.id)
    LIMIT 1;
  ELSE
    SELECT b.item_id INTO v_item_id
    FROM public.pharmacy_item_barcodes b
    WHERE b.pharmacy_id = NEW.pharmacy_id
      AND public.normalize_item_barcode(b.barcode) = v_barcode
    LIMIT 1;
  END IF;

  IF v_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'barcode_already_used:%', v_barcode USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_barcodes_unique_cross_table ON public.pharmacy_item_barcodes;
CREATE TRIGGER trg_item_barcodes_unique_cross_table
BEFORE INSERT OR UPDATE OF barcode, pharmacy_id ON public.pharmacy_item_barcodes
FOR EACH ROW EXECUTE FUNCTION public.assert_unique_item_barcode();

DROP TRIGGER IF EXISTS trg_item_units_unique_cross_table ON public.pharmacy_item_units;
CREATE TRIGGER trg_item_units_unique_cross_table
BEFORE INSERT OR UPDATE OF barcode, pharmacy_id ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.assert_unique_item_barcode();

-- Price history for every real change, including imports and bulk updates.
CREATE TABLE IF NOT EXISTS public.pharmacy_item_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.pharmacy_items(id) ON DELETE CASCADE,
  old_buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  old_sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'item_update',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_price_history_item
  ON public.pharmacy_item_price_history(pharmacy_id, item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_item_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.buy_price IS DISTINCT FROM NEW.buy_price OR OLD.sell_price IS DISTINCT FROM NEW.sell_price THEN
    INSERT INTO public.pharmacy_item_price_history(
      pharmacy_id, item_id, old_buy_price, new_buy_price, old_sell_price, new_sell_price,
      changed_by, source, metadata
    ) VALUES (
      NEW.pharmacy_id, NEW.id,
      COALESCE(OLD.buy_price, 0), COALESCE(NEW.buy_price, 0),
      COALESCE(OLD.sell_price, 0), COALESCE(NEW.sell_price, 0),
      COALESCE(auth.uid(), NULLIF(current_setting('app.actor_id', true), '')::uuid), COALESCE(NULLIF(current_setting('app.item_price_source', true), ''), 'item_update'),
      jsonb_build_object('previous_old_sell_price', OLD.old_sell_price)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_price_change ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_price_change
AFTER UPDATE OF buy_price, sell_price ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_price_change();

-- Complete deleted snapshot, not only status metadata.
CREATE OR REPLACE FUNCTION public.audit_item_soft_delete_restore()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  IF OLD.status IS DISTINCT FROM 'deleted' AND NEW.status = 'deleted' THEN
    SELECT to_jsonb(NEW)
      || jsonb_build_object(
        'barcodes', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) FROM public.pharmacy_item_barcodes b WHERE b.item_id = NEW.id), '[]'::jsonb),
        'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.created_at) FROM public.pharmacy_item_units u WHERE u.item_id = NEW.id), '[]'::jsonb),
        'variants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at) FROM public.pharmacy_item_variants v WHERE v.item_id = NEW.id), '[]'::jsonb),
        'balances', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.pharmacy_stock_balances s WHERE s.item_id = NEW.id), '[]'::jsonb),
        'batches', COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.created_at) FROM public.pharmacy_item_batches bt WHERE bt.item_id = NEW.id), '[]'::jsonb)
      ) INTO v_snapshot;

    INSERT INTO public.pharmacy_deleted_items_audit(
      pharmacy_id, item_id, item_snapshot, deleted_by, deleted_at
    ) VALUES (
      NEW.pharmacy_id, NEW.id, v_snapshot,
      COALESCE(NEW.deleted_by, auth.uid()), COALESCE(NEW.deleted_at, now())
    );
  ELSIF OLD.status = 'deleted' AND NEW.status IS DISTINCT FROM 'deleted' THEN
    UPDATE public.pharmacy_deleted_items_audit
    SET restored_by = auth.uid(), restored_at = now()
    WHERE id = (
      SELECT id FROM public.pharmacy_deleted_items_audit
      WHERE pharmacy_id = NEW.pharmacy_id AND item_id = NEW.id AND restored_at IS NULL
      ORDER BY deleted_at DESC LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_soft_delete_restore ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_soft_delete_restore
AFTER UPDATE OF status ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_soft_delete_restore();

CREATE OR REPLACE FUNCTION public.audit_item_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  SELECT to_jsonb(OLD)
    || jsonb_build_object(
      'hard_deleted', true,
      'barcodes', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) FROM public.pharmacy_item_barcodes b WHERE b.item_id = OLD.id), '[]'::jsonb),
      'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.created_at) FROM public.pharmacy_item_units u WHERE u.item_id = OLD.id), '[]'::jsonb),
      'variants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at) FROM public.pharmacy_item_variants v WHERE v.item_id = OLD.id), '[]'::jsonb),
      'balances', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.pharmacy_stock_balances s WHERE s.item_id = OLD.id), '[]'::jsonb),
      'batches', COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.created_at) FROM public.pharmacy_item_batches bt WHERE bt.item_id = OLD.id), '[]'::jsonb)
    ) INTO v_snapshot;

  INSERT INTO public.pharmacy_deleted_items_audit(pharmacy_id, item_id, item_snapshot, deleted_by, deleted_at)
  VALUES (OLD.pharmacy_id, OLD.id, v_snapshot, auth.uid(), now());
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_hard_delete ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_hard_delete
BEFORE DELETE ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_hard_delete();


CREATE OR REPLACE FUNCTION public.sync_item_search_from_relation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_item_search_text(OLD.item_id);
    RETURN OLD;
  END IF;
  PERFORM public.rebuild_item_search_text(NEW.item_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_barcodes ON public.pharmacy_item_barcodes;
CREATE TRIGGER trg_sync_item_search_barcodes
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_item_barcodes
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_relation();

DROP TRIGGER IF EXISTS trg_sync_item_search_units ON public.pharmacy_item_units;
CREATE TRIGGER trg_sync_item_search_units
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_relation();

UPDATE public.pharmacy_items i
SET search_text = lower(concat_ws(' ',
  i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.category, i.sub_category,
  (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
  (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
));

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_search_trgm
  ON public.pharmacy_items USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_catalog_status_name
  ON public.pharmacy_items(pharmacy_id, status, name_ar, id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_catalog_filters
  ON public.pharmacy_items(pharmacy_id, group_id, brand_id, item_type, not_for_sale);
CREATE INDEX IF NOT EXISTS idx_stock_balances_filter
  ON public.pharmacy_stock_balances(pharmacy_id, branch_id, item_id, quantity);
CREATE INDEX IF NOT EXISTS idx_item_batches_filter_expiry
  ON public.pharmacy_item_batches(pharmacy_id, branch_id, item_id, expiry_date, remaining_quantity);

-- Atomic replacement of relation rows prevents half-updated items.
CREATE OR REPLACE FUNCTION public.pharmacy_replace_item_relations(
  p_pharmacy_id UUID,
  p_item_id UUID,
  p_barcodes JSONB DEFAULT NULL,
  p_units JSONB DEFAULT NULL,
  p_variants JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duplicate TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_developer(auth.uid()) OR public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager','pharmacist')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_items
    WHERE id = p_item_id AND pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_barcodes IS NOT NULL OR p_units IS NOT NULL THEN
    WITH incoming AS (
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_barcodes, '[]'::jsonb))
      UNION ALL
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
    )
    SELECT barcode INTO v_duplicate
    FROM incoming WHERE barcode <> ''
    GROUP BY barcode HAVING count(*) > 1
    LIMIT 1;

    IF v_duplicate IS NOT NULL THEN
      RAISE EXCEPTION 'barcode_already_used:%', v_duplicate USING ERRCODE = '23505';
    END IF;

    WITH incoming AS (
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_barcodes, '[]'::jsonb))
      UNION
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
    ), existing AS (
      SELECT public.normalize_item_barcode(b.barcode) barcode, b.item_id
      FROM public.pharmacy_item_barcodes b
      WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id <> p_item_id
      UNION ALL
      SELECT public.normalize_item_barcode(u.barcode), u.item_id
      FROM public.pharmacy_item_units u
      WHERE u.pharmacy_id = p_pharmacy_id AND u.item_id <> p_item_id AND u.barcode IS NOT NULL
    )
    SELECT i.barcode INTO v_duplicate
    FROM incoming i JOIN existing e USING (barcode)
    WHERE i.barcode <> '' LIMIT 1;

    IF v_duplicate IS NOT NULL THEN
      RAISE EXCEPTION 'barcode_already_used:%', v_duplicate USING ERRCODE = '23505';
    END IF;

    -- Delete both sets together only when both payloads are supplied; otherwise preserve untouched relations.
    IF p_barcodes IS NOT NULL THEN
      DELETE FROM public.pharmacy_item_barcodes WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    END IF;
    IF p_units IS NOT NULL THEN
      DELETE FROM public.pharmacy_item_units WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    END IF;

    IF p_barcodes IS NOT NULL THEN
      INSERT INTO public.pharmacy_item_barcodes(pharmacy_id, item_id, barcode, is_primary)
      SELECT p_pharmacy_id, p_item_id,
             public.normalize_item_barcode(value->>'barcode'),
             COALESCE((value->>'is_primary')::boolean, ordinality = 1)
      FROM jsonb_array_elements(p_barcodes) WITH ORDINALITY
      WHERE public.normalize_item_barcode(value->>'barcode') <> '';
    END IF;

    IF p_units IS NOT NULL THEN
      INSERT INTO public.pharmacy_item_units(
        pharmacy_id, item_id, unit_name, factor, barcode, sell_price, is_base,
        main_unit, sub_unit, qty_per_main_unit, unit_raw, updated_at
      )
      SELECT p_pharmacy_id, p_item_id,
             trim(value->>'unit_name'),
             GREATEST(COALESCE((value->>'factor')::numeric, 1), 0.001),
             NULLIF(public.normalize_item_barcode(value->>'barcode'), ''),
             NULLIF(value->>'sell_price', '')::numeric,
             COALESCE((value->>'is_base')::boolean, ordinality = 1),
             NULLIF(trim(value->>'main_unit'), ''),
             NULLIF(trim(value->>'sub_unit'), ''),
             GREATEST(COALESCE(NULLIF(value->>'qty_per_main_unit', '')::numeric, 0), 0),
             NULLIF(trim(value->>'unit_raw'), ''), now()
      FROM jsonb_array_elements(p_units) WITH ORDINALITY
      WHERE NULLIF(trim(value->>'unit_name'), '') IS NOT NULL;
    END IF;
  END IF;

  IF p_variants IS NOT NULL THEN
    DELETE FROM public.pharmacy_item_variants WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    INSERT INTO public.pharmacy_item_variants(pharmacy_id, item_id, name, value, sku, purchase_price, sell_price, metadata)
    SELECT p_pharmacy_id, p_item_id,
           COALESCE(NULLIF(trim(value->>'name'), ''), 'Variation'),
           trim(value->>'value'), NULLIF(trim(value->>'sku'), ''),
           COALESCE(NULLIF(value->>'purchase_price', '')::numeric, 0),
           COALESCE(NULLIF(value->>'sell_price', '')::numeric, 0),
           COALESCE(value->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_variants)
    WHERE NULLIF(trim(value->>'value'), '') IS NOT NULL;
  END IF;

  PERFORM public.rebuild_item_search_text(p_item_id);
  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pharmacy_bulk_update_item_price(
  p_pharmacy_id UUID,
  p_item_ids UUID[],
  p_mode TEXT,
  p_value NUMERIC,
  p_actor_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_developer(auth.uid()) OR public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager','pharmacist')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.item_price_source', 'bulk_price_update', true);
  PERFORM set_config('app.actor_id', COALESCE(p_actor_id::text, auth.uid()::text, ''), true);
  UPDATE public.pharmacy_items i
  SET old_sell_price = i.sell_price,
      sell_price = CASE p_mode
        WHEN 'fixed' THEN GREATEST(p_value, 0)
        WHEN 'increase_percent' THEN GREATEST(round(i.sell_price * (1 + p_value / 100), 2), 0)
        WHEN 'decrease_percent' THEN GREATEST(round(i.sell_price * (1 - p_value / 100), 2), 0)
        ELSE i.sell_price
      END,
      updated_at = now()
  WHERE i.pharmacy_id = p_pharmacy_id
    AND i.id = ANY(p_item_ids)
    AND i.status <> 'deleted';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER TABLE public.pharmacy_item_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_item_barcode_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_price_history_select ON public.pharmacy_item_price_history;
CREATE POLICY item_price_history_select ON public.pharmacy_item_price_history FOR SELECT
USING (public.is_developer(auth.uid()) OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS item_barcode_conflicts_select ON public.pharmacy_item_barcode_conflicts;
CREATE POLICY item_barcode_conflicts_select ON public.pharmacy_item_barcode_conflicts FOR SELECT
USING (public.is_developer(auth.uid()) OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin'));

GRANT EXECUTE ON FUNCTION public.pharmacy_replace_item_relations(UUID, UUID, JSONB, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_bulk_update_item_price(UUID, UUID[], TEXT, NUMERIC, UUID) TO authenticated, service_role;

COMMIT;


-- ===== 20260619002000_items_catalog_rpc.sql =====
-- Server-side item catalogue pagination/filtering for large datasets.
BEGIN;
-- (removed: pharmacy_item_filter_options — superseded by 20260619005000)
-- (removed: pharmacy_items_catalog 18-param — superseded by 20260620001000 19-param)

COMMIT;


-- ===== 20260619003000_operational_linking_closure.sql =====
-- Close remaining operational links without rewriting or dropping previous data.

CREATE TABLE IF NOT EXISTS public.pharmacy_partner_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  partner_name TEXT,
  channel TEXT NOT NULL DEFAULT 'note' CHECK (channel IN ('email','whatsapp','phone','sms','note')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft','sent','read','completed','failed')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_communications_scope
  ON public.pharmacy_partner_communications(pharmacy_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_communications_partner
  ON public.pharmacy_partner_communications(pharmacy_id, partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_communications_status
  ON public.pharmacy_partner_communications(pharmacy_id, status, channel, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_pharmacy_partner_communications_updated_at ON public.pharmacy_partner_communications;
CREATE TRIGGER trg_pharmacy_partner_communications_updated_at
BEFORE UPDATE ON public.pharmacy_partner_communications
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pharmacy_partner_communications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_communications_select ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_insert ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_update ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_delete ON public.pharmacy_partner_communications;
CREATE POLICY partner_communications_select ON public.pharmacy_partner_communications
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:read', auth.uid()));
CREATE POLICY partner_communications_insert ON public.pharmacy_partner_communications
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));
CREATE POLICY partner_communications_update ON public.pharmacy_partner_communications
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));
CREATE POLICY partner_communications_delete ON public.pharmacy_partner_communications
  FOR DELETE TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));

-- Separate read and write permissions at the application layer while preserving
-- compatibility with existing installations and custom role data.
DROP POLICY IF EXISTS pharmacy_prescriptions_read ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_read ON public.pharmacy_prescriptions
  FOR SELECT TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid())
  );

DROP POLICY IF EXISTS pharmacy_prescriptions_write ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_write ON public.pharmacy_prescriptions
  FOR ALL TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  )
  WITH CHECK (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  );


-- ===== 20260619004000_items_catalog_loading_performance.sql =====
BEGIN;

-- Relation lookups used by the catalogue now target only the current page.
CREATE INDEX IF NOT EXISTS idx_item_barcodes_catalog_page
  ON public.pharmacy_item_barcodes(pharmacy_id, item_id, is_primary DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_item_units_catalog_page
  ON public.pharmacy_item_units(pharmacy_id, item_id, is_base DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_item_batches_catalog_page
  ON public.pharmacy_item_batches(pharmacy_id, item_id, branch_id, expiry_date, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_balances_catalog_page
  ON public.pharmacy_stock_balances(pharmacy_id, item_id, branch_id);

CREATE OR REPLACE FUNCTION public.pharmacy_items_catalog(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active',
  p_search TEXT DEFAULT '',
  p_item_type TEXT DEFAULT 'all',
  p_group_id TEXT DEFAULT 'all',
  p_brand_id TEXT DEFAULT 'all',
  p_manufacturer TEXT DEFAULT 'all',
  p_unit TEXT DEFAULT 'all',
  p_sub_unit TEXT DEFAULT 'all',
  p_expiry TEXT DEFAULT 'all',
  p_price TEXT DEFAULT 'all',
  p_stock TEXT DEFAULT 'all',
  p_not_for_sale BOOLEAN DEFAULT false,
  p_is_controlled BOOLEAN DEFAULT NULL,
  p_sort_key TEXT DEFAULT 'name',
  p_sort_dir TEXT DEFAULT 'asc',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH stock_summary AS (
  SELECT s.item_id, sum(s.quantity)::numeric AS quantity
  FROM public.pharmacy_stock_balances s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.item_id
), batch_summary AS (
  SELECT b.item_id,
         min(b.expiry_date) FILTER (WHERE COALESCE(b.remaining_quantity, b.quantity, 0) > 0) AS nearest_expiry
  FROM public.pharmacy_item_batches b
  WHERE b.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
  GROUP BY b.item_id
), unit_names AS (
  SELECT u.item_id, array_agg(DISTINCT u.unit_name) AS names
  FROM public.pharmacy_item_units u
  WHERE u.pharmacy_id = p_pharmacy_id
  GROUP BY u.item_id
), base AS (
  SELECT i.*,
         COALESCE(s.quantity, 0) AS stock_quantity,
         COALESCE(u.names, ARRAY[]::text[]) AS unit_names,
         COALESCE(i.expiry_date, bt.nearest_expiry) AS effective_expiry,
         g.name AS group_name,
         br.name AS brand_name,
         pb.name AS branch_name
  FROM public.pharmacy_items i
  LEFT JOIN stock_summary s ON s.item_id = i.id
  LEFT JOIN batch_summary bt ON bt.item_id = i.id
  LEFT JOIN unit_names u ON u.item_id = i.id
  LEFT JOIN public.pharmacy_item_groups g ON g.id = i.group_id
  LEFT JOIN public.pharmacy_item_brands br ON br.id = i.brand_id
  LEFT JOIN public.pharmacy_branches pb ON pb.id = i.branch_id
  WHERE i.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
    AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE (NULLIF(trim(p_search), '') IS NULL OR b.search_text ILIKE '%' || trim(p_search) || '%')
    AND (p_item_type = 'all' OR b.item_type = p_item_type)
    AND (p_group_id = 'all' OR b.group_id::text = p_group_id)
    AND (p_brand_id = 'all' OR b.brand_id::text = p_brand_id)
    AND (p_manufacturer = 'all' OR COALESCE(b.manufacturer_name, '') = p_manufacturer)
    AND (p_unit = 'all' OR COALESCE(b.unit, '') = p_unit)
    AND (p_sub_unit = 'all' OR p_sub_unit = ANY(b.unit_names))
    AND (NOT p_not_for_sale OR b.not_for_sale)
    AND (p_is_controlled IS NULL OR b.is_controlled = p_is_controlled)
    AND (
      p_expiry = 'all'
      OR (p_expiry = 'none' AND b.effective_expiry IS NULL)
      OR (p_expiry = 'expired' AND b.effective_expiry < current_date)
      OR (p_expiry = 'soon' AND b.effective_expiry >= current_date AND b.effective_expiry <= current_date + 60)
      OR (p_expiry = 'valid' AND b.effective_expiry > current_date + 60)
    )
    AND (
      p_price = 'all'
      OR (p_price = 'changed' AND COALESCE(b.old_sell_price, 0) > 0 AND b.sell_price IS DISTINCT FROM b.old_sell_price)
      OR (p_price = 'has-old' AND COALESCE(b.old_sell_price, 0) > 0)
      OR (p_price = 'new-only' AND COALESCE(b.old_sell_price, 0) <= 0)
    )
    AND (
      p_stock = 'all'
      OR (p_stock = 'out' AND b.manage_inventory AND b.stock_quantity <= 0)
      OR (p_stock = 'low' AND b.manage_inventory AND b.stock_quantity > 0 AND b.stock_quantity <= COALESCE(b.min_stock, 0))
      OR (p_stock = 'available' AND b.stock_quantity > 0)
    )
), ordered AS (
  SELECT f.*,
         count(*) OVER () AS total_count,
         row_number() OVER (ORDER BY
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'name' THEN f.name_ar END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'name' THEN f.name_ar END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'group' THEN f.group_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'group' THEN f.group_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'brand' THEN f.brand_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'brand' THEN f.brand_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'stock' THEN f.stock_quantity END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'stock' THEN f.stock_quantity END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'sellPrice' THEN f.sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'sellPrice' THEN f.sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'buyPrice' THEN f.buy_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'buyPrice' THEN f.buy_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'expiry' THEN f.effective_expiry END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'expiry' THEN f.effective_expiry END DESC NULLS LAST,
           f.name_ar ASC, f.id ASC
         ) AS rn
  FROM filtered f
), paged AS (
  SELECT o.*
  FROM ordered o
  WHERE o.rn > (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 1000)
    AND o.rn <= GREATEST(p_page, 1) * LEAST(GREATEST(p_page_size, 1), 1000)
), payload AS (
  SELECT (
    to_jsonb(p) - ARRAY[
      'stock_quantity','unit_names','effective_expiry','group_name','brand_name','branch_name','total_count','rn'
    ]::text[]
    || jsonb_build_object(
      'group', CASE WHEN p.group_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.group_id, 'name', p.group_name) END,
      'brand', CASE WHEN p.brand_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.brand_id, 'name', p.brand_name) END,
      'branch', CASE WHEN p.branch_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.branch_id, 'name', p.branch_name, 'pharmacy_id', p.pharmacy_id) END,
      'barcodes', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.is_primary DESC, b.created_at)
        FROM public.pharmacy_item_barcodes b
        WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id = p.id
      ), '[]'::jsonb),
      'sub_units', COALESCE((
        SELECT jsonb_agg(to_jsonb(u) ORDER BY u.is_base DESC, u.created_at)
        FROM public.pharmacy_item_units u
        WHERE u.pharmacy_id = p_pharmacy_id AND u.item_id = p.id
      ), '[]'::jsonb),
      'batches', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.expiry_date NULLS LAST, b.created_at)
        FROM public.pharmacy_item_batches b
        WHERE b.pharmacy_id = p_pharmacy_id
          AND b.item_id = p.id
          AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
      ), '[]'::jsonb),
      'balances', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.branch_id)
        FROM public.pharmacy_stock_balances s
        WHERE s.pharmacy_id = p_pharmacy_id
          AND s.item_id = p.id
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      ), '[]'::jsonb)
    )
  ) AS item, p.rn
  FROM paged p
), totals AS (
  SELECT COALESCE(max(total_count), 0)::integer AS total FROM ordered
), summary AS (
  SELECT
    count(*) FILTER (WHERE manage_inventory AND stock_quantity > 0 AND stock_quantity <= COALESCE(min_stock, 0))::integer AS low_stock,
    count(*) FILTER (WHERE manage_inventory AND stock_quantity <= 0)::integer AS out_of_stock,
    count(*) FILTER (WHERE effective_expiry >= current_date AND effective_expiry <= current_date + 60)::integer AS expiry_soon,
    count(*) FILTER (WHERE effective_expiry < current_date)::integer AS expired
  FROM filtered
)
SELECT jsonb_build_object(
  'items', COALESCE((SELECT jsonb_agg(item ORDER BY rn) FROM payload), '[]'::jsonb),
  'itemsTotal', (SELECT total FROM totals),
  'page', GREATEST(p_page, 1),
  'pageSize', LEAST(GREATEST(p_page_size, 1), 1000),
  'totalPages', GREATEST(1, ceil((SELECT total FROM totals)::numeric / LEAST(GREATEST(p_page_size, 1), 1000))::integer),
  'summary', jsonb_build_object(
    'lowStock', COALESCE((SELECT low_stock FROM summary), 0),
    'outOfStock', COALESCE((SELECT out_of_stock FROM summary), 0),
    'expirySoon', COALESCE((SELECT expiry_soon FROM summary), 0),
    'expired', COALESCE((SELECT expired FROM summary), 0)
  )
)
$$;

GRANT EXECUTE ON FUNCTION public.pharmacy_items_catalog(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMIT;


-- ===== 20260619005000_pharmacy_specialization_and_catalog_v2.sql =====
BEGIN;

-- Pharmacy-only catalogue data. All columns are additive to preserve existing client data.
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS pharmacy_type TEXT,
  ADD COLUMN IF NOT EXISTS generic_name TEXT,
  ADD COLUMN IF NOT EXISTS active_ingredient TEXT,
  ADD COLUMN IF NOT EXISTS therapeutic_class TEXT,
  ADD COLUMN IF NOT EXISTS dosage_form TEXT,
  ADD COLUMN IF NOT EXISTS strength TEXT,
  ADD COLUMN IF NOT EXISTS package_size TEXT,
  ADD COLUMN IF NOT EXISTS route_of_administration TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_country TEXT,
  ADD COLUMN IF NOT EXISTS storage_condition TEXT;

UPDATE public.pharmacy_items
SET pharmacy_type = CASE
  WHEN NULLIF(trim(pharmacy_type), '') IS NOT NULL THEN pharmacy_type
  WHEN COALESCE(item_type, '') = 'service' THEN 'other'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مستلزم|شاش|قطن|سرنج|قسطرة|medical[[:space:]]*supply)' THEN 'medical_supply'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مكمل|فيتامين|vitamin|supplement)' THEN 'supplement'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(تجميل|بشرة|ميك[[:space:]]*اب|cosmetic|makeup)' THEN 'cosmetic'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(شامبو|معجون|غسول|عناية[[:space:]]*شخصية|personal[[:space:]]*care)' THEN 'personal_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(طفل|بيبي|حفاض|baby)' THEN 'baby_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(جهاز|ترمومتر|ميزان|نيبولايزر|device)' THEN 'device'
  ELSE 'medicine'
END
WHERE NULLIF(trim(pharmacy_type), '') IS NULL;

UPDATE public.pharmacy_items
SET pharmacy_type = 'other'
WHERE pharmacy_type NOT IN (
  'medicine', 'medical_supply', 'supplement', 'cosmetic',
  'personal_care', 'baby_care', 'device', 'other'
);

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET DEFAULT 'medicine';

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_items_pharmacy_type_check'
  ) THEN
    ALTER TABLE public.pharmacy_items
      ADD CONSTRAINT pharmacy_items_pharmacy_type_check
      CHECK (pharmacy_type IN (
        'medicine', 'medical_supply', 'supplement', 'cosmetic',
        'personal_care', 'baby_care', 'device', 'other'
      )) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_pharmacy_type
  ON public.pharmacy_items(pharmacy_id, pharmacy_type, status, name_ar, id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_active_ingredient_trgm
  ON public.pharmacy_items USING gin(active_ingredient gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_generic_name_trgm
  ON public.pharmacy_items USING gin(generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_dosage_form
  ON public.pharmacy_items(pharmacy_id, dosage_form)
  WHERE dosage_form IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_registration_number
  ON public.pharmacy_items(pharmacy_id, registration_number)
  WHERE NULLIF(trim(registration_number), '') IS NOT NULL;

-- Keep the full pharmaceutical identity searchable, including relation barcodes and units.
CREATE OR REPLACE FUNCTION public.rebuild_item_search_text(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pharmacy_items i
  SET search_text = lower(concat_ws(' ',
        i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
        i.category, i.sub_category, i.pharmacy_type, i.generic_name,
        i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
        i.package_size, i.route_of_administration, i.registration_number,
        (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
        (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
      )),
      updated_at = CASE WHEN i.updated_at IS NULL THEN now() ELSE i.updated_at END
  WHERE i.id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_item_search_from_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_text := lower(concat_ws(' ',
    NEW.name_ar, NEW.name_en, NEW.sku, NEW.manufacturer_name, NEW.manufacturer_country,
    NEW.category, NEW.sub_category, NEW.pharmacy_type, NEW.generic_name,
    NEW.active_ingredient, NEW.therapeutic_class, NEW.dosage_form, NEW.strength,
    NEW.package_size, NEW.route_of_administration, NEW.registration_number
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_from_item ON public.pharmacy_items;
CREATE TRIGGER trg_sync_item_search_from_item
BEFORE INSERT OR UPDATE OF
  name_ar, name_en, sku, manufacturer_name, manufacturer_country,
  category, sub_category, pharmacy_type, generic_name, active_ingredient,
  therapeutic_class, dosage_form, strength, package_size,
  route_of_administration, registration_number
ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_item();

UPDATE public.pharmacy_items i
SET search_text = lower(concat_ws(' ',
  i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
  i.category, i.sub_category, i.pharmacy_type, i.generic_name,
  i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
  i.package_size, i.route_of_administration, i.registration_number,
  (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
  (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
));

CREATE OR REPLACE FUNCTION public.pharmacy_item_filter_options(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active'
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'manufacturers', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.manufacturer_name) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.manufacturer_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'activeIngredients', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.active_ingredient) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.active_ingredient), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'dosageForms', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.dosage_form) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.dosage_form), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'pharmacyTypes', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.pharmacy_type) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.pharmacy_type), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.unit) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.unit), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'subUnits', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(u.unit_name) AS v
        FROM public.pharmacy_item_units u
        JOIN public.pharmacy_items i ON i.id = u.item_id AND i.pharmacy_id = u.pharmacy_id
        WHERE u.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(u.unit_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb)
  )
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_item_filter_options(UUID, UUID, TEXT)
  TO authenticated, service_role;

COMMIT;


-- ===== 20260620000000_cashier_coupon_integration.sql =====
-- Add coupon tracking to sales
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.pharmacy_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- index for reporting
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_coupon
  ON public.pharmacy_sales(coupon_id)
  WHERE coupon_id IS NOT NULL;


-- ===== 20260620001000_controlled_drugs_register.sql =====
BEGIN;

-- Define helper function for active pharmacy lookup
CREATE OR REPLACE FUNCTION public.get_user_active_pharmacy_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pharmacy_id
  FROM public.pharmacy_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY last_login_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_active_pharmacy_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_active_pharmacy_id() TO authenticated;

-- a) Add patient/doctor/prescription columns to pharmacy_sales for cashier integration
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS doctor_name TEXT,
  ADD COLUMN IF NOT EXISTS prescription_number TEXT;

-- b) RLS on pharmacy_controlled_drugs_log
ALTER TABLE public.pharmacy_controlled_drugs_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacy_controlled_drugs_log_pharmacy_isolation
  ON public.pharmacy_controlled_drugs_log
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING (pharmacy_id = public.get_user_active_pharmacy_id());

-- c) Trigger for auto-logging controlled drugs on purchase
CREATE OR REPLACE FUNCTION public.auto_log_controlled_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_controlled BOOLEAN;
  v_purchase_record public.pharmacy_purchases%ROWTYPE;
BEGIN
  SELECT is_controlled INTO v_is_controlled
  FROM public.pharmacy_items
  WHERE id = NEW.item_id AND pharmacy_id = NEW.pharmacy_id;

  IF v_is_controlled THEN
    SELECT * INTO v_purchase_record
    FROM public.pharmacy_purchases
    WHERE id = NEW.purchase_id AND pharmacy_id = NEW.pharmacy_id;

    INSERT INTO public.pharmacy_controlled_drugs_log (
      pharmacy_id, item_id, branch_id, action, quantity,
      notes, created_by, created_at
    ) VALUES (
      NEW.pharmacy_id, NEW.item_id, v_purchase_record.branch_id,
      'received', NEW.quantity,
      'شراء: ' || COALESCE(v_purchase_record.purchase_number, ''),
      NEW.created_by, now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_controlled_purchase_auto_log
  AFTER INSERT ON public.pharmacy_purchase_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_log_controlled_purchase();

-- d) Update pharmacy_items_catalog RPC to support is_controlled filter
CREATE OR REPLACE FUNCTION public.pharmacy_items_catalog(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active',
  p_search TEXT DEFAULT '',
  p_item_type TEXT DEFAULT 'all',
  p_group_id TEXT DEFAULT 'all',
  p_brand_id TEXT DEFAULT 'all',
  p_manufacturer TEXT DEFAULT 'all',
  p_unit TEXT DEFAULT 'all',
  p_sub_unit TEXT DEFAULT 'all',
  p_expiry TEXT DEFAULT 'all',
  p_price TEXT DEFAULT 'all',
  p_stock TEXT DEFAULT 'all',
  p_not_for_sale BOOLEAN DEFAULT false,
  p_is_controlled BOOLEAN DEFAULT NULL,
  p_sort_key TEXT DEFAULT 'name',
  p_sort_dir TEXT DEFAULT 'asc',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH stock_summary AS (
  SELECT s.item_id, sum(s.quantity)::numeric AS quantity
  FROM public.pharmacy_stock_balances s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.item_id
), batch_summary AS (
  SELECT b.item_id,
         min(b.expiry_date) FILTER (WHERE COALESCE(b.remaining_quantity, b.quantity, 0) > 0) AS nearest_expiry
  FROM public.pharmacy_item_batches b
  WHERE b.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
  GROUP BY b.item_id
), unit_names AS (
  SELECT u.item_id, array_agg(DISTINCT u.unit_name) AS names
  FROM public.pharmacy_item_units u
  WHERE u.pharmacy_id = p_pharmacy_id
  GROUP BY u.item_id
), base AS (
  SELECT i.*,
         COALESCE(s.quantity, 0) AS stock_quantity,
         COALESCE(u.names, ARRAY[]::text[]) AS unit_names,
         COALESCE(i.expiry_date, bt.nearest_expiry) AS effective_expiry,
         g.name AS group_name,
         br.name AS brand_name,
         pb.name AS branch_name
  FROM public.pharmacy_items i
  LEFT JOIN stock_summary s ON s.item_id = i.id
  LEFT JOIN batch_summary bt ON bt.item_id = i.id
  LEFT JOIN unit_names u ON u.item_id = i.id
  LEFT JOIN public.pharmacy_item_groups g ON g.id = i.group_id
  LEFT JOIN public.pharmacy_item_brands br ON br.id = i.brand_id
  LEFT JOIN public.pharmacy_branches pb ON pb.id = i.branch_id
  WHERE i.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
    AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE (NULLIF(trim(p_search), '') IS NULL OR b.search_text ILIKE '%' || trim(p_search) || '%')
    AND (p_item_type = 'all' OR b.item_type = p_item_type)
    AND (p_group_id = 'all' OR b.group_id::text = p_group_id)
    AND (p_brand_id = 'all' OR b.brand_id::text = p_brand_id)
    AND (p_manufacturer = 'all' OR COALESCE(b.manufacturer_name, '') = p_manufacturer)
    AND (p_unit = 'all' OR COALESCE(b.unit, '') = p_unit)
    AND (p_sub_unit = 'all' OR p_sub_unit = ANY(b.unit_names))
    AND (NOT p_not_for_sale OR b.not_for_sale)
    AND (p_is_controlled IS NULL OR b.is_controlled = p_is_controlled)
    AND (
      p_expiry = 'all'
      OR (p_expiry = 'none' AND b.effective_expiry IS NULL)
      OR (p_expiry = 'expired' AND b.effective_expiry < current_date)
      OR (p_expiry = 'soon' AND b.effective_expiry >= current_date AND b.effective_expiry <= current_date + 60)
      OR (p_expiry = 'valid' AND b.effective_expiry > current_date + 60)
    )
    AND (
      p_price = 'all'
      OR (p_price = 'changed' AND COALESCE(b.old_sell_price, 0) > 0 AND b.sell_price IS DISTINCT FROM b.old_sell_price)
      OR (p_price = 'has-old' AND COALESCE(b.old_sell_price, 0) > 0)
      OR (p_price = 'new-only' AND COALESCE(b.old_sell_price, 0) <= 0)
    )
    AND (
      p_stock = 'all'
      OR (p_stock = 'out' AND b.manage_inventory AND b.stock_quantity <= 0)
      OR (p_stock = 'low' AND b.manage_inventory AND b.stock_quantity > 0 AND b.stock_quantity <= COALESCE(b.min_stock, 0))
      OR (p_stock = 'available' AND b.stock_quantity > 0)
    )
), ordered AS (
  SELECT f.*,
         count(*) OVER () AS total_count,
         row_number() OVER (ORDER BY
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'name' THEN f.name_ar END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'name' THEN f.name_ar END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'group' THEN f.group_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'group' THEN f.group_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'brand' THEN f.brand_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'brand' THEN f.brand_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'stock' THEN f.stock_quantity END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'stock' THEN f.stock_quantity END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'sellPrice' THEN f.sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'sellPrice' THEN f.sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'buyPrice' THEN f.buy_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'buyPrice' THEN f.buy_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'expiry' THEN f.effective_expiry END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'expiry' THEN f.effective_expiry END DESC NULLS LAST,
           f.name_ar ASC, f.id ASC
         ) AS rn
  FROM filtered f
), paged AS (
  SELECT o.*
  FROM ordered o
  WHERE o.rn > (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 1000)
    AND o.rn <= GREATEST(p_page, 1) * LEAST(GREATEST(p_page_size, 1), 1000)
), payload AS (
  SELECT (
    to_jsonb(p) - ARRAY[
      'stock_quantity','unit_names','effective_expiry','group_name','brand_name','branch_name','total_count','rn'
    ]::text[]
    || jsonb_build_object(
      'group', CASE WHEN p.group_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.group_id, 'name', p.group_name) END,
      'brand', CASE WHEN p.brand_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.brand_id, 'name', p.brand_name) END,
      'branch', CASE WHEN p.branch_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.branch_id, 'name', p.branch_name, 'pharmacy_id', p.pharmacy_id) END,
      'barcodes', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.is_primary DESC, b.created_at)
        FROM public.pharmacy_item_barcodes b
        WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id = p.id
      ), '[]'::jsonb),
      'sub_units', COALESCE((
        SELECT jsonb_agg(to_jsonb(u) ORDER BY u.is_base DESC, u.created_at)
        FROM public.pharmacy_item_units u
        WHERE u.pharmacy_id = p_pharmacy_id AND u.item_id = p.id
      ), '[]'::jsonb),
      'batches', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.expiry_date NULLS LAST, b.created_at)
        FROM public.pharmacy_item_batches b
        WHERE b.pharmacy_id = p_pharmacy_id
          AND b.item_id = p.id
          AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
      ), '[]'::jsonb),
      'balances', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.branch_id)
        FROM public.pharmacy_stock_balances s
        WHERE s.pharmacy_id = p_pharmacy_id
          AND s.item_id = p.id
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      ), '[]'::jsonb)
    )
  ) AS item, p.rn
  FROM paged p
), totals AS (
  SELECT COALESCE(max(total_count), 0)::integer AS total FROM ordered
), summary AS (
  SELECT
    count(*) FILTER (WHERE manage_inventory AND stock_quantity > 0 AND stock_quantity <= COALESCE(min_stock, 0))::integer AS low_stock,
    count(*) FILTER (WHERE manage_inventory AND stock_quantity <= 0)::integer AS out_of_stock,
    count(*) FILTER (WHERE effective_expiry >= current_date AND effective_expiry <= current_date + 60)::integer AS expiry_soon,
    count(*) FILTER (WHERE effective_expiry < current_date)::integer AS expired
  FROM filtered
)
SELECT jsonb_build_object(
  'items', COALESCE((SELECT jsonb_agg(item ORDER BY rn) FROM payload), '[]'::jsonb),
  'itemsTotal', (SELECT total FROM totals),
  'page', GREATEST(p_page, 1),
  'pageSize', LEAST(GREATEST(p_page_size, 1), 1000),
  'totalPages', GREATEST(1, ceil((SELECT total FROM totals)::numeric / LEAST(GREATEST(p_page_size, 1), 1000))::integer),
  'summary', jsonb_build_object(
    'lowStock', COALESCE((SELECT low_stock FROM summary), 0),
    'outOfStock', COALESCE((SELECT out_of_stock FROM summary), 0),
    'expirySoon', COALESCE((SELECT expiry_soon FROM summary), 0),
    'expired', COALESCE((SELECT expired FROM summary), 0)
  )
)
$$;

GRANT EXECUTE ON FUNCTION public.pharmacy_items_catalog(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMIT;


-- ===== 20260620002000_developer_control_plane.sql =====
BEGIN;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS developer_notes TEXT;

ALTER TABLE public.pharmacies
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

UPDATE public.pharmacies
SET trial_ends_at = created_at + interval '14 days'
WHERE plan = 'trial' AND trial_ends_at IS NULL;

ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_plan_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_plan_check
  CHECK (plan IN ('trial', 'starter', 'professional', 'enterprise'));

ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_limits_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_limits_check
  CHECK (max_branches > 0 AND max_users > 0);

CREATE INDEX IF NOT EXISTS idx_pharmacies_platform_lifecycle
  ON public.pharmacies(status, plan, subscription_ends_at, trial_ends_at);

COMMIT;


-- ===== 20260620003000_report_performance_aggregations.sql =====
-- ===================================================================
-- Report performance aggregations
-- Server-side aggregation functions to speed up reports
-- ===================================================================

-- 1. Daily sales summary aggregation
CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  sale_date DATE,
  invoice_count BIGINT,
  total_sales NUMERIC,
  total_discounts NUMERIC,
  total_tax NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  credit_sales NUMERIC,
  item_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sale_date::DATE,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_sales,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    COALESCE(SUM(s.tax_total), 0) AS total_tax,
    COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
    COALESCE(SUM(s.total - (sl.purchase_price * sl.quantity)), 0) AS total_profit,
    COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.paid_amount ELSE 0 END), 0) AS cash_sales,
    COALESCE(SUM(CASE WHEN s.payment_method IN ('card', 'wallet', 'mixed') THEN s.paid_amount ELSE 0 END), 0) AS card_sales,
    COALESCE(SUM(CASE WHEN s.payment_method = 'credit' THEN s.total ELSE 0 END), 0) AS credit_sales,
    COALESCE(SUM(sl.quantity), 0)::BIGINT AS item_count
  FROM public.pharmacy_sales s
  LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.sale_date::DATE
  ORDER BY s.sale_date::DATE DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 2. Top selling items
CREATE OR REPLACE FUNCTION public.get_top_selling_items(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 20,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  total_quantity NUMERIC,
  total_sales NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sl.item_id,
    COALESCE(i.name_ar, sl.item_name, '') AS item_name,
    i.sku,
    SUM(sl.quantity) AS total_quantity,
    SUM(sl.net_total) AS total_sales,
    SUM(sl.purchase_price * sl.quantity) AS total_cost,
    SUM(sl.net_total - (sl.purchase_price * sl.quantity)) AS total_profit,
    COUNT(DISTINCT s.id)::BIGINT AS sale_count
  FROM public.pharmacy_sale_lines sl
  JOIN public.pharmacy_sales s ON s.id = sl.sale_id AND s.pharmacy_id = sl.pharmacy_id
  LEFT JOIN public.pharmacy_items i ON i.id = sl.item_id AND i.pharmacy_id = sl.pharmacy_id
  WHERE sl.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY sl.item_id, i.name_ar, i.sku
  ORDER BY total_sales DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) TO authenticated;

-- 3. Profit & loss summary
CREATE OR REPLACE FUNCTION public.get_profit_loss_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  period_label TEXT,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  gross_profit NUMERIC,
  gross_margin_percent NUMERIC,
  total_discounts NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
BEGIN
  v_period := to_char(p_from_date, 'YYYY-MM') || ' to ' || to_char(p_to_date, 'YYYY-MM');

  RETURN QUERY
  WITH sales_data AS (
    SELECT
      COALESCE(SUM(s.total), 0) AS total_revenue,
      COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
      COALESCE(SUM(s.discount_total), 0) AS total_discounts,
      COUNT(DISTINCT s.id)::BIGINT AS invoice_count
    FROM public.pharmacy_sales s
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status NOT IN ('void', 'cancelled')
      AND s.sale_date::DATE >= p_from_date
      AND s.sale_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  ),
  expense_data AS (
    SELECT COALESCE(SUM(amount), 0) AS total_expenses
    FROM public.pharmacy_financial_movements
    WHERE pharmacy_id = p_pharmacy_id
      AND direction = 'out'
      AND category = 'expense'
      AND movement_date::DATE >= p_from_date
      AND movement_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  )
  SELECT
    v_period AS period_label,
    sales_data.total_revenue,
    sales_data.total_cost,
    GREATEST(sales_data.total_revenue - sales_data.total_cost, 0) AS gross_profit,
    CASE WHEN sales_data.total_revenue > 0
      THEN ROUND((sales_data.total_revenue - sales_data.total_cost) / sales_data.total_revenue * 100, 2)
      ELSE 0
    END AS gross_margin_percent,
    sales_data.total_discounts,
    expense_data.total_expenses,
    GREATEST(sales_data.total_revenue - sales_data.total_cost - sales_data.total_discounts - expense_data.total_expenses, 0) AS net_profit,
    sales_data.invoice_count
  FROM sales_data, expense_data;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 4. Customer activity summary
CREATE OR REPLACE FUNCTION public.get_customer_activity_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  customer_name TEXT,
  invoice_count BIGINT,
  total_spent NUMERIC,
  total_discounts NUMERIC,
  last_visit_date TIMESTAMPTZ,
  average_invoice NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.customer_name,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_spent,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    MAX(s.sale_date) AS last_visit_date,
    ROUND(COALESCE(SUM(s.total), 0) / NULLIF(COUNT(DISTINCT s.id), 0), 2) AS average_invoice
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.customer_name IS NOT NULL
  GROUP BY s.customer_name
  ORDER BY total_spent DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 5. Tax summary
CREATE OR REPLACE FUNCTION public.get_tax_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tax_period TEXT,
  taxable_sales NUMERIC,
  tax_collected NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(s.sale_date::DATE, 'YYYY-MM') AS tax_period,
    COALESCE(SUM(s.subtotal - s.discount_total), 0) AS taxable_sales,
    COALESCE(SUM(s.tax_total), 0) AS tax_collected,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.tax_total > 0
  GROUP BY to_char(s.sale_date::DATE, 'YYYY-MM')
  ORDER BY tax_period DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) TO authenticated;


-- ===== 20260620004000_performance_indexes_and_constraints.sql =====
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


