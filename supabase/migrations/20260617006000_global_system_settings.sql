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
