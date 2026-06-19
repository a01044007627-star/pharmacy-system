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
