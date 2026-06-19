-- ===================================================================
-- ATOMIC RPC FUNCTIONS — Consolidated
-- Extracted from migration files 20260618001xxx–20260618012xxx
-- Order: sales (v1, v2, void) → returns → purchases → purchase returns → stock transfer → stock count approval
-- ===================================================================

-- ===================================================================
-- 1. create_cashier_sale (v1 — legacy)
-- Source: 20260618001000_atomic_cashier_sales.sql
-- ===================================================================

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


-- ===================================================================
-- 2. create_cashier_sale_v2 (newer version with shift + FEFO)
-- Source: 20260618005000_cashier_atomic_fefo_security.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_cashier_sale_v2(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
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
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_remaining_quantity NUMERIC;
  v_alloc_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_remaining_discount NUMERIC;
  v_alloc_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
  v_has_batches BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تنفيذ البيع';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية البيع غير صالح';
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
        SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
        FROM public.pharmacy_sale_lines sale_line
        WHERE sale_line.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_shift
  FROM public.pharmacy_shifts
  WHERE id = p_shift_id
    AND pharmacy_id = p_pharmacy_id
    AND branch_id = p_branch_id
    AND user_id = v_actor_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'جلسة الكاشير غير مفتوحة أو انتهت';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
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
      AND status = 'active'
      AND COALESCE(not_for_sale, false) = false
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير صالح للبيع';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية البيع غير صحيحة للصنف %', v_item.name_ar;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
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
  v_due := GREATEST(v_total - v_paid, 0);
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id, branch_id, shift_id, invoice_number, client_request_id,
    customer_name, status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, rounding_adj, notes, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, p_shift_id, v_invoice_number, p_client_request_id,
    COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method,
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_due, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(BTRIM(p_notes), ''),
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
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
        AND quantity >= v_quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'الكمية غير كافية للصنف: %', v_item.name_ar;
      END IF;
    END IF;

    v_remaining_quantity := v_quantity;
    v_remaining_discount := v_line_discount;
    SELECT EXISTS (
      SELECT 1
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
    ) INTO v_has_batches;

    FOR v_batch IN
      SELECT batch_row.*
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
        AND (batch_row.expiry_date IS NULL OR batch_row.expiry_date >= CURRENT_DATE)
      ORDER BY batch_row.expiry_date ASC NULLS LAST, batch_row.created_at ASC, batch_row.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_quantity <= 0;
      v_alloc_quantity := LEAST(v_remaining_quantity, v_batch.remaining_quantity);
      v_alloc_discount := CASE
        WHEN v_alloc_quantity = v_remaining_quantity THEN v_remaining_discount
        ELSE LEAST(v_remaining_discount, round(v_line_discount * (v_alloc_quantity / v_quantity), 2))
      END;
      v_line_total := GREATEST(v_alloc_quantity * v_unit_price - v_alloc_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, batch_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_batch.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_alloc_quantity, v_unit_price, v_item.buy_price, v_alloc_discount, round(v_line_total, 2)
      );

      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_alloc_quantity,
          updated_at = now()
      WHERE id = v_batch.id;

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'out', v_alloc_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );

      v_remaining_quantity := v_remaining_quantity - v_alloc_quantity;
      v_remaining_discount := GREATEST(v_remaining_discount - v_alloc_discount, 0);
    END LOOP;

    IF v_remaining_quantity > 0 AND v_has_batches AND (v_item.track_batch OR v_item.has_expiry) THEN
      RAISE EXCEPTION 'لا توجد تشغيلة صالحة بكمية كافية للصنف: %', v_item.name_ar;
    END IF;

    IF v_remaining_quantity > 0 THEN
      v_line_total := GREATEST(v_remaining_quantity * v_unit_price - v_remaining_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_remaining_quantity, v_unit_price, v_item.buy_price, v_remaining_discount, round(v_line_total, 2)
      );

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, 'out', v_remaining_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );
    END IF;
  END LOOP;

  v_cash_paid := CASE WHEN v_method = 'cash' THEN v_paid ELSE 0 END;
  v_card_paid := CASE WHEN v_method IN ('card', 'wallet', 'mixed') THEN v_paid ELSE 0 END;

  UPDATE public.pharmacy_shifts
  SET cash_sales = COALESCE(cash_sales, 0) + v_cash_paid,
      card_sales = COALESCE(card_sales, 0) + v_card_paid,
      credit_sales = COALESCE(credit_sales, 0) + v_due,
      total_collected = COALESCE(total_collected, 0) + v_paid,
      expected_balance = COALESCE(opening_balance, 0) + COALESCE(cash_sales, 0) + v_cash_paid - COALESCE(total_expenses, 0),
      updated_at = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
      FROM public.pharmacy_sale_lines sale_line
      WHERE sale_line.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 3. void_cashier_sale
-- Source: 20260618005000_cashier_atomic_fefo_security.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_cashier_sale(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المبيعات';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'sale', to_jsonb(v_sale));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.pharmacy_sale_lines
    WHERE sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.unit_price, v_line.net_total,
      'sale_void', 'pharmacy_sales', v_sale.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة بيع'),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  v_cash_paid := CASE WHEN v_sale.payment_method = 'cash' THEN v_sale.paid_amount ELSE 0 END;
  v_card_paid := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_sale.paid_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_paid, 0),
        credit_sales = GREATEST(COALESCE(credit_sales, 0) - COALESCE(v_sale.due_amount, 0), 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - COALESCE(v_sale.paid_amount, 0), 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'sale', to_jsonb(v_sale));
END;
$$;

REVOKE ALL ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===================================================================
-- 4. create_sales_return
-- Source: 20260618006000_atomic_sales_returns.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_sales_return(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_reason TEXT,
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
  v_return public.pharmacy_sales_returns%ROWTYPE;
  v_sale_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_due_reduction NUMERIC := 0;
  v_refund_amount NUMERIC := 0;
  v_cash_refund NUMERIC := 0;
  v_card_refund NUMERIC := 0;
  v_return_number TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مبيعات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  SELECT *
    INTO v_return
  FROM public.pharmacy_sales_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_sales_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_sales_return_lines return_line
    JOIN public.pharmacy_sales_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.sale_line_id = v_sale_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_sale_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_sale_line.item_name;
    END IF;

    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  v_due_reduction := LEAST(GREATEST(COALESCE(v_sale.due_amount, 0), 0), v_total);
  v_refund_amount := LEAST(
    GREATEST(v_total - v_due_reduction, 0),
    GREATEST(COALESCE(v_sale.paid_amount, 0), 0)
  );
  v_return_number := 'SRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales_returns (
    pharmacy_id, branch_id, sale_id, return_number, client_request_id,
    customer_name, total, refund_amount, stock_mode, reason,
    return_date, created_by
  )
  VALUES (
    p_pharmacy_id, v_sale.branch_id, v_sale.id, v_return_number, p_client_request_id,
    v_sale.customer_name, v_total, v_refund_amount, 'restore_original_batch',
    NULLIF(BTRIM(p_reason), ''), now(), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_sale_line
    FROM public.pharmacy_sale_lines
    WHERE id = (v_line->>'sale_line_id')::UUID
      AND sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round((v_sale_line.net_total / NULLIF(v_sale_line.quantity, 0)) * v_quantity, 2);

    INSERT INTO public.pharmacy_sales_return_lines (
      pharmacy_id, return_id, sale_line_id, item_id, batch_id,
      quantity, unit_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_sale_line.id, v_sale_line.item_id, v_sale_line.batch_id,
      v_quantity, round(v_line_total / v_quantity, 2), v_line_total
    );

    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_sale_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_sale_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_quantity,
          updated_at = now()
      WHERE id = v_sale_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_sale_line.item_id, v_sale_line.batch_id,
      'in', v_quantity, round(v_line_total / v_quantity, 2), v_line_total,
      'sales_return', 'pharmacy_sales_returns', v_return.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0),
      due_amount = GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0),
      payment_status = CASE
        WHEN GREATEST(COALESCE(due_amount, 0) - v_due_reduction, 0) <= 0 THEN 'paid'
        WHEN GREATEST(COALESCE(paid_amount, 0) - v_refund_amount, 0) > 0 THEN 'partial'
        ELSE 'unpaid'
      END,
      updated_at = now()
  WHERE id = v_sale.id;

  IF v_refund_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, 'sales_return', 'customer_refund',
      v_refund_amount, 'out', 'pharmacy_sales_returns', v_return.id,
      'رد قيمة مرتجع الفاتورة ' || v_sale.invoice_number, now(), v_actor_id
    );
  END IF;

  v_cash_refund := CASE WHEN v_sale.payment_method = 'cash' THEN v_refund_amount ELSE 0 END;
  v_card_refund := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_refund_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL AND v_refund_amount > 0 THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_refund, 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - v_refund_amount, 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_refund, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_sales_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'due_reduction', v_due_reduction,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_return(UUID, UUID, UUID, TEXT, TEXT, JSONB)
  TO authenticated, service_role;


-- ===================================================================
-- 5. create_received_purchase
-- Source: 20260618007000_atomic_received_purchases.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_received_purchase(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_supplier_id UUID,
  p_supplier_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_header_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_notes TEXT,
  p_purchase_date TIMESTAMPTZ,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_supplier public.pharmacy_partners%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_buy_price NUMERIC;
  v_sell_price NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_header_discount NUMERIC;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_purchase_number TEXT;
  v_batch_number TEXT;
  v_expiry_date DATE;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل المشتريات';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches
    WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'الفرع غير صالح أو مغلق';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية الشراء غير صالح';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'purchase', to_jsonb(v_purchase),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
        FROM public.pharmacy_purchase_lines purchase_line
        WHERE purchase_line.purchase_id = v_purchase.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier
    FROM public.pharmacy_partners
    WHERE id = p_supplier_id
      AND pharmacy_id = p_pharmacy_id
      AND type IN ('supplier', 'both')
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير صالح'; END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'يوجد صنف غير صالح في فاتورة الشراء'; END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_line_discount := GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0);
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'كمية الشراء غير صحيحة للصنف %', v_item.name_ar; END IF;
    IF v_buy_price < 0 THEN RAISE EXCEPTION 'سعر الشراء غير صحيح للصنف %', v_item.name_ar; END IF;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_buy_price);
    v_subtotal := v_subtotal + (v_quantity * v_buy_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  v_header_discount := LEAST(
    GREATEST(COALESCE(p_header_discount, 0), 0),
    GREATEST(v_subtotal - v_line_discounts, 0)
  );
  v_total := round(GREATEST(v_subtotal - v_line_discounts - v_header_discount + v_tax_total + v_shipping_fee, 0), 2);
  v_paid := round(LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0)), 2);
  v_due := round(GREATEST(v_total - v_paid, 0), 2);
  v_purchase_number := 'PUR-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchases (
    pharmacy_id, branch_id, purchase_number, client_request_id,
    supplier_id, supplier_name, status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, notes, purchase_date, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, v_purchase_number, p_client_request_id,
    p_supplier_id,
    COALESCE(NULLIF(BTRIM(p_supplier_name), ''), v_supplier.name, 'مورد نقدي'),
    'received',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method, round(v_subtotal, 2), round(v_line_discounts + v_header_discount, 2),
    round(v_tax_total, 2), v_total, v_paid, v_due, round(v_shipping_fee, 2),
    NULLIF(BTRIM(p_notes), ''), COALESCE(p_purchase_date, now()), v_actor_id
  )
  RETURNING * INTO v_purchase;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_buy_price := GREATEST(COALESCE((v_line->>'buy_price')::NUMERIC, 0), 0);
    v_sell_price := GREATEST(COALESCE((v_line->>'sell_price')::NUMERIC, v_item.sell_price), 0);
    v_line_discount := LEAST(
      GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0),
      v_quantity * v_buy_price
    );
    v_line_total := round(GREATEST(v_quantity * v_buy_price - v_line_discount, 0), 2);
    v_batch_number := NULLIF(BTRIM(v_line->>'batch_number'), '');
    v_expiry_date := NULLIF(v_line->>'expiry_date', '')::DATE;

    IF (v_item.track_batch OR v_item.has_expiry) AND v_batch_number IS NULL THEN
      v_batch_number := 'PUR-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 8));
    END IF;
    IF v_item.has_expiry AND v_expiry_date IS NULL THEN
      RAISE EXCEPTION 'تاريخ الصلاحية مطلوب للصنف %', v_item.name_ar;
    END IF;

    IF v_batch_number IS NOT NULL OR v_expiry_date IS NOT NULL OR v_item.track_batch OR v_item.has_expiry THEN
      INSERT INTO public.pharmacy_item_batches (
        pharmacy_id, item_id, branch_id, batch_number, expiry_date,
        quantity, remaining_quantity, unit, cost_price, source_type, source_id
      )
      VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, v_batch_number, v_expiry_date,
        v_quantity, v_quantity, COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
        v_buy_price, 'purchase', v_purchase.id::TEXT
      )
      RETURNING * INTO v_batch;
    ELSE
      v_batch.id := NULL;
    END IF;

    INSERT INTO public.pharmacy_purchase_lines (
      pharmacy_id, purchase_id, item_id, batch_id, item_name, unit,
      batch_number, expiry_date, quantity, buy_price, sell_price, discount, net_total
    )
    VALUES (
      p_pharmacy_id, v_purchase.id, v_item.id, v_batch.id, v_item.name_ar,
      COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit),
      v_batch_number, v_expiry_date, v_quantity, v_buy_price, v_sell_price,
      v_line_discount, v_line_total
    );

    IF v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (p_pharmacy_id, p_branch_id, v_item.id, v_quantity, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    UPDATE public.pharmacy_items
    SET buy_price = v_buy_price,
        sell_price = CASE WHEN v_sell_price > 0 THEN v_sell_price ELSE sell_price END,
        updated_at = now()
    WHERE id = v_item.id AND pharmacy_id = p_pharmacy_id;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'in', v_quantity,
      v_buy_price, v_line_total, 'purchase', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF p_supplier_id IS NOT NULL AND v_due > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = COALESCE(balance, 0) + v_due,
        updated_at = now()
    WHERE id = p_supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_paid > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, p_branch_id, 'purchase', 'supplier_payment', v_paid, 'out',
      'pharmacy_purchases', v_purchase.id,
      'سداد فاتورة شراء ' || v_purchase.purchase_number,
      COALESCE(p_purchase_date, now()), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(purchase_line) ORDER BY purchase_line.created_at, purchase_line.id)
      FROM public.pharmacy_purchase_lines purchase_line
      WHERE purchase_line.purchase_id = v_purchase.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_received_purchase(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 6. void_received_purchase
-- Source: 20260618007000_atomic_received_purchases.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_received_purchase(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المشتريات';
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'purchase', to_jsonb(v_purchase));
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_stock_balances
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id
        AND quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن مخزون الصنف % تم استخدامه', COALESCE(v_line.item_name, v_item.name_ar);
    END IF;

    IF v_line.batch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pharmacy_item_batches
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id
        AND remaining_quantity >= v_line.quantity
    ) THEN
      RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة لأن كمية من التشغيلة % تم صرفها', COALESCE(v_line.batch_number, 'المستلمة');
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_lines
    WHERE purchase_id = p_purchase_id AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_line.quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = v_purchase.branch_id
        AND item_id = v_line.item_id;
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_line.item_id, v_line.batch_id,
      'out', v_line.quantity, v_line.buy_price, v_line.net_total,
      'purchase_void', 'pharmacy_purchases', v_purchase.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.supplier_id IS NOT NULL AND v_purchase.due_amount > 0 THEN
    UPDATE public.pharmacy_partners
    SET balance = GREATEST(COALESCE(balance, 0) - v_purchase.due_amount, 0),
        updated_at = now()
    WHERE id = v_purchase.supplier_id AND pharmacy_id = p_pharmacy_id;
  END IF;

  IF v_purchase.paid_amount > 0 THEN
    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_void', 'supplier_refund',
      v_purchase.paid_amount, 'in', 'pharmacy_purchases', v_purchase.id,
      'عكس سداد فاتورة شراء ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  UPDATE public.pharmacy_purchases
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة شراء مستلمة'),
      updated_at = now()
  WHERE id = p_purchase_id
  RETURNING * INTO v_purchase;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'purchase', to_jsonb(v_purchase));
END;
$$;

REVOKE ALL ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_received_purchase(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===================================================================
-- 7. create_purchase_return
-- Source: 20260618009000_atomic_purchase_returns_rpc.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.create_purchase_return(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_stock_mode TEXT DEFAULT 'restock',
  p_reason TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase_line public.pharmacy_purchase_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_returned_quantity NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_return_number TEXT;
  v_stock_mode TEXT := COALESCE(NULLIF(BTRIM(p_stock_mode), ''), 'restock');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل مرتجع مشتريات';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية المرتجع غير صالح';
  END IF;

  IF v_stock_mode NOT IN ('restock', 'write-off') THEN
    RAISE EXCEPTION 'نظام المخزون غير صالح';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'return', to_jsonb(v_return),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
        FROM public.pharmacy_purchase_return_lines return_line
        WHERE return_line.return_id = v_return.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_purchase
  FROM public.pharmacy_purchases
  WHERE id = p_purchase_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة الشراء غير موجودة';
  END IF;

  IF v_purchase.voided_at IS NOT NULL OR v_purchase.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إرجاع أصناف من فاتورة ملغاة';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_purchase.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'حدد صنفاً واحداً على الأقل للمرتجع';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد بند مرتجع غير تابع للفاتورة';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية المرتجع يجب أن تكون أكبر من صفر';
    END IF;

    SELECT COALESCE(SUM(return_line.quantity), 0)
      INTO v_returned_quantity
    FROM public.pharmacy_purchase_return_lines return_line
    JOIN public.pharmacy_purchase_returns return_header ON return_header.id = return_line.return_id
    WHERE return_line.pharmacy_id = p_pharmacy_id
      AND return_line.purchase_line_id = v_purchase_line.id
      AND return_header.voided_at IS NULL;

    IF v_quantity > (v_purchase_line.quantity - v_returned_quantity) THEN
      RAISE EXCEPTION 'الكمية المرتجعة أكبر من المتبقي للبند: %', v_purchase_line.item_name;
    END IF;

    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);
    v_total := v_total + v_line_total;
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'قيمة المرتجع غير صالحة';
  END IF;

  v_return_number := 'PRET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_purchase_returns (
    pharmacy_id, branch_id, purchase_id, return_number, client_request_id,
    supplier_name, total, refund_amount, stock_mode, reason, created_by
  )
  VALUES (
    p_pharmacy_id, v_purchase.branch_id, v_purchase.id, v_return_number, p_client_request_id,
    v_purchase.supplier_name, v_total, v_total, v_stock_mode,
    NULLIF(BTRIM(p_reason), ''), v_actor_id
  )
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_purchase_line
    FROM public.pharmacy_purchase_lines
    WHERE id = (v_line->>'purchase_line_id')::UUID
      AND purchase_id = p_purchase_id
      AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_line_total := round(v_purchase_line.buy_price * v_quantity, 2);

    INSERT INTO public.pharmacy_purchase_return_lines (
      pharmacy_id, return_id, purchase_line_id, item_id, batch_id,
      quantity, unit, buy_price, total
    )
    VALUES (
      p_pharmacy_id, v_return.id, v_purchase_line.id, v_purchase_line.item_id, v_purchase_line.batch_id,
      v_quantity, v_purchase_line.unit, v_purchase_line.buy_price, v_line_total
    );

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_purchase_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF v_stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = GREATEST(quantity - v_quantity, 0),
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_purchase.branch_id
          AND item_id = v_purchase_line.item_id;
      END IF;

      IF v_purchase_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = GREATEST(remaining_quantity - v_quantity, 0),
            updated_at = now()
        WHERE id = v_purchase_line.batch_id
          AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, v_purchase_line.item_id, v_purchase_line.batch_id,
      'out', v_quantity, v_purchase_line.buy_price, v_line_total,
      CASE WHEN v_stock_mode = 'restock' THEN 'purchase_return' ELSE 'purchase_return_write_off' END,
      'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET paid_amount = GREATEST(COALESCE(paid_amount, 0), 0),
        due_amount = GREATEST(COALESCE(due_amount, 0) - v_total, 0),
        payment_status = CASE
          WHEN GREATEST(COALESCE(due_amount, 0) - v_total, 0) <= 0 THEN 'paid'
          WHEN GREATEST(COALESCE(paid_amount, 0), 0) > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE id = v_purchase.id;

    INSERT INTO public.pharmacy_financial_movements (
      pharmacy_id, branch_id, type, category, amount, direction,
      source_table, source_id, description, movement_date, created_by
    )
    VALUES (
      p_pharmacy_id, v_purchase.branch_id, 'purchase_return', 'supplier_refund',
      v_total, 'in', 'pharmacy_purchase_returns', v_return.id,
      'مرتجع مشتريات للفاتورة ' || v_purchase.purchase_number, now(), v_actor_id
    );
  END IF;

  RETURN jsonb_build_object(
    'return', to_jsonb(v_return),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(return_line) ORDER BY return_line.id)
      FROM public.pharmacy_purchase_return_lines return_line
      WHERE return_line.return_id = v_return.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;


-- ===================================================================
-- 8. void_purchase_return
-- Source: 20260618009000_atomic_purchase_returns_rpc.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.void_purchase_return(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_line public.pharmacy_purchase_return_lines%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء مرتجعات المشتريات';
  END IF;

  SELECT * INTO v_return
  FROM public.pharmacy_purchase_returns
  WHERE id = p_return_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'مرتجع الشراء غير موجود';
  END IF;

  IF v_return.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'return', to_jsonb(v_return));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_return.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع المرتجع';
  END IF;

  IF v_return.purchase_id IS NOT NULL THEN
    SELECT * INTO v_purchase
    FROM public.pharmacy_purchases
    WHERE id = v_return.purchase_id AND pharmacy_id = p_pharmacy_id
    FOR UPDATE;
  END IF;

  FOR v_line IN
    SELECT * FROM public.pharmacy_purchase_return_lines
    WHERE return_id = p_return_id AND pharmacy_id = p_pharmacy_id
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id AND pharmacy_id = p_pharmacy_id;

    IF v_return.stock_mode = 'restock' THEN
      IF FOUND AND v_item.manage_inventory THEN
        UPDATE public.pharmacy_stock_balances
        SET quantity = quantity + v_line.quantity,
            updated_at = now()
        WHERE pharmacy_id = p_pharmacy_id
          AND branch_id = v_return.branch_id
          AND item_id = v_line.item_id;
      END IF;

      IF v_line.batch_id IS NOT NULL THEN
        UPDATE public.pharmacy_item_batches
        SET remaining_quantity = remaining_quantity + v_line.quantity,
            updated_at = now()
        WHERE id = v_line.batch_id AND pharmacy_id = p_pharmacy_id;
      END IF;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_return.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.buy_price, v_line.total,
      'purchase_return_void', 'pharmacy_purchase_returns', v_return.id, v_actor_id
    );
  END LOOP;

  IF v_purchase.id IS NOT NULL AND v_return.total > 0 THEN
    UPDATE public.pharmacy_purchases
    SET due_amount = COALESCE(due_amount, 0) + v_return.total,
        payment_status = CASE
          WHEN COALESCE(due_amount, 0) + v_return.total > 0 THEN 'unpaid'
          ELSE payment_status
        END,
        updated_at = now()
    WHERE id = v_purchase.id;
  END IF;

  UPDATE public.pharmacy_purchase_returns
  SET voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء مرتجع شراء'),
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_return;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'return', to_jsonb(v_return));
END;
$$;

REVOKE ALL ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_purchase_return(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;


-- ===================================================================
-- 9. complete_stock_transfer
-- Source: 20260618012000_operational_p2_transfers_counts_sync.sql
-- ===================================================================

CREATE OR REPLACE FUNCTION public.complete_stock_transfer(
  p_pharmacy_id UUID,
  p_transfer_id UUID,
  p_actor_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.pharmacy_stock_transfers%ROWTYPE;
  v_line JSONB;
  v_item public.pharmacy_items%ROWTYPE;
  v_item_id UUID;
  v_qty NUMERIC;
  v_unit TEXT;
  v_remaining NUMERIC;
  v_moved_count INT := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:transfer.write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد التحويل المخزني';
  END IF;

  SELECT * INTO v_transfer
  FROM public.pharmacy_stock_transfers
  WHERE id = p_transfer_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود';
  END IF;

  IF v_transfer.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'duplicate', true);
  END IF;

  IF v_transfer.status IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ تحويل ملغي';
  END IF;

  IF v_transfer.from_branch_id = v_transfer.to_branch_id THEN
    RAISE EXCEPTION 'فرع المصدر والوجهة متطابقان';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches b
    WHERE b.pharmacy_id = p_pharmacy_id
      AND b.id IN (v_transfer.from_branch_id, v_transfer.to_branch_id)
    GROUP BY b.pharmacy_id
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'فروع التحويل لا تتبع نفس الصيدلية';
  END IF;

  IF jsonb_typeof(COALESCE(v_transfer.lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_transfer.lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'التحويل لا يحتوي على أصناف';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_transfer.lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::NUMERIC, 0);
    v_unit := NULLIF(BTRIM(COALESCE(v_line->>'unit', '')), '');

    IF v_item_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات أحد أصناف التحويل غير صحيحة';
    END IF;

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_item_id AND pharmacy_id = p_pharmacy_id AND status <> 'deleted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود داخل التحويل';
    END IF;

    IF COALESCE(v_item.manage_inventory, true) THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_qty,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND item_id = v_item_id
        AND branch_id = v_transfer.from_branch_id
        AND quantity >= v_qty
      RETURNING quantity INTO v_remaining;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'كمية غير كافية للصنف: %', v_item.name_ar;
      END IF;

      INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
      VALUES (p_pharmacy_id, v_item_id, v_transfer.to_branch_id, v_qty, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
                    updated_at = now();

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, item_id, batch_id, branch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      ) VALUES
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.from_branch_id, 'out', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_out', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      ),
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.to_branch_id, 'in', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_in', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      );

      v_moved_count := v_moved_count + 1;
    END IF;
  END LOOP;

  UPDATE public.pharmacy_stock_transfers
  SET status = 'completed',
      notes = CASE
        WHEN NULLIF(BTRIM(COALESCE(p_notes, '')), '') IS NULL THEN notes
        WHEN NULLIF(BTRIM(COALESCE(notes, '')), '') IS NULL THEN BTRIM(p_notes)
        ELSE notes || E'\n' || BTRIM(p_notes)
      END,
      updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'moved_lines', v_moved_count);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===================================================================
-- 10. approve_stock_count_variance (FINAL version)
-- Source: 20260618012000_operational_p2_transfers_counts_sync.sql
-- This is the FINAL version that supersedes 20260618010000.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.approve_stock_count_variance(
  p_pharmacy_id UUID,
  p_count_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_count public.pharmacy_stock_counts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_current_qty NUMERIC := 0;
  v_variance NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:stocktake', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد الجرد';
  END IF;

  SELECT * INTO v_count
  FROM public.pharmacy_stock_counts
  WHERE id = p_count_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الجرد غير موجود';
  END IF;

  IF v_count.status IN ('approved', 'void') THEN
    RAISE EXCEPTION 'سجل الجرد معتمد أو ملغي مسبقاً';
  END IF;

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND COALESCE(v_item.manage_inventory, true) THEN
    SELECT COALESCE(quantity, 0) INTO v_current_qty
    FROM public.pharmacy_stock_balances
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id
    FOR UPDATE;

    v_current_qty := COALESCE(v_current_qty, 0);
    v_variance := COALESCE(v_count.counted_qty, 0) - v_current_qty;

    INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
    VALUES (p_pharmacy_id, v_count.item_id, v_count.branch_id, GREATEST(COALESCE(v_count.counted_qty, 0), 0), now())
    ON CONFLICT (pharmacy_id, item_id, branch_id)
    DO UPDATE SET quantity = GREATEST(COALESCE(v_count.counted_qty, 0), 0), updated_at = now();

    IF v_variance != 0 THEN
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
        CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
        ABS(v_variance), COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * ABS(v_variance),
        'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
      );
    END IF;
  ELSE
    v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      expected_qty = COALESCE(v_current_qty, expected_qty),
      variance = v_variance,
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) TO authenticated, service_role;
