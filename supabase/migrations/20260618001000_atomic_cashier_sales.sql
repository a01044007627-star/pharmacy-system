-- Atomic, idempotent cashier sale creation.
-- The function validates tenant/branch access and derives prices from the database.

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_client_request
  ON public.pharmacy_sales(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_cashier_sale(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_available NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'Not allowed to create sales';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pharmacy_branches
    WHERE id = p_branch_id
      AND pharmacy_id = p_pharmacy_id
      AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'Invalid branch';
  END IF;

  IF p_client_request_id IS NULL OR length(trim(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'client_request_id is required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line_row))
        FROM public.pharmacy_sale_lines line_row
        WHERE line_row.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one sale line is required';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status NOT IN ('deleted', 'inactive')
      AND NOT not_for_sale
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid item in sale';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid sale quantity for item %', v_item.name_ar;
    END IF;

    IF v_item.manage_inventory THEN
      SELECT quantity
      INTO v_available
      FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
      FOR UPDATE;

      v_available := COALESCE(v_available, 0);
      IF v_available < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_item.name_ar;
      END IF;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));
  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id,
    branch_id,
    invoice_number,
    client_request_id,
    customer_name,
    status,
    payment_status,
    payment_method,
    subtotal,
    discount_total,
    tax_total,
    total,
    paid_amount,
    due_amount,
    shipping_fee,
    rounding_adj,
    notes,
    created_by
  )
  VALUES (
    p_pharmacy_id,
    p_branch_id,
    v_invoice_number,
    p_client_request_id,
    COALESCE(NULLIF(trim(p_customer_name), ''), 'زبون نقدي'),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    COALESCE(NULLIF(trim(p_payment_method), ''), 'cash'),
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_total - v_paid, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(trim(p_notes), ''),
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
    INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_line_total := GREATEST(v_quantity * v_unit_price - v_line_discount, 0);

    INSERT INTO public.pharmacy_sale_lines (
      pharmacy_id,
      sale_id,
      item_id,
      item_name,
      barcode,
      unit,
      quantity,
      unit_price,
      purchase_price,
      discount,
      net_total
    )
    VALUES (
      p_pharmacy_id,
      v_sale.id,
      v_item.id,
      v_item.name_ar,
      NULLIF(trim(v_line->>'barcode'), ''),
      COALESCE(NULLIF(trim(v_line->>'unit'), ''), v_item.unit, 'unit'),
      v_quantity,
      v_unit_price,
      v_item.buy_price,
      v_line_discount,
      round(v_line_total, 2)
    );

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id,
      branch_id,
      item_id,
      direction,
      quantity,
      unit_price,
      total_value,
      movement_type,
      source_table,
      source_id,
      created_by
    )
    VALUES (
      p_pharmacy_id,
      p_branch_id,
      v_item.id,
      'out',
      v_quantity,
      v_unit_price,
      round(v_line_total, 2),
      'sale',
      'pharmacy_sales',
      v_sale.id,
      v_actor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(line_row))
      FROM public.pharmacy_sale_lines line_row
      WHERE line_row.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) TO authenticated, service_role;
