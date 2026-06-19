-- Server-side item catalogue pagination/filtering for large datasets.
BEGIN;

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

CREATE OR REPLACE FUNCTION public.pharmacy_items_catalog(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active',
  p_search TEXT DEFAULT '',
  p_item_type TEXT DEFAULT 'all',
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
WITH stock AS (
  SELECT s.item_id,
         sum(s.quantity)::numeric AS quantity,
         jsonb_agg(to_jsonb(s) ORDER BY s.branch_id) AS balances
  FROM public.pharmacy_stock_balances s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.item_id
), batches AS (
  SELECT b.item_id,
         min(b.expiry_date) FILTER (WHERE COALESCE(b.remaining_quantity, b.quantity, 0) > 0) AS nearest_expiry,
         jsonb_agg(to_jsonb(b) ORDER BY b.expiry_date NULLS LAST, b.created_at) AS rows
  FROM public.pharmacy_item_batches b
  WHERE b.pharmacy_id = p_pharmacy_id
    AND (p_branch_id IS NULL OR b.branch_id IS NULL OR b.branch_id = p_branch_id)
  GROUP BY b.item_id
), barcodes AS (
  SELECT b.item_id, jsonb_agg(to_jsonb(b) ORDER BY b.is_primary DESC, b.created_at) AS rows
  FROM public.pharmacy_item_barcodes b
  WHERE b.pharmacy_id = p_pharmacy_id
  GROUP BY b.item_id
), units AS (
  SELECT u.item_id,
         jsonb_agg(to_jsonb(u) ORDER BY u.is_base DESC, u.created_at) AS rows,
         array_agg(u.unit_name) AS names
  FROM public.pharmacy_item_units u
  WHERE u.pharmacy_id = p_pharmacy_id
  GROUP BY u.item_id
), base AS (
  SELECT i.*,
         COALESCE(s.quantity, 0) AS stock_quantity,
         COALESCE(s.balances, '[]'::jsonb) AS balances_json,
         COALESCE(bt.rows, '[]'::jsonb) AS batches_json,
         COALESCE(bc.rows, '[]'::jsonb) AS barcodes_json,
         COALESCE(u.rows, '[]'::jsonb) AS units_json,
         COALESCE(u.names, ARRAY[]::text[]) AS unit_names,
         COALESCE(i.expiry_date, bt.nearest_expiry) AS effective_expiry,
         g.name AS group_name,
         br.name AS brand_name,
         pb.name AS branch_name
  FROM public.pharmacy_items i
  LEFT JOIN stock s ON s.item_id = i.id
  LEFT JOIN batches bt ON bt.item_id = i.id
  LEFT JOIN barcodes bc ON bc.item_id = i.id
  LEFT JOIN units u ON u.item_id = i.id
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
    AND (p_item_type = 'all' OR b.item_type = p_item_type)
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
      OR (p_expiry = 'valid' AND b.effective_expiry > current_date + 60)
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
  SELECT jsonb_build_object(
    'id', p.id,
    'pharmacy_id', p.pharmacy_id,
    'branch_id', p.branch_id,
    'group_id', p.group_id,
    'brand_id', p.brand_id,
    'name_ar', p.name_ar,
    'name_en', p.name_en,
    'sku', p.sku,
    'category', p.category,
    'sub_category', p.sub_category,
    'unit', p.unit,
    'manufacturer_name', p.manufacturer_name,
    'item_type', p.item_type,
    'buy_price', p.buy_price,
    'sell_price', p.sell_price,
    'old_sell_price', p.old_sell_price,
    'manage_inventory', p.manage_inventory,
    'not_for_sale', p.not_for_sale,
    'min_stock', p.min_stock,
    'max_stock', p.max_stock,
    'opening_stock', p.opening_stock,
    'has_expiry', p.has_expiry,
    'track_batch', p.track_batch,
    'is_controlled', p.is_controlled,
    'requires_prescription', p.requires_prescription,
    'expiry_date', p.expiry_date,
    'image_url', p.image_url,
    'barcode_type', p.barcode_type,
    'tax_percent', p.tax_percent,
    'product_type', p.product_type,
    'rack', p.rack,
    'shelf_row', p.shelf_row,
    'position', p.position,
    'status', p.status,
    'notes', p.notes,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'deleted_at', p.deleted_at,
    'deleted_by', p.deleted_by,
    'group', CASE WHEN p.group_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.group_id, 'name', p.group_name) END,
    'brand', CASE WHEN p.brand_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.brand_id, 'name', p.brand_name) END,
    'branch', CASE WHEN p.branch_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.branch_id, 'name', p.branch_name, 'pharmacy_id', p.pharmacy_id) END,
    'barcodes', p.barcodes_json,
    'sub_units', p.units_json,
    'batches', p.batches_json,
    'balances', p.balances_json
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

GRANT EXECUTE ON FUNCTION public.pharmacy_item_filter_options(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_items_catalog(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

COMMIT;
