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
  ADD COLUMN IF NOT EXISTS import_metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS import_request_id TEXT;

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
  client_request_id TEXT,
  batch_allocations JSONB NOT NULL DEFAULT '[]'::JSONB,
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
  client_request_id TEXT,
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
  sale_line_id UUID REFERENCES pharmacy_sale_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  unit TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  client_request_id TEXT,
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
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  item_name TEXT,
  unit TEXT,
  batch_number TEXT,
  expiry_date DATE,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  sell_price NUMERIC(14,2) DEFAULT 0 NOT NULL,
  discount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  net_total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  client_request_id TEXT,
  supplier_id UUID REFERENCES pharmacy_partners(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT 'مورد نقدي' NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  stock_mode TEXT,
  reason TEXT,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
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
  purchase_line_id UUID REFERENCES pharmacy_purchase_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES pharmacy_item_batches(id) ON DELETE SET NULL,
  unit TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  buy_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
