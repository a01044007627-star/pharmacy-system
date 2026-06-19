-- Atomic invoice-linked sales returns.
-- Returns are tied to the original sale line and batch so quantities cannot be
-- returned twice and batch stock is restored accurately.

ALTER TABLE public.pharmacy_sales_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_sales_return_lines
  ADD COLUMN IF NOT EXISTS sale_line_id UUID REFERENCES public.pharmacy_sale_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_client_request
  ON public.pharmacy_sales_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_sale_line
  ON public.pharmacy_sales_return_lines(pharmacy_id, sale_line_id);

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

  -- Validate all requested quantities under row locks and calculate the net
  -- value from the original discounted sale line.
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

  -- The return settles outstanding credit first. Only the remaining value is
  -- refunded, preventing cash refunds against unpaid invoice value.
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
