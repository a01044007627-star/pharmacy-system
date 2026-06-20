BEGIN;

ALTER TABLE public.pharmacy_sales_returns
  ADD COLUMN IF NOT EXISTS due_reduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS void_operations_finalized_at TIMESTAMPTZ;

UPDATE public.pharmacy_sales_returns
SET due_reduction = GREATEST(COALESCE(total,0)-COALESCE(refund_amount,0),0)
WHERE due_reduction = 0 AND COALESCE(total,0) > COALESCE(refund_amount,0);

CREATE OR REPLACE FUNCTION public.void_sales_return_v1(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(),p_actor_id);
  v_return public.pharmacy_sales_returns%ROWTYPE;
  v_sale public.pharmacy_sales%ROWTYPE;
  v_line RECORD;
  v_item public.pharmacy_items%ROWTYPE;
  v_stock NUMERIC := 0;
  v_batch_qty NUMERIC := 0;
  v_due_reduction NUMERIC := 0;
  v_cash_restore NUMERIC := 0;
  v_card_restore NUMERIC := 0;
  v_points INTEGER := 0;
  v_balance INTEGER := 0;
  v_journal UUID;
  v_ledger JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'sales:void',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء مرتجعات المبيعات';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_return_id::TEXT||':sales-return-void',0));
  SELECT * INTO v_return
  FROM public.pharmacy_sales_returns
  WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المبيعات غير موجود'; END IF;
  IF v_return.voided_at IS NOT NULL AND v_return.void_operations_finalized_at IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate',true,'return',to_jsonb(v_return));
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id,v_return.branch_id,v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع المرتجع';
  END IF;

  SELECT * INTO v_sale
  FROM public.pharmacy_sales
  WHERE id=v_return.sale_id AND pharmacy_id=p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع الأصلية غير موجودة'; END IF;
  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء المرتجع بعد إلغاء فاتورة البيع الأصلية';
  END IF;

  v_due_reduction := GREATEST(COALESCE(NULLIF(v_return.due_reduction,0),v_return.total-v_return.refund_amount),0);

  -- Validate all stock first, then reverse it atomically. This avoids partial
  -- reversal when returned stock has already been sold again.
  FOR v_line IN
    SELECT rl.*,sl.item_name
    FROM public.pharmacy_sales_return_lines rl
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id AND sl.pharmacy_id=rl.pharmacy_id
    WHERE rl.pharmacy_id=p_pharmacy_id AND rl.return_id=p_return_id
    FOR UPDATE OF rl
  LOOP
    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id=v_line.item_id AND pharmacy_id=p_pharmacy_id;

    IF FOUND AND COALESCE(v_item.manage_inventory,true) THEN
      v_stock := 0;
      SELECT COALESCE(quantity,0) INTO v_stock
      FROM public.pharmacy_stock_balances
      WHERE pharmacy_id=p_pharmacy_id AND branch_id=v_return.branch_id AND item_id=v_line.item_id
      FOR UPDATE;
      IF COALESCE(v_stock,0) < v_line.quantity THEN
        RAISE EXCEPTION 'لا يمكن إلغاء المرتجع لأن مخزون الصنف % أقل من الكمية التي ستُسحب',COALESCE(v_line.item_name,'');
      END IF;
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      v_batch_qty := 0;
      SELECT COALESCE(remaining_quantity,0) INTO v_batch_qty
      FROM public.pharmacy_item_batches
      WHERE id=v_line.batch_id AND pharmacy_id=p_pharmacy_id
      FOR UPDATE;
      IF COALESCE(v_batch_qty,0) < v_line.quantity THEN
        RAISE EXCEPTION 'لا يمكن إلغاء المرتجع لأن رصيد التشغيلة غير كافٍ للصنف %',COALESCE(v_line.item_name,'');
      END IF;
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT rl.*,sl.item_name
    FROM public.pharmacy_sales_return_lines rl
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id AND sl.pharmacy_id=rl.pharmacy_id
    WHERE rl.pharmacy_id=p_pharmacy_id AND rl.return_id=p_return_id
  LOOP
    SELECT * INTO v_item FROM public.pharmacy_items WHERE id=v_line.item_id AND pharmacy_id=p_pharmacy_id;
    IF FOUND AND COALESCE(v_item.manage_inventory,true) THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity=GREATEST(COALESCE(quantity,0)-v_line.quantity,0),updated_at=now()
      WHERE pharmacy_id=p_pharmacy_id AND branch_id=v_return.branch_id AND item_id=v_line.item_id;
    END IF;
    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity=GREATEST(COALESCE(remaining_quantity,0)-v_line.quantity,0),updated_at=now()
      WHERE id=v_line.batch_id AND pharmacy_id=p_pharmacy_id;
    END IF;
    INSERT INTO public.pharmacy_stock_movements(
      pharmacy_id,branch_id,item_id,batch_id,direction,quantity,unit_price,total_value,
      movement_type,source_table,source_id,created_by
    ) VALUES(
      p_pharmacy_id,v_return.branch_id,v_line.item_id,v_line.batch_id,'out',v_line.quantity,
      v_line.unit_price,v_line.total,'sales_return_void','pharmacy_sales_returns_void',p_return_id,v_actor
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET paid_amount=COALESCE(paid_amount,0)+COALESCE(v_return.refund_amount,0),
      due_amount=COALESCE(due_amount,0)+v_due_reduction,
      payment_status=CASE
        WHEN COALESCE(due_amount,0)+v_due_reduction<=0 THEN 'paid'
        WHEN COALESCE(paid_amount,0)+COALESCE(v_return.refund_amount,0)>0 THEN 'partial'
        ELSE 'unpaid'
      END,
      updated_at=now()
  WHERE id=v_sale.id AND pharmacy_id=p_pharmacy_id
  RETURNING * INTO v_sale;

  v_cash_restore := CASE WHEN v_sale.payment_method='cash' THEN COALESCE(v_return.refund_amount,0) ELSE 0 END;
  v_card_restore := CASE WHEN v_sale.payment_method IN ('card','wallet','mixed') THEN COALESCE(v_return.refund_amount,0) ELSE 0 END;
  IF v_sale.shift_id IS NOT NULL AND COALESCE(v_return.refund_amount,0)>0 THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales=COALESCE(cash_sales,0)+v_cash_restore,
        card_sales=COALESCE(card_sales,0)+v_card_restore,
        total_collected=COALESCE(total_collected,0)+COALESCE(v_return.refund_amount,0),
        expected_balance=COALESCE(opening_balance,0)+COALESCE(cash_sales,0)+v_cash_restore-COALESCE(total_expenses,0),
        difference=CASE WHEN status='closed' AND closing_balance IS NOT NULL
          THEN closing_balance-(COALESCE(opening_balance,0)+COALESCE(cash_sales,0)+v_cash_restore-COALESCE(total_expenses,0))
          ELSE difference END,
        updated_at=now()
    WHERE id=v_sale.shift_id AND pharmacy_id=p_pharmacy_id;
  END IF;

  IF COALESCE(v_return.refund_amount,0)>0 AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_sales_returns_void' AND source_id=p_return_id
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by
    ) VALUES(
      p_pharmacy_id,v_return.branch_id,'sales_return_void','customer_refund_reversal',v_return.refund_amount,'in',
      'pharmacy_sales_returns_void',p_return_id,'عكس رد قيمة المرتجع '||v_return.return_number,now(),v_actor
    );
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_due_reduction>0 THEN
    SELECT public.record_partner_balance_entry_v1(
      p_pharmacy_id,v_return.branch_id,v_sale.customer_id,'pharmacy_sales_returns_void',p_return_id,
      'charge',v_due_reduction,'عكس تخفيض مديونية العميل بسبب إلغاء المرتجع',v_actor,true
    ) INTO v_ledger;
  END IF;

  IF v_sale.customer_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id
      AND source_table='pharmacy_sales_returns_void' AND source_id=p_return_id
  ) THEN
    SELECT COALESCE(ABS(SUM(points)),0)::INTEGER INTO v_points
    FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id
      AND source_table='pharmacy_sales_returns' AND source_id=p_return_id AND points<0;
    IF v_points>0 THEN
      INSERT INTO public.pharmacy_loyalty_balances(pharmacy_id,partner_id,total_earned,total_redeemed,current_balance,updated_at)
      VALUES(p_pharmacy_id,v_sale.customer_id,v_points,0,v_points,now())
      ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET
        total_redeemed=GREATEST(public.pharmacy_loyalty_balances.total_redeemed-v_points,0),
        current_balance=public.pharmacy_loyalty_balances.current_balance+v_points,
        updated_at=now()
      RETURNING current_balance INTO v_balance;
      INSERT INTO public.pharmacy_loyalty_points(pharmacy_id,partner_id,points,updated_at)
      VALUES(p_pharmacy_id,v_sale.customer_id,v_balance,now())
      ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET points=EXCLUDED.points,updated_at=now();
      INSERT INTO public.pharmacy_loyalty_transactions(
        pharmacy_id,partner_id,type,points,reference,source_table,source_id,balance_after,notes,created_by
      ) VALUES(
        p_pharmacy_id,v_sale.customer_id,'adjust',v_points,v_return.return_number,
        'pharmacy_sales_returns_void',p_return_id,v_balance,'إعادة نقاط بعد إلغاء مرتجع مبيعات',v_actor
      );
    END IF;
  END IF;

  IF v_sale.patient_id IS NOT NULL THEN
    DELETE FROM public.pharmacy_patient_visits
    WHERE pharmacy_id=p_pharmacy_id AND patient_id=v_sale.patient_id
      AND visit_type='sale_return' AND reference_table='pharmacy_sales_returns' AND reference_id=p_return_id;
    UPDATE public.pharmacy_patients
    SET total_purchases=COALESCE(total_purchases,0)+COALESCE(v_return.total,0),updated_at=now()
    WHERE id=v_sale.patient_id AND pharmacy_id=p_pharmacy_id;
  END IF;

  v_journal:=public.reverse_document_journal_v1(
    p_pharmacy_id,'pharmacy_sales_returns',p_return_id,v_actor,
    COALESCE(NULLIF(BTRIM(p_reason),''),'إلغاء مرتجع مبيعات')
  );

  UPDATE public.pharmacy_sales_returns
  SET due_reduction=v_due_reduction,
      voided_at=COALESCE(voided_at,now()),voided_by=COALESCE(voided_by,v_actor),
      void_reason=COALESCE(NULLIF(BTRIM(p_reason),''),'إلغاء مرتجع مبيعات'),
      void_operations_finalized_at=now(),updated_at=now()
  WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id
  RETURNING * INTO v_return;

  RETURN jsonb_build_object(
    'duplicate',false,'return',to_jsonb(v_return),'sale',to_jsonb(v_sale),
    'due_restored',v_due_reduction,'refund_reversed',COALESCE(v_return.refund_amount,0),
    'loyalty_restored',v_points,'partner_ledger',v_ledger,'journal_entry_id',v_journal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_sales_return_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_sales_return_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;

COMMIT;
