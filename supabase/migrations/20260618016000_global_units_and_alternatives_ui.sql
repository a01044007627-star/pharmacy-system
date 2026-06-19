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
