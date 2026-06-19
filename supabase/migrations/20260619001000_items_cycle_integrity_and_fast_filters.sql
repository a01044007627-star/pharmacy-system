-- Complete item-cycle integrity, audit and fast server-side filters.
-- This migration is additive and preserves legacy data before resolving conflicts.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_item_barcode(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(
    regexp_replace(
      translate(trim(COALESCE(p_value, '')), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '[[:space:]-]+', '', 'g'
    ), chr(8206), ''), chr(8207), '')
$$;

CREATE TABLE IF NOT EXISTS public.pharmacy_item_barcode_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.pharmacy_items(id) ON DELETE SET NULL,
  source_table TEXT NOT NULL,
  source_id UUID,
  barcode TEXT NOT NULL,
  normalized_barcode TEXT NOT NULL,
  conflict_with_item_id UUID REFERENCES public.pharmacy_items(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_barcode_conflicts_scope
  ON public.pharmacy_item_barcode_conflicts(pharmacy_id, created_at DESC);

-- Archive then remove duplicate main barcode rows created by legacy formatting differences.
WITH ranked AS (
  SELECT b.*,
         row_number() OVER (
           PARTITION BY b.pharmacy_id, public.normalize_item_barcode(b.barcode)
           ORDER BY b.is_primary DESC, b.created_at, b.id
         ) AS rn,
         first_value(b.item_id) OVER (
           PARTITION BY b.pharmacy_id, public.normalize_item_barcode(b.barcode)
           ORDER BY b.is_primary DESC, b.created_at, b.id
         ) AS kept_item_id
  FROM public.pharmacy_item_barcodes b
  WHERE public.normalize_item_barcode(b.barcode) <> ''
), archived AS (
  INSERT INTO public.pharmacy_item_barcode_conflicts(
    pharmacy_id, item_id, source_table, source_id, barcode, normalized_barcode,
    conflict_with_item_id, payload
  )
  SELECT pharmacy_id, item_id, 'pharmacy_item_barcodes', id, barcode,
         public.normalize_item_barcode(barcode), kept_item_id, to_jsonb(ranked)
  FROM ranked
  WHERE rn > 1
  RETURNING source_id
)
DELETE FROM public.pharmacy_item_barcodes b
USING archived a
WHERE b.id = a.source_id;

-- Normalization is safe after legacy duplicates were archived and removed.
UPDATE public.pharmacy_item_barcodes
SET barcode = public.normalize_item_barcode(barcode)
WHERE barcode IS DISTINCT FROM public.normalize_item_barcode(barcode);

UPDATE public.pharmacy_item_units
SET barcode = NULLIF(public.normalize_item_barcode(barcode), ''), updated_at = now()
WHERE barcode IS NOT NULL
  AND barcode IS DISTINCT FROM NULLIF(public.normalize_item_barcode(barcode), '');

-- A unit barcode cannot duplicate a main barcode or another unit barcode.
WITH ranked_units AS (
  SELECT u.*,
         row_number() OVER (
           PARTITION BY u.pharmacy_id, public.normalize_item_barcode(u.barcode)
           ORDER BY u.is_base DESC, u.created_at, u.id
         ) AS rn,
         first_value(u.item_id) OVER (
           PARTITION BY u.pharmacy_id, public.normalize_item_barcode(u.barcode)
           ORDER BY u.is_base DESC, u.created_at, u.id
         ) AS kept_item_id
  FROM public.pharmacy_item_units u
  WHERE NULLIF(public.normalize_item_barcode(u.barcode), '') IS NOT NULL
), conflicts AS (
  SELECT r.*,
         EXISTS (
           SELECT 1 FROM public.pharmacy_item_barcodes b
           WHERE b.pharmacy_id = r.pharmacy_id
             AND public.normalize_item_barcode(b.barcode) = public.normalize_item_barcode(r.barcode)
         ) AS conflicts_main
  FROM ranked_units r
), archived AS (
  INSERT INTO public.pharmacy_item_barcode_conflicts(
    pharmacy_id, item_id, source_table, source_id, barcode, normalized_barcode,
    conflict_with_item_id, payload
  )
  SELECT pharmacy_id, item_id, 'pharmacy_item_units', id, barcode,
         public.normalize_item_barcode(barcode), kept_item_id, to_jsonb(conflicts)
  FROM conflicts
  WHERE rn > 1 OR conflicts_main
  RETURNING source_id
)
UPDATE public.pharmacy_item_units u
SET barcode = NULL, updated_at = now()
FROM archived a
WHERE u.id = a.source_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_barcodes_normalized
  ON public.pharmacy_item_barcodes(pharmacy_id, public.normalize_item_barcode(barcode))
  WHERE public.normalize_item_barcode(barcode) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_unit_barcodes_normalized
  ON public.pharmacy_item_units(pharmacy_id, public.normalize_item_barcode(barcode))
  WHERE NULLIF(public.normalize_item_barcode(barcode), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_unique_item_barcode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barcode TEXT := public.normalize_item_barcode(NEW.barcode);
  v_item_id UUID;
BEGIN
  IF v_barcode = '' THEN
    IF TG_TABLE_NAME = 'pharmacy_item_barcodes' THEN
      RAISE EXCEPTION 'barcode_required' USING ERRCODE = '23514';
    END IF;
    NEW.barcode := NULL;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.pharmacy_id::text || ':' || v_barcode, 0));
  NEW.barcode := v_barcode;

  IF TG_TABLE_NAME = 'pharmacy_item_barcodes' THEN
    SELECT u.item_id INTO v_item_id
    FROM public.pharmacy_item_units u
    WHERE u.pharmacy_id = NEW.pharmacy_id
      AND public.normalize_item_barcode(u.barcode) = v_barcode
      AND (TG_OP = 'INSERT' OR u.id IS DISTINCT FROM NEW.id)
    LIMIT 1;
  ELSE
    SELECT b.item_id INTO v_item_id
    FROM public.pharmacy_item_barcodes b
    WHERE b.pharmacy_id = NEW.pharmacy_id
      AND public.normalize_item_barcode(b.barcode) = v_barcode
    LIMIT 1;
  END IF;

  IF v_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'barcode_already_used:%', v_barcode USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_barcodes_unique_cross_table ON public.pharmacy_item_barcodes;
CREATE TRIGGER trg_item_barcodes_unique_cross_table
BEFORE INSERT OR UPDATE OF barcode, pharmacy_id ON public.pharmacy_item_barcodes
FOR EACH ROW EXECUTE FUNCTION public.assert_unique_item_barcode();

DROP TRIGGER IF EXISTS trg_item_units_unique_cross_table ON public.pharmacy_item_units;
CREATE TRIGGER trg_item_units_unique_cross_table
BEFORE INSERT OR UPDATE OF barcode, pharmacy_id ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.assert_unique_item_barcode();

-- Price history for every real change, including imports and bulk updates.
CREATE TABLE IF NOT EXISTS public.pharmacy_item_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.pharmacy_items(id) ON DELETE CASCADE,
  old_buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  old_sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'item_update',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_price_history_item
  ON public.pharmacy_item_price_history(pharmacy_id, item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_item_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.buy_price IS DISTINCT FROM NEW.buy_price OR OLD.sell_price IS DISTINCT FROM NEW.sell_price THEN
    INSERT INTO public.pharmacy_item_price_history(
      pharmacy_id, item_id, old_buy_price, new_buy_price, old_sell_price, new_sell_price,
      changed_by, source, metadata
    ) VALUES (
      NEW.pharmacy_id, NEW.id,
      COALESCE(OLD.buy_price, 0), COALESCE(NEW.buy_price, 0),
      COALESCE(OLD.sell_price, 0), COALESCE(NEW.sell_price, 0),
      COALESCE(auth.uid(), NULLIF(current_setting('app.actor_id', true), '')::uuid), COALESCE(NULLIF(current_setting('app.item_price_source', true), ''), 'item_update'),
      jsonb_build_object('previous_old_sell_price', OLD.old_sell_price)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_price_change ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_price_change
AFTER UPDATE OF buy_price, sell_price ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_price_change();

-- Complete deleted snapshot, not only status metadata.
CREATE OR REPLACE FUNCTION public.audit_item_soft_delete_restore()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  IF OLD.status IS DISTINCT FROM 'deleted' AND NEW.status = 'deleted' THEN
    SELECT to_jsonb(NEW)
      || jsonb_build_object(
        'barcodes', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) FROM public.pharmacy_item_barcodes b WHERE b.item_id = NEW.id), '[]'::jsonb),
        'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.created_at) FROM public.pharmacy_item_units u WHERE u.item_id = NEW.id), '[]'::jsonb),
        'variants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at) FROM public.pharmacy_item_variants v WHERE v.item_id = NEW.id), '[]'::jsonb),
        'balances', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.pharmacy_stock_balances s WHERE s.item_id = NEW.id), '[]'::jsonb),
        'batches', COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.created_at) FROM public.pharmacy_item_batches bt WHERE bt.item_id = NEW.id), '[]'::jsonb)
      ) INTO v_snapshot;

    INSERT INTO public.pharmacy_deleted_items_audit(
      pharmacy_id, item_id, item_snapshot, deleted_by, deleted_at
    ) VALUES (
      NEW.pharmacy_id, NEW.id, v_snapshot,
      COALESCE(NEW.deleted_by, auth.uid()), COALESCE(NEW.deleted_at, now())
    );
  ELSIF OLD.status = 'deleted' AND NEW.status IS DISTINCT FROM 'deleted' THEN
    UPDATE public.pharmacy_deleted_items_audit
    SET restored_by = auth.uid(), restored_at = now()
    WHERE id = (
      SELECT id FROM public.pharmacy_deleted_items_audit
      WHERE pharmacy_id = NEW.pharmacy_id AND item_id = NEW.id AND restored_at IS NULL
      ORDER BY deleted_at DESC LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_soft_delete_restore ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_soft_delete_restore
AFTER UPDATE OF status ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_soft_delete_restore();

CREATE OR REPLACE FUNCTION public.audit_item_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  SELECT to_jsonb(OLD)
    || jsonb_build_object(
      'hard_deleted', true,
      'barcodes', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) FROM public.pharmacy_item_barcodes b WHERE b.item_id = OLD.id), '[]'::jsonb),
      'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.created_at) FROM public.pharmacy_item_units u WHERE u.item_id = OLD.id), '[]'::jsonb),
      'variants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at) FROM public.pharmacy_item_variants v WHERE v.item_id = OLD.id), '[]'::jsonb),
      'balances', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.pharmacy_stock_balances s WHERE s.item_id = OLD.id), '[]'::jsonb),
      'batches', COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.created_at) FROM public.pharmacy_item_batches bt WHERE bt.item_id = OLD.id), '[]'::jsonb)
    ) INTO v_snapshot;

  INSERT INTO public.pharmacy_deleted_items_audit(pharmacy_id, item_id, item_snapshot, deleted_by, deleted_at)
  VALUES (OLD.pharmacy_id, OLD.id, v_snapshot, auth.uid(), now());
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_item_hard_delete ON public.pharmacy_items;
CREATE TRIGGER trg_audit_item_hard_delete
BEFORE DELETE ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.audit_item_hard_delete();

-- Search text contains all item and relation identifiers.
CREATE OR REPLACE FUNCTION public.rebuild_item_search_text(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pharmacy_items i
  SET search_text = lower(concat_ws(' ',
        i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.category, i.sub_category,
        (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
        (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
      )),
      updated_at = CASE WHEN i.updated_at IS NULL THEN now() ELSE i.updated_at END
  WHERE i.id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_item_search_from_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_text := lower(concat_ws(' ', NEW.name_ar, NEW.name_en, NEW.sku, NEW.manufacturer_name, NEW.category, NEW.sub_category));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_from_item ON public.pharmacy_items;
CREATE TRIGGER trg_sync_item_search_from_item
BEFORE INSERT OR UPDATE OF name_ar, name_en, sku, manufacturer_name, category, sub_category
ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_item();

CREATE OR REPLACE FUNCTION public.sync_item_search_from_relation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_item_search_text(OLD.item_id);
    RETURN OLD;
  END IF;
  PERFORM public.rebuild_item_search_text(NEW.item_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_barcodes ON public.pharmacy_item_barcodes;
CREATE TRIGGER trg_sync_item_search_barcodes
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_item_barcodes
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_relation();

DROP TRIGGER IF EXISTS trg_sync_item_search_units ON public.pharmacy_item_units;
CREATE TRIGGER trg_sync_item_search_units
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_relation();

UPDATE public.pharmacy_items i
SET search_text = lower(concat_ws(' ',
  i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.category, i.sub_category,
  (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
  (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
));

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_search_trgm
  ON public.pharmacy_items USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_catalog_status_name
  ON public.pharmacy_items(pharmacy_id, status, name_ar, id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_catalog_filters
  ON public.pharmacy_items(pharmacy_id, group_id, brand_id, item_type, not_for_sale);
CREATE INDEX IF NOT EXISTS idx_stock_balances_filter
  ON public.pharmacy_stock_balances(pharmacy_id, branch_id, item_id, quantity);
CREATE INDEX IF NOT EXISTS idx_item_batches_filter_expiry
  ON public.pharmacy_item_batches(pharmacy_id, branch_id, item_id, expiry_date, remaining_quantity);

-- Atomic replacement of relation rows prevents half-updated items.
CREATE OR REPLACE FUNCTION public.pharmacy_replace_item_relations(
  p_pharmacy_id UUID,
  p_item_id UUID,
  p_barcodes JSONB DEFAULT NULL,
  p_units JSONB DEFAULT NULL,
  p_variants JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duplicate TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_developer(auth.uid()) OR public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager','pharmacist')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_items
    WHERE id = p_item_id AND pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_barcodes IS NOT NULL OR p_units IS NOT NULL THEN
    WITH incoming AS (
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_barcodes, '[]'::jsonb))
      UNION ALL
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
    )
    SELECT barcode INTO v_duplicate
    FROM incoming WHERE barcode <> ''
    GROUP BY barcode HAVING count(*) > 1
    LIMIT 1;

    IF v_duplicate IS NOT NULL THEN
      RAISE EXCEPTION 'barcode_already_used:%', v_duplicate USING ERRCODE = '23505';
    END IF;

    WITH incoming AS (
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_barcodes, '[]'::jsonb))
      UNION
      SELECT public.normalize_item_barcode(value->>'barcode') AS barcode
      FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
    ), existing AS (
      SELECT public.normalize_item_barcode(b.barcode) barcode, b.item_id
      FROM public.pharmacy_item_barcodes b
      WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id <> p_item_id
      UNION ALL
      SELECT public.normalize_item_barcode(u.barcode), u.item_id
      FROM public.pharmacy_item_units u
      WHERE u.pharmacy_id = p_pharmacy_id AND u.item_id <> p_item_id AND u.barcode IS NOT NULL
    )
    SELECT i.barcode INTO v_duplicate
    FROM incoming i JOIN existing e USING (barcode)
    WHERE i.barcode <> '' LIMIT 1;

    IF v_duplicate IS NOT NULL THEN
      RAISE EXCEPTION 'barcode_already_used:%', v_duplicate USING ERRCODE = '23505';
    END IF;

    -- Delete both sets together only when both payloads are supplied; otherwise preserve untouched relations.
    IF p_barcodes IS NOT NULL THEN
      DELETE FROM public.pharmacy_item_barcodes WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    END IF;
    IF p_units IS NOT NULL THEN
      DELETE FROM public.pharmacy_item_units WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    END IF;

    IF p_barcodes IS NOT NULL THEN
      INSERT INTO public.pharmacy_item_barcodes(pharmacy_id, item_id, barcode, is_primary)
      SELECT p_pharmacy_id, p_item_id,
             public.normalize_item_barcode(value->>'barcode'),
             COALESCE((value->>'is_primary')::boolean, ordinality = 1)
      FROM jsonb_array_elements(p_barcodes) WITH ORDINALITY
      WHERE public.normalize_item_barcode(value->>'barcode') <> '';
    END IF;

    IF p_units IS NOT NULL THEN
      INSERT INTO public.pharmacy_item_units(
        pharmacy_id, item_id, unit_name, factor, barcode, sell_price, is_base,
        main_unit, sub_unit, qty_per_main_unit, unit_raw, updated_at
      )
      SELECT p_pharmacy_id, p_item_id,
             trim(value->>'unit_name'),
             GREATEST(COALESCE((value->>'factor')::numeric, 1), 0.001),
             NULLIF(public.normalize_item_barcode(value->>'barcode'), ''),
             NULLIF(value->>'sell_price', '')::numeric,
             COALESCE((value->>'is_base')::boolean, ordinality = 1),
             NULLIF(trim(value->>'main_unit'), ''),
             NULLIF(trim(value->>'sub_unit'), ''),
             GREATEST(COALESCE(NULLIF(value->>'qty_per_main_unit', '')::numeric, 0), 0),
             NULLIF(trim(value->>'unit_raw'), ''), now()
      FROM jsonb_array_elements(p_units) WITH ORDINALITY
      WHERE NULLIF(trim(value->>'unit_name'), '') IS NOT NULL;
    END IF;
  END IF;

  IF p_variants IS NOT NULL THEN
    DELETE FROM public.pharmacy_item_variants WHERE pharmacy_id = p_pharmacy_id AND item_id = p_item_id;
    INSERT INTO public.pharmacy_item_variants(pharmacy_id, item_id, name, value, sku, purchase_price, sell_price, metadata)
    SELECT p_pharmacy_id, p_item_id,
           COALESCE(NULLIF(trim(value->>'name'), ''), 'Variation'),
           trim(value->>'value'), NULLIF(trim(value->>'sku'), ''),
           COALESCE(NULLIF(value->>'purchase_price', '')::numeric, 0),
           COALESCE(NULLIF(value->>'sell_price', '')::numeric, 0),
           COALESCE(value->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_variants)
    WHERE NULLIF(trim(value->>'value'), '') IS NOT NULL;
  END IF;

  PERFORM public.rebuild_item_search_text(p_item_id);
  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pharmacy_bulk_update_item_price(
  p_pharmacy_id UUID,
  p_item_ids UUID[],
  p_mode TEXT,
  p_value NUMERIC,
  p_actor_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_developer(auth.uid()) OR public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager','pharmacist')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.item_price_source', 'bulk_price_update', true);
  PERFORM set_config('app.actor_id', COALESCE(p_actor_id::text, auth.uid()::text, ''), true);
  UPDATE public.pharmacy_items i
  SET old_sell_price = i.sell_price,
      sell_price = CASE p_mode
        WHEN 'fixed' THEN GREATEST(p_value, 0)
        WHEN 'increase_percent' THEN GREATEST(round(i.sell_price * (1 + p_value / 100), 2), 0)
        WHEN 'decrease_percent' THEN GREATEST(round(i.sell_price * (1 - p_value / 100), 2), 0)
        ELSE i.sell_price
      END,
      updated_at = now()
  WHERE i.pharmacy_id = p_pharmacy_id
    AND i.id = ANY(p_item_ids)
    AND i.status <> 'deleted';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER TABLE public.pharmacy_item_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_item_barcode_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_price_history_select ON public.pharmacy_item_price_history;
CREATE POLICY item_price_history_select ON public.pharmacy_item_price_history FOR SELECT
USING (public.is_developer(auth.uid()) OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS item_barcode_conflicts_select ON public.pharmacy_item_barcode_conflicts;
CREATE POLICY item_barcode_conflicts_select ON public.pharmacy_item_barcode_conflicts FOR SELECT
USING (public.is_developer(auth.uid()) OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin'));

GRANT EXECUTE ON FUNCTION public.pharmacy_replace_item_relations(UUID, UUID, JSONB, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_bulk_update_item_price(UUID, UUID[], TEXT, NUMERIC, UUID) TO authenticated, service_role;

COMMIT;
