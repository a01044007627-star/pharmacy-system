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
