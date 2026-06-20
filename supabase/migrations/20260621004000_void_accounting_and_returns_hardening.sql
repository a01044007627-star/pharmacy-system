BEGIN;

ALTER TABLE public.pharmacy_purchase_returns
  ADD COLUMN IF NOT EXISTS due_reduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operations_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_operations_finalized_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.reverse_document_journal_v1(
  p_pharmacy_id UUID,
  p_source_table TEXT,
  p_source_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_original public.pharmacy_journal_entries%ROWTYPE;
  v_reversal UUID;
  v_reverse_source TEXT := p_source_table || '_void';
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'sales:void',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'purchases:void',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية عكس القيد المحاسبي';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':' || p_source_table || ':' || p_source_id::TEXT || ':journal-reversal',0));
  SELECT id INTO v_reversal
  FROM public.pharmacy_journal_entries
  WHERE pharmacy_id=p_pharmacy_id AND source_table=v_reverse_source AND source_id=p_source_id
  LIMIT 1;
  IF v_reversal IS NOT NULL THEN RETURN v_reversal; END IF;

  SELECT * INTO v_original
  FROM public.pharmacy_journal_entries
  WHERE pharmacy_id=p_pharmacy_id AND source_table=p_source_table AND source_id=p_source_id
  ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.pharmacy_journal_entries(
    pharmacy_id,branch_id,entry_number,entry_date,reference,description,
    source_table,source_id,total_debit,total_credit,created_by
  ) VALUES (
    p_pharmacy_id,v_original.branch_id,'REV-'||replace(p_source_id::TEXT,'-',''),CURRENT_DATE,
    v_original.reference,'عكس: '||COALESCE(NULLIF(BTRIM(p_reason),''),v_original.description),
    v_reverse_source,p_source_id,v_original.total_credit,v_original.total_debit,v_actor
  ) RETURNING id INTO v_reversal;

  INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
  SELECT p_pharmacy_id,v_reversal,account_id,credit,debit,'عكس: '||COALESCE(description,'')
  FROM public.pharmacy_journal_lines
  WHERE pharmacy_id=p_pharmacy_id AND entry_id=v_original.id;

  RETURN v_reversal;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_sale_void_v1(
  p_pharmacy_id UUID,
  p_sale_id UUID,
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
  v_sale public.pharmacy_sales%ROWTYPE;
  v_journal UUID;
  v_ledger JSONB;
  v_earned INTEGER:=0;
  v_reversed INTEGER:=0;
  v_balance INTEGER:=0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'sales:void',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المبيعات'; END IF;
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE id=p_sale_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع غير موجودة'; END IF;
  IF v_sale.voided_at IS NULL THEN RAISE EXCEPTION 'يجب إلغاء الفاتورة أولاً'; END IF;

  v_journal:=public.reverse_document_journal_v1(p_pharmacy_id,'pharmacy_sales',p_sale_id,v_actor,p_reason);

  IF v_sale.customer_id IS NOT NULL AND COALESCE(v_sale.due_amount,0)>0 THEN
    SELECT public.record_partner_balance_entry_v1(
      p_pharmacy_id,v_sale.branch_id,v_sale.customer_id,'pharmacy_sales_void',p_sale_id,
      'adjustment',-v_sale.due_amount,'إلغاء مديونية فاتورة بيع',v_actor,true
    ) INTO v_ledger;
  END IF;

  IF COALESCE(v_sale.paid_amount,0)>0 AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_sales_void' AND source_id=p_sale_id AND category='sale_void_refund'
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by
    ) VALUES(
      p_pharmacy_id,v_sale.branch_id,'sale_void','sale_void_refund',v_sale.paid_amount,'out','pharmacy_sales_void',p_sale_id,
      'رد تحصيل الفاتورة الملغاة '||v_sale.invoice_number,now(),v_actor
    );
  END IF;

  IF v_sale.customer_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id AND source_table='pharmacy_sales_void' AND source_id=p_sale_id
  ) THEN
    SELECT COALESCE(SUM(points),0) INTO v_earned
    FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id AND type='earn'
      AND source_table='pharmacy_sales' AND source_id=p_sale_id;
    IF v_earned>0 THEN
      SELECT COALESCE(current_balance,0) INTO v_balance
      FROM public.pharmacy_loyalty_balances
      WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id
      FOR UPDATE;
      v_balance:=COALESCE(v_balance,0);
      v_reversed:=LEAST(v_balance,v_earned);
      UPDATE public.pharmacy_loyalty_balances
      SET total_redeemed=total_redeemed+v_reversed,
          current_balance=GREATEST(v_balance-v_reversed,0),updated_at=now()
      WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id;
      v_balance:=GREATEST(v_balance-v_reversed,0);
      INSERT INTO public.pharmacy_loyalty_points(pharmacy_id,partner_id,points,updated_at)
      VALUES(p_pharmacy_id,v_sale.customer_id,v_balance,now())
      ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET points=EXCLUDED.points,updated_at=now();
      INSERT INTO public.pharmacy_loyalty_transactions(
        pharmacy_id,partner_id,type,points,reference,source_table,source_id,balance_after,notes,created_by
      ) VALUES(
        p_pharmacy_id,v_sale.customer_id,'adjust',-v_reversed,v_sale.invoice_number,'pharmacy_sales_void',p_sale_id,
        v_balance,'عكس نقاط فاتورة بيع ملغاة',v_actor
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('journal_entry_id',v_journal,'partner_ledger',v_ledger,'loyalty_reversed',v_reversed);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_purchase_void_v1(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_journal UUID;
  v_ledger JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'purchases:void',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المشتريات'; END IF;
  SELECT * INTO v_purchase FROM public.pharmacy_purchases WHERE id=p_purchase_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  IF v_purchase.voided_at IS NULL THEN RAISE EXCEPTION 'يجب إلغاء الفاتورة أولاً'; END IF;
  v_journal:=public.reverse_document_journal_v1(p_pharmacy_id,'pharmacy_purchases',p_purchase_id,v_actor,p_reason);
  IF v_purchase.supplier_id IS NOT NULL AND COALESCE(v_purchase.due_amount,0)>0 THEN
    SELECT public.record_partner_balance_entry_v1(
      p_pharmacy_id,v_purchase.branch_id,v_purchase.supplier_id,'pharmacy_purchases_void',p_purchase_id,
      'adjustment',-v_purchase.due_amount,'إلغاء مديونية فاتورة شراء',v_actor,false
    ) INTO v_ledger;
  END IF;
  RETURN jsonb_build_object('journal_entry_id',v_journal,'partner_ledger',v_ledger);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_expense_v1(
  p_pharmacy_id UUID,
  p_expense_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_expense public.pharmacy_expenses%ROWTYPE;
  v_journal UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المصروفات'; END IF;
  SELECT * INTO v_expense FROM public.pharmacy_expenses WHERE id=p_expense_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  IF v_expense.voided_at IS NOT NULL THEN RETURN jsonb_build_object('duplicate',true,'expense',to_jsonb(v_expense)); END IF;
  IF v_expense.branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,v_expense.branch_id,v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية على الفرع'; END IF;
  UPDATE public.pharmacy_expenses SET voided_at=now(),voided_by=v_actor,void_reason=COALESCE(NULLIF(BTRIM(p_reason),''),'إلغاء مصروف'),updated_at=now()
  WHERE id=p_expense_id RETURNING * INTO v_expense;
  v_journal:=public.reverse_document_journal_v1(p_pharmacy_id,'pharmacy_expenses',p_expense_id,v_actor,p_reason);
  IF COALESCE(v_expense.total,0)>0 AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_financial_movements WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_expenses_void' AND source_id=p_expense_id
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by
    ) VALUES(
      p_pharmacy_id,v_expense.branch_id,'expense_void','expense_void_refund',v_expense.total,'in','pharmacy_expenses_void',p_expense_id,
      'عكس المصروف الملغى '||v_expense.title,now(),v_actor
    );
  END IF;
  RETURN jsonb_build_object('duplicate',false,'expense',to_jsonb(v_expense),'journal_entry_id',v_journal);
END;
$$;

-- Correct purchase-return settlement: the refund part must not reduce supplier credit.
CREATE OR REPLACE FUNCTION public.finalize_purchase_return_partner_v1(
  p_pharmacy_id UUID,p_return_id UUID,p_actor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_prior_due_reduction NUMERIC:=0;
  v_original_due NUMERIC:=0;
  v_available_due NUMERIC:=0;
  v_due_reduction NUMERIC:=0;
  v_refund NUMERIC:=0;
  v_ledger JSONB;
BEGIN
  SELECT * INTO v_return FROM public.pharmacy_purchase_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المشتريات غير موجود'; END IF;
  IF v_return.operations_finalized_at IS NOT NULL THEN
    RETURN jsonb_build_object('supplier_id',v_return.supplier_id,'due_reduction',v_return.due_reduction,'refund_amount',v_return.refund_amount,'duplicate',true);
  END IF;
  SELECT * INTO v_purchase FROM public.pharmacy_purchases WHERE id=v_return.purchase_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء الأصلية غير موجودة'; END IF;
  SELECT COALESCE(SUM(due_reduction),0) INTO v_prior_due_reduction
  FROM public.pharmacy_purchase_returns
  WHERE pharmacy_id=p_pharmacy_id AND purchase_id=v_purchase.id AND id<>p_return_id AND voided_at IS NULL
    AND operations_finalized_at IS NOT NULL AND created_at<=v_return.created_at;
  v_original_due:=GREATEST(COALESCE(v_purchase.total,0)-COALESCE(v_purchase.paid_amount,0),0);
  v_available_due:=GREATEST(v_original_due-v_prior_due_reduction,0);
  v_due_reduction:=LEAST(COALESCE(v_return.total,0),v_available_due);
  v_refund:=GREATEST(COALESCE(v_return.total,0)-v_due_reduction,0);

  -- The legacy RPC reduced due by the whole return. Add the cash-refund part back.
  IF v_refund>0 THEN
    UPDATE public.pharmacy_purchases
    SET due_amount=GREATEST(COALESCE(due_amount,0)+v_refund,0),
        payment_status=CASE WHEN GREATEST(COALESCE(due_amount,0)+v_refund,0)<=0 THEN 'paid' WHEN COALESCE(paid_amount,0)>0 THEN 'partial' ELSE 'unpaid' END,
        updated_at=now()
    WHERE id=v_purchase.id AND pharmacy_id=p_pharmacy_id;
  END IF;

  UPDATE public.pharmacy_purchase_returns
  SET supplier_id=v_purchase.supplier_id,refund_amount=v_refund,due_reduction=v_due_reduction,operations_finalized_at=now(),updated_at=now()
  WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id RETURNING * INTO v_return;

  IF v_refund>0 THEN
    UPDATE public.pharmacy_financial_movements SET amount=v_refund,description='مبلغ مسترد من المورد عن '||v_return.return_number
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchase_returns' AND source_id=p_return_id AND category='supplier_refund';
  ELSE
    DELETE FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchase_returns' AND source_id=p_return_id AND category='supplier_refund';
  END IF;
  IF v_purchase.supplier_id IS NOT NULL AND v_due_reduction>0 THEN
    SELECT public.record_partner_balance_entry_v1(p_pharmacy_id,v_return.branch_id,v_purchase.supplier_id,
      'pharmacy_purchase_returns',p_return_id,'return',-v_due_reduction,'تخفيض مديونية المورد بمرتجع مشتريات',p_actor_id,true) INTO v_ledger;
  END IF;
  RETURN jsonb_build_object('supplier_id',v_purchase.supplier_id,'due_reduction',v_due_reduction,'refund_amount',v_refund,'ledger',v_ledger,'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_purchase_return_void_v1(
  p_pharmacy_id UUID,p_return_id UUID,p_actor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_ledger JSONB;
  v_journal UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'purchases:void',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إلغاء مرتجعات المشتريات'; END IF;
  SELECT * INTO v_return FROM public.pharmacy_purchase_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المشتريات غير موجود'; END IF;
  IF v_return.voided_at IS NULL THEN RAISE EXCEPTION 'يجب إلغاء المرتجع أولاً'; END IF;
  IF v_return.void_operations_finalized_at IS NOT NULL THEN RETURN jsonb_build_object('duplicate',true); END IF;
  SELECT * INTO v_purchase FROM public.pharmacy_purchases WHERE id=v_return.purchase_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء الأصلية غير موجودة'; END IF;

  -- Legacy void added total; remove the refund portion so only the original credit is restored.
  IF COALESCE(v_return.refund_amount,0)>0 THEN
    UPDATE public.pharmacy_purchases
    SET due_amount=GREATEST(COALESCE(due_amount,0)-v_return.refund_amount,0),
        payment_status=CASE WHEN GREATEST(COALESCE(due_amount,0)-v_return.refund_amount,0)<=0 THEN 'paid' WHEN COALESCE(paid_amount,0)>0 THEN 'partial' ELSE 'unpaid' END,
        updated_at=now()
    WHERE id=v_purchase.id AND pharmacy_id=p_pharmacy_id;
    IF NOT EXISTS(SELECT 1 FROM public.pharmacy_financial_movements WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchase_returns_void' AND source_id=p_return_id) THEN
      INSERT INTO public.pharmacy_financial_movements(pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by)
      VALUES(p_pharmacy_id,v_return.branch_id,'purchase_return_void','supplier_refund_reversal',v_return.refund_amount,'out','pharmacy_purchase_returns_void',p_return_id,'عكس مبلغ مرتجع المورد '||v_return.return_number,now(),v_actor);
    END IF;
  END IF;
  IF v_return.supplier_id IS NOT NULL AND COALESCE(v_return.due_reduction,0)>0 THEN
    SELECT public.record_partner_balance_entry_v1(p_pharmacy_id,v_return.branch_id,v_return.supplier_id,
      'pharmacy_purchase_returns_void',p_return_id,'adjustment',v_return.due_reduction,'عكس تخفيض مديونية المورد',v_actor,true) INTO v_ledger;
  END IF;
  v_journal:=public.reverse_document_journal_v1(p_pharmacy_id,'pharmacy_purchase_returns',p_return_id,v_actor,'إلغاء مرتجع مشتريات');
  UPDATE public.pharmacy_purchase_returns SET void_operations_finalized_at=now(),updated_at=now() WHERE id=p_return_id;
  RETURN jsonb_build_object('duplicate',false,'partner_ledger',v_ledger,'journal_entry_id',v_journal);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_document_journal_v1(UUID,TEXT,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_sale_void_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_purchase_void_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_expense_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_purchase_return_void_v1(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_document_journal_v1(UUID,TEXT,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_sale_void_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_purchase_void_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_expense_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_purchase_return_void_v1(UUID,UUID,UUID) TO authenticated,service_role;

COMMIT;
