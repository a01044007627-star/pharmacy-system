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
