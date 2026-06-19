-- Atomic received purchase invoices:
-- invoice + lines + batches + stock + supplier balance + financial movement.

ALTER TABLE public.pharmacy_purchases
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_purchase_lines
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS batch_number TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_client_request
  ON public.pharmacy_purchases(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase
  ON public.pharmacy_purchase_lines(pharmacy_id, purchase_id, created_at);

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

  -- Validate availability first so the whole cancellation fails before any
  -- mutation if stock from this receipt has already been consumed.
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
