BEGIN;

-- One durable receipt record per client request protects stock, accounting and
-- order progress from duplicate submissions caused by retries or unstable networks.
CREATE TABLE IF NOT EXISTS public.pharmacy_purchase_order_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.pharmacy_purchase_orders(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES public.pharmacy_purchases(id) ON DELETE RESTRICT,
  client_request_id TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS pharmacy_purchase_order_receipts_order_idx
  ON public.pharmacy_purchase_order_receipts(pharmacy_id, order_id, created_at DESC);

ALTER TABLE public.pharmacy_purchase_order_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pharmacy_purchase_order_receipts FROM anon, authenticated;
GRANT ALL ON TABLE public.pharmacy_purchase_order_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_complete_v1(
  p_pharmacy_id UUID,
  p_order_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_paid_amount NUMERIC,
  p_payment_method TEXT,
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
  v_order public.pharmacy_purchase_orders%ROWTYPE;
  v_receipt public.pharmacy_purchase_order_receipts%ROWTYPE;
  v_existing_purchase public.pharmacy_purchases%ROWTYPE;
  v_received JSONB;
  v_order_line JSONB;
  v_updated_lines JSONB;
  v_purchase_result JSONB;
  v_purchase_id UUID;
  v_item_id UUID;
  v_received_qty NUMERIC;
  v_ordered_qty NUMERIC;
  v_already_received NUMERIC;
  v_quantity_mode TEXT;
  v_unit_name TEXT;
  v_all_received BOOLEAN := false;
  v_receipt_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'purchases:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية استلام أوامر الشراء';
  END IF;
  IF p_client_request_id IS NULL OR length(btrim(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية الاستلام غير صالح';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفًا واحدًا على الأقل للاستلام';
  END IF;

  SELECT * INTO v_order
  FROM public.pharmacy_purchase_orders
  WHERE id = p_order_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء غير موجود'; END IF;

  -- A committed record means the exact request was already completed. Returning
  -- its result is safe and avoids adding quantities a second time.
  SELECT * INTO v_receipt
  FROM public.pharmacy_purchase_order_receipts
  WHERE pharmacy_id = p_pharmacy_id AND client_request_id = p_client_request_id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.order_id <> p_order_id THEN
      RAISE EXCEPTION 'معرف طلب الاستلام مستخدم مسبقًا لأمر شراء مختلف';
    END IF;
    IF v_receipt.purchase_id IS NULL THEN
      RAISE EXCEPTION 'عملية الاستلام السابقة لم تكتمل بصورة صحيحة';
    END IF;
    SELECT * INTO v_existing_purchase
    FROM public.pharmacy_purchases
    WHERE id = v_receipt.purchase_id AND pharmacy_id = p_pharmacy_id;
    RETURN jsonb_build_object(
      'order', to_jsonb(v_order),
      'purchase_result', jsonb_build_object(
        'duplicate', true,
        'purchase', CASE WHEN v_existing_purchase.id IS NULL THEN NULL ELSE to_jsonb(v_existing_purchase) END
      ),
      'complete', v_order.status = 'received',
      'duplicate', true
    );
  END IF;

  IF v_order.branch_id IS NULL THEN RAISE EXCEPTION 'أمر الشراء غير مرتبط بفرع مستلم'; END IF;
  IF v_order.status NOT IN ('sent','partial') THEN
    RAISE EXCEPTION 'لا يمكن الاستلام من حالة أمر الشراء الحالية';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) AS received(value)
    GROUP BY received.value->>'item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار الصنف داخل دفعة الاستلام';
  END IF;

  FOR v_received IN SELECT value FROM jsonb_array_elements(p_lines) AS received(value)
  LOOP
    BEGIN
      v_item_id := NULLIF(v_received->>'item_id','')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'معرف صنف غير صالح داخل دفعة الاستلام';
    END;
    v_received_qty := COALESCE((v_received->>'quantity')::NUMERIC,0);
    IF v_item_id IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'كمية الاستلام يجب أن تكون أكبر من صفر';
    END IF;

    SELECT value INTO v_order_line
    FROM jsonb_array_elements(v_order.lines) AS ordered(value)
    WHERE ordered.value->>'item_id' = v_item_id::TEXT
    LIMIT 1;
    IF v_order_line IS NULL THEN RAISE EXCEPTION 'الصنف غير موجود داخل أمر الشراء'; END IF;

    v_ordered_qty := COALESCE((v_order_line->>'quantity')::NUMERIC,0);
    v_already_received := COALESCE((v_order_line->>'received_quantity')::NUMERIC,0);
    IF v_already_received + v_received_qty > v_ordered_qty THEN
      RAISE EXCEPTION 'الكمية المستلمة تتجاوز الكمية المتبقية للصنف %', COALESCE(v_order_line->>'item_name',v_item_id::TEXT);
    END IF;

    v_unit_name := COALESCE(NULLIF(btrim(v_received->>'unit'),''), NULLIF(btrim(v_order_line->>'unit'),''), 'وحدة');
    SELECT quantity_mode INTO v_quantity_mode
    FROM public.pharmacy_item_units
    WHERE pharmacy_id = p_pharmacy_id
      AND item_id = v_item_id
      AND (lower(trim(unit_name)) = lower(trim(v_unit_name)) OR is_base = true)
    ORDER BY (lower(trim(unit_name)) = lower(trim(v_unit_name))) DESC, is_base DESC, factor ASC
    LIMIT 1;
    v_quantity_mode := COALESCE(v_quantity_mode, CASE
      WHEN lower(trim(v_unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN 'continuous'
      ELSE 'discrete'
    END);
    IF v_quantity_mode = 'discrete' AND v_received_qty <> trunc(v_received_qty) THEN
      RAISE EXCEPTION 'الوحدة المعدودة لا تقبل كمية كسرية للصنف %', COALESCE(v_order_line->>'item_name',v_item_id::TEXT);
    END IF;
  END LOOP;

  -- Reserve the idempotency key before invoking the purchase operation. The row
  -- lives in the same transaction and is rolled back if any later step fails.
  BEGIN
    INSERT INTO public.pharmacy_purchase_order_receipts(
      pharmacy_id, order_id, purchase_id, client_request_id, lines, created_by
    ) VALUES (
      p_pharmacy_id, p_order_id, NULL, p_client_request_id, p_lines, v_actor_id
    )
    RETURNING * INTO v_receipt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'معرف طلب الاستلام مستخدم مسبقًا';
  END;

  SELECT COALESCE(jsonb_agg(
    ordered.value || jsonb_build_object(
      'received_quantity',
      COALESCE((ordered.value->>'received_quantity')::NUMERIC,0) + COALESCE((
        SELECT sum((received.value->>'quantity')::NUMERIC)
        FROM jsonb_array_elements(p_lines) AS received(value)
        WHERE received.value->>'item_id' = ordered.value->>'item_id'
      ),0)
    ) ORDER BY ordered.ordinality
  ), '[]'::JSONB)
  INTO v_updated_lines
  FROM jsonb_array_elements(v_order.lines) WITH ORDINALITY AS ordered(value, ordinality);

  v_purchase_result := public.create_received_purchase_complete_v1(
    p_pharmacy_id,
    v_order.branch_id,
    v_actor_id,
    p_client_request_id,
    v_order.supplier_id,
    v_order.supplier_name,
    COALESCE(NULLIF(btrim(p_payment_method),''),'cash'),
    GREATEST(COALESCE(p_paid_amount,0),0),
    GREATEST(COALESCE(p_header_discount,0),0),
    GREATEST(COALESCE(p_tax_total,0),0),
    GREATEST(COALESCE(p_shipping_fee,0),0),
    COALESCE(NULLIF(btrim(p_notes),''),'استلام من أمر شراء ' || COALESCE(v_order.order_number,v_order.id::TEXT)),
    COALESCE(p_purchase_date,now()),
    p_lines
  );

  BEGIN
    v_purchase_id := NULLIF(v_purchase_result->'purchase'->>'id','')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_purchase_id := NULL;
  END;
  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'تعذر ربط عملية الاستلام بفاتورة الشراء';
  END IF;

  UPDATE public.pharmacy_purchase_order_receipts
  SET purchase_id = v_purchase_id, lines = p_lines
  WHERE id = v_receipt.id;

  SELECT COALESCE(bool_and(
    COALESCE((line.value->>'received_quantity')::NUMERIC,0) >= COALESCE((line.value->>'quantity')::NUMERIC,0)
  ),false)
  INTO v_all_received
  FROM jsonb_array_elements(v_updated_lines) AS line(value);

  v_receipt_paid := GREATEST(COALESCE((v_purchase_result->'purchase'->>'paid_amount')::NUMERIC,0),0);
  UPDATE public.pharmacy_purchase_orders
  SET lines = v_updated_lines,
      status = CASE WHEN v_all_received THEN 'received' ELSE 'partial' END,
      paid_amount = LEAST(total, COALESCE(paid_amount,0) + v_receipt_paid),
      due_amount = GREATEST(total - LEAST(total, COALESCE(paid_amount,0) + v_receipt_paid),0),
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'order', to_jsonb(v_order),
    'purchase_result', v_purchase_result,
    'complete', v_all_received,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order_complete_v1(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_complete_v1(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
