BEGIN;

ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_created_by
  ON public.pharmacy_items(created_by);

COMMIT;
