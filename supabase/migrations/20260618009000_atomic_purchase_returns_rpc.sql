-- Atomic purchase returns RPCs.
-- Mirrors the sales return pattern but adapted for purchase invoices.
-- Returns deduct stock (or write-off), update batch remaining quantity,
-- settle supplier balance, and record financial movements in one transaction.

ALTER TABLE public.pharmacy_purchase_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.pharmacy_purchase_return_lines
  ADD COLUMN IF NOT EXISTS purchase_line_id UUID REFERENCES public.pharmacy_purchase_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_returns_client_request
  ON public.pharmacy_purchase_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_purchase_line
  ON public.pharmacy_purchase_return_lines(pharmacy_id, purchase_line_id);

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
