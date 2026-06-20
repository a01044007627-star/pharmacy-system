BEGIN;

-- ============================================================================
-- DOMAIN UNITS: categorized units, quantity precision and integer enforcement
-- ============================================================================

ALTER TABLE public.pharmacy_units
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS quantity_mode TEXT NOT NULL DEFAULT 'discrete',
  ADD COLUMN IF NOT EXISTS quantity_scale SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_fraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1000;

UPDATE public.pharmacy_units
SET
  category = CASE
    WHEN lower(trim(unit_name)) IN ('علبة','علبه','عبوة','عبوه','كرتونة','كرتونه','شريط','زجاجة','زجاجه','أنبوبة','انبوبه','كيس') THEN 'package'
    WHEN lower(trim(unit_name)) IN ('قرص','حباية','حبايه','كبسولة','كبسوله','أمبول','امبول','فيال','حقنة','حقنه','سرنجة','سرنجه','لبوس','لبوسة','لبوسه','لاصقة','لاصقه','نقطة','نقطه','جرعة','جرعه','قطعة','قطعه','وحدة','وحده') THEN 'dosage'
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
    WHEN lower(trim(unit_name)) IN ('ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 'mass'
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
    WHEN lower(trim(unit_name)) IN ('خدمة','خدمه') THEN 'service'
    ELSE COALESCE(NULLIF(category,''),'other')
  END,
  quantity_mode = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN 'continuous'
    ELSE 'discrete'
  END,
  quantity_scale = CASE
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 2
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 3
    ELSE 0
  END,
  allows_fraction = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN true
    ELSE false
  END,
  updated_at = now();

ALTER TABLE public.pharmacy_units
  DROP CONSTRAINT IF EXISTS pharmacy_units_category_check,
  ADD CONSTRAINT pharmacy_units_category_check
    CHECK (category IN ('package','dosage','volume','mass','length','service','other')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_quantity_mode_check,
  ADD CONSTRAINT pharmacy_units_quantity_mode_check
    CHECK (quantity_mode IN ('discrete','continuous')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_quantity_scale_check,
  ADD CONSTRAINT pharmacy_units_quantity_scale_check
    CHECK (quantity_scale BETWEEN 0 AND 6) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_fraction_policy_check,
  ADD CONSTRAINT pharmacy_units_fraction_policy_check
    CHECK (
      (quantity_mode = 'discrete' AND quantity_scale = 0 AND allows_fraction = false)
      OR
      (quantity_mode = 'continuous' AND quantity_scale BETWEEN 0 AND 6 AND allows_fraction = (quantity_scale > 0))
    ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_units_code
  ON public.pharmacy_units(pharmacy_id, upper(code))
  WHERE code IS NOT NULL AND trim(code) <> '';

CREATE INDEX IF NOT EXISTS idx_pharmacy_units_category_active
  ON public.pharmacy_units(pharmacy_id, category, is_active, sort_order, unit_name);

ALTER TABLE public.pharmacy_item_units
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.pharmacy_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS quantity_mode TEXT NOT NULL DEFAULT 'discrete',
  ADD COLUMN IF NOT EXISTS quantity_scale SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_fraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sale_enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE public.pharmacy_item_units item_unit
SET unit_id = unit.id,
    unit_code = COALESCE(item_unit.unit_code, unit.code),
    category = COALESCE(NULLIF(unit.category,''), 'other'),
    quantity_mode = COALESCE(NULLIF(unit.quantity_mode,''), 'discrete'),
    quantity_scale = COALESCE(unit.quantity_scale, 0),
    allows_fraction = COALESCE(unit.allows_fraction, false)
FROM public.pharmacy_units unit
WHERE unit.pharmacy_id = item_unit.pharmacy_id
  AND lower(trim(unit.unit_name)) = lower(trim(item_unit.unit_name));

UPDATE public.pharmacy_item_units
SET
  category = CASE
    WHEN lower(trim(unit_name)) IN ('علبة','علبه','عبوة','عبوه','كرتونة','كرتونه','شريط','زجاجة','زجاجه','أنبوبة','انبوبه','كيس') THEN 'package'
    WHEN lower(trim(unit_name)) IN ('قرص','حباية','حبايه','كبسولة','كبسوله','أمبول','امبول','فيال','حقنة','حقنه','سرنجة','سرنجه','لبوس','لبوسة','لبوسه','لاصقة','لاصقه','نقطة','نقطه','جرعة','جرعه','قطعة','قطعه','وحدة','وحده') THEN 'dosage'
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
    WHEN lower(trim(unit_name)) IN ('ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 'mass'
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
    ELSE COALESCE(NULLIF(category,''),'other')
  END,
  quantity_mode = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN 'continuous'
    ELSE 'discrete'
  END,
  quantity_scale = CASE
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 2
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 3
    ELSE 0
  END,
  allows_fraction = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN true
    ELSE false
  END,
  factor = CASE WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN factor ELSE GREATEST(round(factor),1) END,
  qty_per_main_unit = CASE WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN COALESCE(qty_per_main_unit,factor,1) ELSE GREATEST(round(COALESCE(qty_per_main_unit,factor,1)),1) END,
  updated_at = now();

ALTER TABLE public.pharmacy_item_units
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_category_check,
  ADD CONSTRAINT pharmacy_item_units_category_check
    CHECK (category IN ('package','dosage','volume','mass','length','service','other')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_quantity_mode_check,
  ADD CONSTRAINT pharmacy_item_units_quantity_mode_check
    CHECK (quantity_mode IN ('discrete','continuous')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_quantity_scale_check,
  ADD CONSTRAINT pharmacy_item_units_quantity_scale_check
    CHECK (quantity_scale BETWEEN 0 AND 6) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_fraction_policy_check,
  ADD CONSTRAINT pharmacy_item_units_fraction_policy_check
    CHECK (
      (quantity_mode = 'discrete' AND quantity_scale = 0 AND allows_fraction = false AND factor = trunc(factor) AND COALESCE(qty_per_main_unit,1) = trunc(COALESCE(qty_per_main_unit,1)))
      OR
      (quantity_mode = 'continuous' AND quantity_scale BETWEEN 0 AND 6 AND allows_fraction = (quantity_scale > 0))
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_item_units_unit_policy
  ON public.pharmacy_item_units(pharmacy_id, item_id, quantity_mode, sale_enabled, purchase_enabled);

CREATE OR REPLACE FUNCTION public.apply_unit_domain_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_unit public.pharmacy_units%ROWTYPE;
BEGIN
  NEW.unit_name := trim(NEW.unit_name);
  IF NEW.unit_name = '' THEN RAISE EXCEPTION 'unit_name_required'; END IF;

  IF TG_TABLE_NAME = 'pharmacy_units' THEN
    NEW.code := NULLIF(upper(trim(NEW.code)), '');
    NEW.category := COALESCE(NULLIF(NEW.category,''),'other');
    NEW.quantity_mode := COALESCE(NULLIF(NEW.quantity_mode,''),'discrete');
    IF NEW.quantity_mode = 'discrete' THEN
      NEW.quantity_scale := 0;
      NEW.allows_fraction := false;
    ELSE
      NEW.quantity_scale := LEAST(GREATEST(COALESCE(NEW.quantity_scale,3),0),6);
      NEW.allows_fraction := NEW.quantity_scale > 0;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM public.pharmacy_units
    WHERE id = NEW.unit_id AND pharmacy_id = NEW.pharmacy_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_in_pharmacy'; END IF;
  ELSE
    SELECT * INTO v_unit
    FROM public.pharmacy_units
    WHERE pharmacy_id = NEW.pharmacy_id
      AND lower(trim(unit_name)) = lower(trim(NEW.unit_name))
    ORDER BY is_active DESC, created_at
    LIMIT 1;
    IF FOUND THEN NEW.unit_id := v_unit.id; END IF;
  END IF;

  IF FOUND THEN
    NEW.unit_name := v_unit.unit_name;
    NEW.unit_code := COALESCE(NEW.unit_code,v_unit.code);
    NEW.category := v_unit.category;
    NEW.quantity_mode := v_unit.quantity_mode;
    NEW.quantity_scale := v_unit.quantity_scale;
    NEW.allows_fraction := v_unit.allows_fraction;
  ELSIF lower(trim(NEW.unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN
    NEW.category := CASE
      WHEN lower(trim(NEW.unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
      WHEN lower(trim(NEW.unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
      ELSE 'mass'
    END;
    NEW.quantity_mode := 'continuous';
    NEW.quantity_scale := CASE WHEN NEW.category = 'length' THEN 2 ELSE 3 END;
    NEW.allows_fraction := true;
  END IF;

  NEW.category := COALESCE(NULLIF(NEW.category,''),'other');
  NEW.quantity_mode := COALESCE(NULLIF(NEW.quantity_mode,''),'discrete');
  IF NEW.quantity_mode = 'discrete' THEN
    NEW.quantity_scale := 0;
    NEW.allows_fraction := false;
    IF NEW.factor <> trunc(NEW.factor) OR COALESCE(NEW.qty_per_main_unit,1) <> trunc(COALESCE(NEW.qty_per_main_unit,1)) THEN
      RAISE EXCEPTION 'discrete_unit_requires_integer_factor';
    END IF;
  ELSE
    NEW.quantity_scale := LEAST(GREATEST(COALESCE(NEW.quantity_scale,3),0),6);
    NEW.allows_fraction := NEW.quantity_scale > 0;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharmacy_units_domain_policy ON public.pharmacy_units;
CREATE TRIGGER trg_pharmacy_units_domain_policy
BEFORE INSERT OR UPDATE ON public.pharmacy_units
FOR EACH ROW EXECUTE FUNCTION public.apply_unit_domain_policy();

DROP TRIGGER IF EXISTS trg_item_units_domain_policy ON public.pharmacy_item_units;
CREATE TRIGGER trg_item_units_domain_policy
BEFORE INSERT OR UPDATE ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.apply_unit_domain_policy();

-- ============================================================================
-- DELIVERY LIFECYCLE: assignment, timestamps, proof and collection
-- ============================================================================

ALTER TABLE public.pharmacy_orders
  ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES public.pharmacy_employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_agent_name TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_url TEXT,
  ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.pharmacy_orders
  DROP CONSTRAINT IF EXISTS pharmacy_orders_collected_amount_check,
  ADD CONSTRAINT pharmacy_orders_collected_amount_check
    CHECK (collected_amount >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_assignment
  ON public.pharmacy_orders(pharmacy_id, assigned_employee_id, status, created_at DESC);

-- ============================================================================
-- DATABASE STATE MACHINES: protect operational workflows from invalid jumps
-- ============================================================================

-- Normalize legacy aliases before strict workflow guards are installed.
UPDATE public.pharmacy_stock_counts
SET status = CASE
  WHEN status IN ('matched','variance') THEN 'posted'
  WHEN status = 'void' THEN 'cancelled'
  ELSE status
END,
updated_at = now()
WHERE status IN ('matched','variance','void');

UPDATE public.pharmacy_purchase_orders
SET status = CASE
  WHEN status IN ('pending','approved') THEN 'sent'
  WHEN status = 'ordered' THEN 'partial'
  ELSE status
END,
updated_at = now()
WHERE status IN ('pending','approved','ordered');


CREATE OR REPLACE FUNCTION public.enforce_operational_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'pharmacy_purchase_orders' THEN
    v_allowed := CASE OLD.status
      WHEN 'draft' THEN NEW.status IN ('sent','cancelled')
      WHEN 'sent' THEN NEW.status IN ('partial','received','cancelled')
      WHEN 'partial' THEN NEW.status IN ('received','cancelled')
      ELSE false
    END;
  ELSIF TG_TABLE_NAME = 'pharmacy_orders' THEN
    v_allowed := CASE OLD.status
      WHEN 'pending' THEN NEW.status IN ('confirmed','cancelled')
      WHEN 'confirmed' THEN NEW.status IN ('preparing','cancelled')
      WHEN 'preparing' THEN NEW.status IN ('shipped','cancelled')
      WHEN 'shipped' THEN NEW.status IN ('delivered','returned')
      WHEN 'delivered' THEN NEW.status IN ('returned')
      ELSE false
    END;
    IF NEW.status = 'shipped' AND NEW.dispatched_at IS NULL THEN NEW.dispatched_at := now(); END IF;
    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN NEW.delivered_at := now(); END IF;
    IF NEW.status = 'returned' AND NEW.returned_at IS NULL THEN NEW.returned_at := now(); END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  ELSIF TG_TABLE_NAME = 'pharmacy_stock_counts' THEN
    v_allowed := CASE OLD.status
      WHEN 'draft' THEN NEW.status IN ('posted','cancelled')
      WHEN 'posted' THEN NEW.status IN ('approved','cancelled')
      ELSE false
    END;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid_status_transition:%:%:%', TG_TABLE_NAME, OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_order_status_transition ON public.pharmacy_purchase_orders;
CREATE TRIGGER trg_purchase_order_status_transition
BEFORE UPDATE OF status ON public.pharmacy_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

DROP TRIGGER IF EXISTS trg_delivery_status_transition ON public.pharmacy_orders;
CREATE TRIGGER trg_delivery_status_transition
BEFORE UPDATE OF status ON public.pharmacy_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

DROP TRIGGER IF EXISTS trg_stock_count_status_transition ON public.pharmacy_stock_counts;
CREATE TRIGGER trg_stock_count_status_transition
BEFORE UPDATE OF status ON public.pharmacy_stock_counts
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

NOTIFY pgrst, 'reload schema';
COMMIT;
