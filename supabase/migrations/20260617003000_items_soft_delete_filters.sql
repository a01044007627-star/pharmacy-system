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
