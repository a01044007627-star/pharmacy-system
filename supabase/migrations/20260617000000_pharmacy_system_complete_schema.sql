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
