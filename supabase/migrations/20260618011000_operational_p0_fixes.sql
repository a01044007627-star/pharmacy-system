-- P0 operational fixes for real cashier/inventory delivery.
-- 1) Missing production tables used by the UI/API.
-- 2) Opening stock must be reflected in real stock balances/movements.
-- 3) Prevent more than one open cashier shift for the same user/branch.

CREATE TABLE IF NOT EXISTS public.pharmacy_price_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  discount_percent NUMERIC(7,3) DEFAULT 0 NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  markup_percent NUMERIC(7,3) DEFAULT 0 NOT NULL CHECK (markup_percent >= 0 AND markup_percent <= 1000),
  is_default BOOLEAN DEFAULT false NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL CHECK (status IN ('active','inactive')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, name),
  UNIQUE(pharmacy_id, code)
);

CREATE TABLE IF NOT EXISTS public.pharmacy_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.pharmacy_sales(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL DEFAULT 'مريض',
  doctor_name TEXT,
  diagnosis TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'open' NOT NULL CHECK (status IN ('open','dispensed','cancelled','archived')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispensed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_price_groups_pharmacy
  ON public.pharmacy_price_groups(pharmacy_id, status, name);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_pharmacy
  ON public.pharmacy_prescriptions(pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacy_prescriptions_patient
  ON public.pharmacy_prescriptions(pharmacy_id, patient_name);

WITH duplicated_open_shifts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pharmacy_id, branch_id, user_id
      ORDER BY opened_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.pharmacy_shifts
  WHERE status = 'open'
)
UPDATE public.pharmacy_shifts shift
SET status = 'closed',
    closed_at = COALESCE(shift.closed_at, now()),
    closing_balance = COALESCE(shift.closing_balance, shift.expected_balance, shift.opening_balance, 0),
    difference = COALESCE(shift.difference, 0),
    notes = concat_ws(' | ', NULLIF(shift.notes, ''), 'تم إغلاق وردية مكررة تلقائيًا قبل قفل تعارض الورديات'),
    updated_at = now()
FROM duplicated_open_shifts ranked
WHERE ranked.id = shift.id
  AND ranked.rn > 1;

DROP INDEX IF EXISTS public.idx_pharmacy_shifts_one_open_per_cashier_branch;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_shifts_one_open_per_cashier_branch
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id)
  WHERE status = 'open';

-- Backfill opening_stock into the real stock tables for old items that were created before this fix.
WITH default_branch AS (
  SELECT DISTINCT ON (pharmacy_id) pharmacy_id, id AS branch_id
  FROM public.pharmacy_branches
  WHERE status <> 'closed'
  ORDER BY pharmacy_id, is_default DESC, created_at ASC
), opening_items AS (
  SELECT
    item.id AS item_id,
    item.pharmacy_id,
    COALESCE(item.branch_id, default_branch.branch_id) AS branch_id,
    item.opening_stock AS quantity,
    item.buy_price,
    item.unit
  FROM public.pharmacy_items item
  JOIN default_branch ON default_branch.pharmacy_id = item.pharmacy_id
  WHERE COALESCE(item.opening_stock, 0) > 0
    AND COALESCE(item.manage_inventory, true) = true
)
INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
SELECT pharmacy_id, item_id, branch_id, quantity, now()
FROM opening_items
WHERE branch_id IS NOT NULL
ON CONFLICT (pharmacy_id, item_id, branch_id) DO NOTHING;

WITH default_branch AS (
  SELECT DISTINCT ON (pharmacy_id) pharmacy_id, id AS branch_id
  FROM public.pharmacy_branches
  WHERE status <> 'closed'
  ORDER BY pharmacy_id, is_default DESC, created_at ASC
), opening_items AS (
  SELECT
    item.id AS item_id,
    item.pharmacy_id,
    COALESCE(item.branch_id, default_branch.branch_id) AS branch_id,
    item.opening_stock AS quantity,
    item.buy_price
  FROM public.pharmacy_items item
  JOIN default_branch ON default_branch.pharmacy_id = item.pharmacy_id
  WHERE COALESCE(item.opening_stock, 0) > 0
    AND COALESCE(item.manage_inventory, true) = true
)
INSERT INTO public.pharmacy_stock_movements (
  pharmacy_id, item_id, branch_id, direction, quantity,
  unit_price, total_value, movement_type, source_table, source_id, created_at
)
SELECT
  opening_items.pharmacy_id,
  opening_items.item_id,
  opening_items.branch_id,
  'in',
  opening_items.quantity,
  COALESCE(opening_items.buy_price, 0),
  ROUND(opening_items.quantity * COALESCE(opening_items.buy_price, 0), 2),
  'opening_stock',
  'pharmacy_items',
  opening_items.item_id,
  now()
FROM opening_items
WHERE opening_items.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_stock_movements movement
    WHERE movement.pharmacy_id = opening_items.pharmacy_id
      AND movement.item_id = opening_items.item_id
      AND movement.source_table = 'pharmacy_items'
      AND movement.source_id = opening_items.item_id
      AND movement.movement_type = 'opening_stock'
  );

ALTER TABLE public.pharmacy_price_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_price_groups_read ON public.pharmacy_price_groups;
CREATE POLICY pharmacy_price_groups_read ON public.pharmacy_price_groups
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:read', auth.uid()));

DROP POLICY IF EXISTS pharmacy_price_groups_write ON public.pharmacy_price_groups;
CREATE POLICY pharmacy_price_groups_write ON public.pharmacy_price_groups
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()));

DROP POLICY IF EXISTS pharmacy_prescriptions_read ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_read ON public.pharmacy_prescriptions
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()));

DROP POLICY IF EXISTS pharmacy_prescriptions_write ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_write ON public.pharmacy_prescriptions
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid()));
