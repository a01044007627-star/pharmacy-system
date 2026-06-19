-- P4 operational closure: item unit equations + supplier views safety.

ALTER TABLE public.pharmacy_item_units
  ADD COLUMN IF NOT EXISTS main_unit TEXT,
  ADD COLUMN IF NOT EXISTS sub_unit TEXT,
  ADD COLUMN IF NOT EXISTS qty_per_main_unit NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS unit_raw TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.pharmacy_item_units
SET
  main_unit = COALESCE(main_unit, CASE WHEN is_base THEN unit_name ELSE unit_name END),
  sub_unit = COALESCE(sub_unit, unit_name),
  qty_per_main_unit = COALESCE(qty_per_main_unit, factor, 1),
  unit_raw = COALESCE(unit_raw, unit_name),
  updated_at = COALESCE(updated_at, now())
WHERE main_unit IS NULL
   OR sub_unit IS NULL
   OR qty_per_main_unit IS NULL
   OR unit_raw IS NULL;

CREATE INDEX IF NOT EXISTS idx_item_units_item_equation
  ON public.pharmacy_item_units(pharmacy_id, item_id, is_base, factor);

CREATE INDEX IF NOT EXISTS idx_partners_supplier_lookup
  ON public.pharmacy_partners(pharmacy_id, type, status, name);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_lookup
  ON public.pharmacy_purchases(pharmacy_id, supplier_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_partner_lookup
  ON public.pharmacy_payments(pharmacy_id, partner_id, payment_date DESC);
