BEGIN;

ALTER TABLE public.pharmacy_shifts
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE public.pharmacy_expenses
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.pharmacy_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_client_request
  ON public.pharmacy_shifts(pharmacy_id,client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_client_request
  ON public.pharmacy_expenses(pharmacy_id,client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_shift
  ON public.pharmacy_expenses(pharmacy_id,shift_id)
  WHERE shift_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.open_cashier_shift_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_opening_balance NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_client_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_shift public.pharmacy_shifts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'sales:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية فتح وردية الكاشير';
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id,p_branch_id,v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على الفرع';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_branch_id::TEXT||':'||v_actor::TEXT||':open-shift',0));

  IF NULLIF(BTRIM(p_client_request_id),'') IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.pharmacy_shifts
    WHERE pharmacy_id=p_pharmacy_id AND client_request_id=BTRIM(p_client_request_id)
    LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('shift',to_jsonb(v_shift),'alreadyOpen',v_shift.status='open','duplicate',true); END IF;
  END IF;

  SELECT * INTO v_shift FROM public.pharmacy_shifts
  WHERE pharmacy_id=p_pharmacy_id AND branch_id=p_branch_id AND user_id=v_actor AND status='open'
  ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('shift',to_jsonb(v_shift),'alreadyOpen',true,'duplicate',true); END IF;

  INSERT INTO public.pharmacy_shifts(
    pharmacy_id,branch_id,user_id,opening_balance,expected_balance,notes,status,client_request_id
  ) VALUES(
    p_pharmacy_id,p_branch_id,v_actor,round(GREATEST(COALESCE(p_opening_balance,0),0),2),
    round(GREATEST(COALESCE(p_opening_balance,0),0),2),NULLIF(BTRIM(p_notes),''),'open',NULLIF(BTRIM(p_client_request_id),'')
  ) RETURNING * INTO v_shift;
  RETURN jsonb_build_object('shift',to_jsonb(v_shift),'alreadyOpen',false,'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cashier_shift_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_closing_balance NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_expected NUMERIC:=0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'sales:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إغلاق وردية الكاشير';
  END IF;
  IF NOT public.has_branch_access(p_pharmacy_id,p_branch_id,v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية على الفرع'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_shift_id::TEXT||':close-shift',0));
  SELECT * INTO v_shift FROM public.pharmacy_shifts
  WHERE id=p_shift_id AND pharmacy_id=p_pharmacy_id AND branch_id=p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'وردية الكاشير غير موجودة'; END IF;
  IF v_shift.user_id<>v_actor AND NOT public.user_has_permission(p_pharmacy_id,'sales:manage',v_actor) THEN
    RAISE EXCEPTION 'لا يمكنك إغلاق وردية مستخدم آخر';
  END IF;
  IF v_shift.status='closed' THEN RETURN jsonb_build_object('shift',to_jsonb(v_shift),'duplicate',true); END IF;

  v_expected:=round(COALESCE(v_shift.opening_balance,0)+COALESCE(v_shift.cash_sales,0)-COALESCE(v_shift.total_expenses,0),2);
  UPDATE public.pharmacy_shifts SET
    status='closed',closed_at=now(),expected_balance=v_expected,
    closing_balance=round(GREATEST(COALESCE(p_closing_balance,0),0),2),
    difference=round(GREATEST(COALESCE(p_closing_balance,0),0)-v_expected,2),
    notes=COALESCE(NULLIF(BTRIM(p_notes),''),notes),updated_at=now()
  WHERE id=v_shift.id RETURNING * INTO v_shift;
  RETURN jsonb_build_object('shift',to_jsonb(v_shift),'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_expense_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_category_name TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT 0,
  p_tax_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_paid_to TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_expense_date TIMESTAMPTZ DEFAULT now(),
  p_client_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_expense public.pharmacy_expenses%ROWTYPE;
  v_category TEXT;
  v_total NUMERIC;
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_journal UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية تسجيل المصروفات'; END IF;
  IF NOT public.has_branch_access(p_pharmacy_id,p_branch_id,v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية على الفرع'; END IF;
  IF NULLIF(BTRIM(p_title),'') IS NULL THEN RAISE EXCEPTION 'أدخل اسم المصروف'; END IF;
  IF COALESCE(p_amount,0)<0 OR COALESCE(p_tax_amount,0)<0 THEN RAISE EXCEPTION 'قيمة المصروف غير صالحة'; END IF;
  v_total:=round(COALESCE(p_amount,0)+COALESCE(p_tax_amount,0),2);
  IF v_total<=0 THEN RAISE EXCEPTION 'قيمة المصروف يجب أن تكون أكبر من صفر'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||COALESCE(NULLIF(BTRIM(p_client_request_id),''),gen_random_uuid()::TEXT)||':expense',0));
  IF NULLIF(BTRIM(p_client_request_id),'') IS NOT NULL THEN
    SELECT * INTO v_expense FROM public.pharmacy_expenses
    WHERE pharmacy_id=p_pharmacy_id AND client_request_id=BTRIM(p_client_request_id) LIMIT 1;
    IF FOUND THEN
      SELECT id INTO v_journal FROM public.pharmacy_journal_entries
      WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_expenses' AND source_id=v_expense.id LIMIT 1;
      RETURN jsonb_build_object('expense',to_jsonb(v_expense),'journal_entry_id',v_journal,'duplicate',true);
    END IF;
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT name INTO v_category FROM public.pharmacy_expense_categories
    WHERE id=p_category_id AND pharmacy_id=p_pharmacy_id;
    IF v_category IS NULL THEN RAISE EXCEPTION 'تصنيف المصروف غير موجود'; END IF;
  ELSE
    v_category:=COALESCE(NULLIF(BTRIM(p_category_name),''),'مصروفات عامة');
  END IF;

  IF LOWER(COALESCE(NULLIF(BTRIM(p_payment_method),''),'cash'))='cash' THEN
    SELECT * INTO v_shift FROM public.pharmacy_shifts
    WHERE pharmacy_id=p_pharmacy_id AND branch_id=p_branch_id AND user_id=v_actor AND status='open'
    ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  INSERT INTO public.pharmacy_expenses(
    pharmacy_id,branch_id,shift_id,category_id,category_name,title,amount,tax_amount,total,payment_method,
    paid_to,notes,expense_date,created_by,client_request_id
  ) VALUES(
    p_pharmacy_id,p_branch_id,v_shift.id,p_category_id,v_category,BTRIM(p_title),round(COALESCE(p_amount,0),2),
    round(COALESCE(p_tax_amount,0),2),v_total,LOWER(COALESCE(NULLIF(BTRIM(p_payment_method),''),'cash')),
    NULLIF(BTRIM(p_paid_to),''),NULLIF(BTRIM(p_notes),''),COALESCE(p_expense_date,now()),v_actor,NULLIF(BTRIM(p_client_request_id),'')
  ) RETURNING * INTO v_expense;

  v_journal:=public.post_expense_accounting_v1(p_pharmacy_id,v_expense.id,v_actor);
  IF v_shift.id IS NOT NULL THEN
    UPDATE public.pharmacy_shifts SET
      total_expenses=COALESCE(total_expenses,0)+v_total,
      expected_balance=COALESCE(opening_balance,0)+COALESCE(cash_sales,0)-(COALESCE(total_expenses,0)+v_total),
      updated_at=now()
    WHERE id=v_shift.id RETURNING * INTO v_shift;
  END IF;
  RETURN jsonb_build_object('expense',to_jsonb(v_expense),'shift',CASE WHEN v_shift.id IS NULL THEN NULL ELSE to_jsonb(v_shift) END,'journal_entry_id',v_journal,'duplicate',false);
END;
$$;

-- Replaces the earlier implementation and also restores the cash drawer when
-- the voided expense belonged to the open/closed cashier shift.
CREATE OR REPLACE FUNCTION public.void_expense_v1(
  p_pharmacy_id UUID,p_expense_id UUID,p_actor_id UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_expense public.pharmacy_expenses%ROWTYPE;
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_journal UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المصروفات'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_expense_id::TEXT||':void-expense',0));
  SELECT * INTO v_expense FROM public.pharmacy_expenses WHERE id=p_expense_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  IF v_expense.voided_at IS NOT NULL THEN RETURN jsonb_build_object('duplicate',true,'expense',to_jsonb(v_expense)); END IF;
  IF v_expense.branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,v_expense.branch_id,v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية على الفرع'; END IF;
  IF v_expense.shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.pharmacy_shifts WHERE id=v_expense.shift_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  END IF;
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
  IF v_shift.id IS NOT NULL AND LOWER(COALESCE(v_expense.payment_method,'cash'))='cash' THEN
    UPDATE public.pharmacy_shifts SET
      total_expenses=GREATEST(COALESCE(total_expenses,0)-v_expense.total,0),
      expected_balance=COALESCE(opening_balance,0)+COALESCE(cash_sales,0)-GREATEST(COALESCE(total_expenses,0)-v_expense.total,0),
      difference=CASE WHEN status='closed' AND closing_balance IS NOT NULL THEN
        closing_balance-(COALESCE(opening_balance,0)+COALESCE(cash_sales,0)-GREATEST(COALESCE(total_expenses,0)-v_expense.total,0))
        ELSE difference END,
      updated_at=now()
    WHERE id=v_shift.id RETURNING * INTO v_shift;
  END IF;
  RETURN jsonb_build_object('duplicate',false,'expense',to_jsonb(v_expense),'shift',CASE WHEN v_shift.id IS NULL THEN NULL ELSE to_jsonb(v_shift) END,'journal_entry_id',v_journal);
END;
$$;

REVOKE ALL ON FUNCTION public.open_cashier_shift_v1(UUID,UUID,UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_cashier_shift_v1(UUID,UUID,UUID,UUID,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expense_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_expense_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_cashier_shift_v1(UUID,UUID,UUID,NUMERIC,TEXT,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_cashier_shift_v1(UUID,UUID,UUID,UUID,NUMERIC,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_expense_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;

COMMIT;
