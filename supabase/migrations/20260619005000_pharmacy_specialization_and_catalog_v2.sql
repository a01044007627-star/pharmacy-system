BEGIN;

-- Pharmacy-only catalogue data. All columns are additive to preserve existing client data.
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS pharmacy_type TEXT,
  ADD COLUMN IF NOT EXISTS generic_name TEXT,
  ADD COLUMN IF NOT EXISTS active_ingredient TEXT,
  ADD COLUMN IF NOT EXISTS therapeutic_class TEXT,
  ADD COLUMN IF NOT EXISTS dosage_form TEXT,
  ADD COLUMN IF NOT EXISTS strength TEXT,
  ADD COLUMN IF NOT EXISTS package_size TEXT,
  ADD COLUMN IF NOT EXISTS route_of_administration TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_country TEXT,
  ADD COLUMN IF NOT EXISTS storage_condition TEXT;

UPDATE public.pharmacy_items
SET pharmacy_type = CASE
  WHEN NULLIF(trim(pharmacy_type), '') IS NOT NULL THEN pharmacy_type
  WHEN COALESCE(item_type, '') = 'service' THEN 'other'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مستلزم|شاش|قطن|سرنج|قسطرة|medical[[:space:]]*supply)' THEN 'medical_supply'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مكمل|فيتامين|vitamin|supplement)' THEN 'supplement'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(تجميل|بشرة|ميك[[:space:]]*اب|cosmetic|makeup)' THEN 'cosmetic'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(شامبو|معجون|غسول|عناية[[:space:]]*شخصية|personal[[:space:]]*care)' THEN 'personal_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(طفل|بيبي|حفاض|baby)' THEN 'baby_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(جهاز|ترمومتر|ميزان|نيبولايزر|device)' THEN 'device'
  ELSE 'medicine'
END
WHERE NULLIF(trim(pharmacy_type), '') IS NULL;

UPDATE public.pharmacy_items
SET pharmacy_type = 'other'
WHERE pharmacy_type NOT IN (
  'medicine', 'medical_supply', 'supplement', 'cosmetic',
  'personal_care', 'baby_care', 'device', 'other'
);

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET DEFAULT 'medicine';

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_items_pharmacy_type_check'
  ) THEN
    ALTER TABLE public.pharmacy_items
      ADD CONSTRAINT pharmacy_items_pharmacy_type_check
      CHECK (pharmacy_type IN (
        'medicine', 'medical_supply', 'supplement', 'cosmetic',
        'personal_care', 'baby_care', 'device', 'other'
      )) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_pharmacy_type
  ON public.pharmacy_items(pharmacy_id, pharmacy_type, status, name_ar, id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_active_ingredient_trgm
  ON public.pharmacy_items USING gin(active_ingredient gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_generic_name_trgm
  ON public.pharmacy_items USING gin(generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_dosage_form
  ON public.pharmacy_items(pharmacy_id, dosage_form)
  WHERE dosage_form IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_registration_number
  ON public.pharmacy_items(pharmacy_id, registration_number)
  WHERE NULLIF(trim(registration_number), '') IS NOT NULL;

-- Keep the full pharmaceutical identity searchable, including relation barcodes and units.
CREATE OR REPLACE FUNCTION public.rebuild_item_search_text(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pharmacy_items i
  SET search_text = lower(concat_ws(' ',
        i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
        i.category, i.sub_category, i.pharmacy_type, i.generic_name,
        i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
        i.package_size, i.route_of_administration, i.registration_number,
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
  NEW.search_text := lower(concat_ws(' ',
    NEW.name_ar, NEW.name_en, NEW.sku, NEW.manufacturer_name, NEW.manufacturer_country,
    NEW.category, NEW.sub_category, NEW.pharmacy_type, NEW.generic_name,
    NEW.active_ingredient, NEW.therapeutic_class, NEW.dosage_form, NEW.strength,
    NEW.package_size, NEW.route_of_administration, NEW.registration_number
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_from_item ON public.pharmacy_items;
CREATE TRIGGER trg_sync_item_search_from_item
BEFORE INSERT OR UPDATE OF
  name_ar, name_en, sku, manufacturer_name, manufacturer_country,
  category, sub_category, pharmacy_type, generic_name, active_ingredient,
  therapeutic_class, dosage_form, strength, package_size,
  route_of_administration, registration_number
ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_item();

UPDATE public.pharmacy_items i
SET search_text = lower(concat_ws(' ',
  i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
  i.category, i.sub_category, i.pharmacy_type, i.generic_name,
  i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
  i.package_size, i.route_of_administration, i.registration_number,
  (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
  (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
));

CREATE OR REPLACE FUNCTION public.pharmacy_item_filter_options(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active'
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'manufacturers', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.manufacturer_name) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.manufacturer_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'activeIngredients', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.active_ingredient) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.active_ingredient), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'dosageForms', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.dosage_form) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.dosage_form), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'pharmacyTypes', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.pharmacy_type) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.pharmacy_type), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.unit) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.unit), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'subUnits', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(u.unit_name) AS v
        FROM public.pharmacy_item_units u
        JOIN public.pharmacy_items i ON i.id = u.item_id AND i.pharmacy_id = u.pharmacy_id
        WHERE u.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(u.unit_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.pharmacy_items_catalog_v2(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active',
  p_search TEXT DEFAULT '',
  p_pharmacy_type TEXT DEFAULT 'all',
  p_group_id TEXT DEFAULT 'all',
  p_brand_id TEXT DEFAULT 'all',
  p_manufacturer TEXT DEFAULT 'all',
  p_unit TEXT DEFAULT 'all',
  p_sub_unit TEXT DEFAULT 'all',
  p_expiry TEXT DEFAULT 'all',
  p_price TEXT DEFAULT 'all',
  p_stock TEXT DEFAULT 'all',
  p_not_for_sale BOOLEAN DEFAULT false,
  p_sort_key TEXT DEFAULT 'name',
  p_sort_dir TEXT DEFAULT 'asc',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH stock_summary AS (
  SELECT s.item_id, sum(s.quantity)::numeric AS quantity
  FROM public.pharmacy_stock_balances s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.item_id
), batch_summary AS (
  SELECT b.item_id,
         min(b.expiry_date) FILTER (WHERE COALESCE(b.remaining_quantity, b.quantity, 0) > 0) AS nearest_expiry
  FROM public.pharmacy_item_batches b
  WHERE b.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
  GROUP BY b.item_id
), unit_names AS (
  SELECT u.item_id, array_agg(DISTINCT u.unit_name) AS names
  FROM public.pharmacy_item_units u
  WHERE u.pharmacy_id = p_pharmacy_id
  GROUP BY u.item_id
), base AS (
  SELECT i.*,
         COALESCE(s.quantity, 0) AS stock_quantity,
         COALESCE(u.names, ARRAY[]::text[]) AS unit_names,
         COALESCE(i.expiry_date, bt.nearest_expiry) AS effective_expiry,
         g.name AS group_name,
         br.name AS brand_name,
         pb.name AS branch_name
  FROM public.pharmacy_items i
  LEFT JOIN stock_summary s ON s.item_id = i.id
  LEFT JOIN batch_summary bt ON bt.item_id = i.id
  LEFT JOIN unit_names u ON u.item_id = i.id
  LEFT JOIN public.pharmacy_item_groups g ON g.id = i.group_id
  LEFT JOIN public.pharmacy_item_brands br ON br.id = i.brand_id
  LEFT JOIN public.pharmacy_branches pb ON pb.id = i.branch_id
  WHERE i.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
    AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE (NULLIF(trim(p_search), '') IS NULL OR b.search_text ILIKE '%' || trim(p_search) || '%')
    AND (p_pharmacy_type = 'all' OR b.pharmacy_type = p_pharmacy_type)
    AND (p_group_id = 'all' OR b.group_id::text = p_group_id)
    AND (p_brand_id = 'all' OR b.brand_id::text = p_brand_id)
    AND (p_manufacturer = 'all' OR COALESCE(b.manufacturer_name, '') = p_manufacturer)
    AND (p_unit = 'all' OR COALESCE(b.unit, '') = p_unit)
    AND (p_sub_unit = 'all' OR p_sub_unit = ANY(b.unit_names))
    AND (NOT p_not_for_sale OR b.not_for_sale)
    AND (
      p_expiry = 'all'
      OR (p_expiry = 'none' AND b.effective_expiry IS NULL)
      OR (p_expiry = 'expired' AND b.effective_expiry < current_date)
      OR (p_expiry = 'soon' AND b.effective_expiry >= current_date AND b.effective_expiry <= current_date + 60)
      OR (p_expiry IN ('safe', 'valid') AND b.effective_expiry > current_date + 60)
    )
    AND (
      p_price = 'all'
      OR (p_price = 'changed' AND COALESCE(b.old_sell_price, 0) > 0 AND b.sell_price IS DISTINCT FROM b.old_sell_price)
      OR (p_price = 'has-old' AND COALESCE(b.old_sell_price, 0) > 0)
      OR (p_price = 'new-only' AND COALESCE(b.old_sell_price, 0) <= 0)
    )
    AND (
      p_stock = 'all'
      OR (p_stock = 'out' AND b.manage_inventory AND b.stock_quantity <= 0)
      OR (p_stock = 'low' AND b.manage_inventory AND b.stock_quantity > 0 AND b.stock_quantity <= COALESCE(b.min_stock, 0))
      OR (p_stock = 'available' AND b.stock_quantity > 0)
    )
), ordered AS (
  SELECT f.*,
         count(*) OVER () AS total_count,
         row_number() OVER (ORDER BY
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'name' THEN f.name_ar END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'name' THEN f.name_ar END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'manufacturer' THEN f.manufacturer_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'pharmacyType' THEN f.pharmacy_type END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'pharmacyType' THEN f.pharmacy_type END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'activeIngredient' THEN f.active_ingredient END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'activeIngredient' THEN f.active_ingredient END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'dosage' THEN f.dosage_form END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'dosage' THEN f.dosage_form END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'group' THEN f.group_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'group' THEN f.group_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'brand' THEN f.brand_name END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'brand' THEN f.brand_name END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'stock' THEN f.stock_quantity END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'stock' THEN f.stock_quantity END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'sellPrice' THEN f.sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'sellPrice' THEN f.sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'oldSellPrice' THEN f.old_sell_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'buyPrice' THEN f.buy_price END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'buyPrice' THEN f.buy_price END DESC NULLS LAST,
           CASE WHEN p_sort_dir = 'asc' AND p_sort_key = 'expiry' THEN f.effective_expiry END ASC NULLS LAST,
           CASE WHEN p_sort_dir = 'desc' AND p_sort_key = 'expiry' THEN f.effective_expiry END DESC NULLS LAST,
           f.name_ar ASC, f.id ASC
         ) AS rn
  FROM filtered f
), paged AS (
  SELECT o.*
  FROM ordered o
  WHERE o.rn > (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 1000)
    AND o.rn <= GREATEST(p_page, 1) * LEAST(GREATEST(p_page_size, 1), 1000)
), payload AS (
  SELECT (
    to_jsonb(p) - ARRAY[
      'stock_quantity','unit_names','effective_expiry','group_name','brand_name','branch_name','total_count','rn'
    ]::text[]
    || jsonb_build_object(
      'group', CASE WHEN p.group_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.group_id, 'name', p.group_name) END,
      'brand', CASE WHEN p.brand_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.brand_id, 'name', p.brand_name) END,
      'branch', CASE WHEN p.branch_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.branch_id, 'name', p.branch_name, 'pharmacy_id', p.pharmacy_id) END,
      'barcodes', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.is_primary DESC, b.created_at)
        FROM public.pharmacy_item_barcodes b
        WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id = p.id
      ), '[]'::jsonb),
      'sub_units', COALESCE((
        SELECT jsonb_agg(to_jsonb(u) ORDER BY u.is_base DESC, u.created_at)
        FROM public.pharmacy_item_units u
        WHERE u.pharmacy_id = p_pharmacy_id AND u.item_id = p.id
      ), '[]'::jsonb),
      'batches', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.expiry_date NULLS LAST, b.created_at)
        FROM public.pharmacy_item_batches b
        WHERE b.pharmacy_id = p_pharmacy_id
          AND b.item_id = p.id
          AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
      ), '[]'::jsonb),
      'balances', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.branch_id)
        FROM public.pharmacy_stock_balances s
        WHERE s.pharmacy_id = p_pharmacy_id
          AND s.item_id = p.id
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      ), '[]'::jsonb)
    )
  ) AS item, p.rn
  FROM paged p
), totals AS (
  SELECT COALESCE(max(total_count), 0)::integer AS total FROM ordered
), summary AS (
  SELECT
    count(*) FILTER (WHERE manage_inventory AND stock_quantity > 0 AND stock_quantity <= COALESCE(min_stock, 0))::integer AS low_stock,
    count(*) FILTER (WHERE manage_inventory AND stock_quantity <= 0)::integer AS out_of_stock,
    count(*) FILTER (WHERE effective_expiry >= current_date AND effective_expiry <= current_date + 60)::integer AS expiry_soon,
    count(*) FILTER (WHERE effective_expiry < current_date)::integer AS expired
  FROM filtered
)
SELECT jsonb_build_object(
  'items', COALESCE((SELECT jsonb_agg(item ORDER BY rn) FROM payload), '[]'::jsonb),
  'itemsTotal', (SELECT total FROM totals),
  'page', GREATEST(p_page, 1),
  'pageSize', LEAST(GREATEST(p_page_size, 1), 1000),
  'totalPages', GREATEST(1, ceil((SELECT total FROM totals)::numeric / LEAST(GREATEST(p_page_size, 1), 1000))::integer),
  'summary', jsonb_build_object(
    'lowStock', COALESCE((SELECT low_stock FROM summary), 0),
    'outOfStock', COALESCE((SELECT out_of_stock FROM summary), 0),
    'expirySoon', COALESCE((SELECT expiry_soon FROM summary), 0),
    'expired', COALESCE((SELECT expired FROM summary), 0)
  )
)
$$;

GRANT EXECUTE ON FUNCTION public.pharmacy_item_filter_options(UUID, UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_items_catalog_v2(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMIT;
