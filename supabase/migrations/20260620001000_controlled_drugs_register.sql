BEGIN;

-- Define helper function for active pharmacy lookup
CREATE OR REPLACE FUNCTION public.get_user_active_pharmacy_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pharmacy_id
  FROM public.pharmacy_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY last_login_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_active_pharmacy_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_active_pharmacy_id() TO authenticated;

-- a) Add patient/doctor/prescription columns to pharmacy_sales for cashier integration
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS doctor_name TEXT,
  ADD COLUMN IF NOT EXISTS prescription_number TEXT;

-- b) RLS on pharmacy_controlled_drugs_log
ALTER TABLE public.pharmacy_controlled_drugs_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacy_controlled_drugs_log_pharmacy_isolation
  ON public.pharmacy_controlled_drugs_log
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING (pharmacy_id = public.get_user_active_pharmacy_id());

-- c) Trigger for auto-logging controlled drugs on purchase
CREATE OR REPLACE FUNCTION public.auto_log_controlled_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_controlled BOOLEAN;
  v_purchase_record public.pharmacy_purchases%ROWTYPE;
BEGIN
  SELECT is_controlled INTO v_is_controlled
  FROM public.pharmacy_items
  WHERE id = NEW.item_id AND pharmacy_id = NEW.pharmacy_id;

  IF v_is_controlled THEN
    SELECT * INTO v_purchase_record
    FROM public.pharmacy_purchases
    WHERE id = NEW.purchase_id AND pharmacy_id = NEW.pharmacy_id;

    INSERT INTO public.pharmacy_controlled_drugs_log (
      pharmacy_id, item_id, branch_id, action, quantity,
      notes, created_by, created_at
    ) VALUES (
      NEW.pharmacy_id, NEW.item_id, v_purchase_record.branch_id,
      'received', NEW.quantity,
      'شراء: ' || COALESCE(v_purchase_record.purchase_number, ''),
      NEW.created_by, now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_controlled_purchase_auto_log
  AFTER INSERT ON public.pharmacy_purchase_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_log_controlled_purchase();

-- d) Update pharmacy_items_catalog RPC to support is_controlled filter
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
  p_is_controlled BOOLEAN DEFAULT NULL,
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
    AND (p_item_type = 'all' OR b.item_type = p_item_type)
    AND (p_group_id = 'all' OR b.group_id::text = p_group_id)
    AND (p_brand_id = 'all' OR b.brand_id::text = p_brand_id)
    AND (p_manufacturer = 'all' OR COALESCE(b.manufacturer_name, '') = p_manufacturer)
    AND (p_unit = 'all' OR COALESCE(b.unit, '') = p_unit)
    AND (p_sub_unit = 'all' OR p_sub_unit = ANY(b.unit_names))
    AND (NOT p_not_for_sale OR b.not_for_sale)
    AND (p_is_controlled IS NULL OR b.is_controlled = p_is_controlled)
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

GRANT EXECUTE ON FUNCTION public.pharmacy_items_catalog(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMIT;
