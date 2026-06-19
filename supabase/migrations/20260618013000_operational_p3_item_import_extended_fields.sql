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
