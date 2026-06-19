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
