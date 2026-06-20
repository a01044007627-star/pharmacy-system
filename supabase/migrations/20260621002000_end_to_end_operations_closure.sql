BEGIN;

-- End-to-end operational closure: partner balances, prescriptions, returns and reports.
-- Additive and idempotent: all old data is preserved.

ALTER TABLE public.pharmacy_purchase_returns
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL;
ALTER TABLE public.pharmacy_sales_returns
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.pharmacy_patients(id) ON DELETE SET NULL;
ALTER TABLE public.pharmacy_payments
  ADD COLUMN IF NOT EXISTS client_request_id UUID;
ALTER TABLE public.pharmacy_prescriptions
  ADD COLUMN IF NOT EXISTS prescription_number TEXT,
  ADD COLUMN IF NOT EXISTS patient_record_id UUID REFERENCES public.pharmacy_patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prescription_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_client_request
  ON public.pharmacy_payments(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescriptions_client_request
  ON public.pharmacy_prescriptions(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescriptions_number
  ON public.pharmacy_prescriptions(pharmacy_id, prescription_number)
  WHERE prescription_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier
  ON public.pharmacy_purchase_returns(pharmacy_id, supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer
  ON public.pharmacy_sales_returns(pharmacy_id, customer_id, return_date DESC);

CREATE TABLE IF NOT EXISTS public.pharmacy_partner_balance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  partner_id UUID NOT NULL REFERENCES public.pharmacy_partners(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('opening','charge','settlement','return','adjustment')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, partner_id, source_table, source_id, entry_type)
);
CREATE INDEX IF NOT EXISTS idx_partner_balance_ledger_partner
  ON public.pharmacy_partner_balance_ledger(pharmacy_id, partner_id, created_at DESC);
ALTER TABLE public.pharmacy_partner_balance_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_balance_ledger_select ON public.pharmacy_partner_balance_ledger;
DROP POLICY IF EXISTS partner_balance_ledger_insert ON public.pharmacy_partner_balance_ledger;
CREATE POLICY partner_balance_ledger_select ON public.pharmacy_partner_balance_ledger
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY partner_balance_ledger_insert ON public.pharmacy_partner_balance_ledger
  FOR INSERT WITH CHECK (
    public.user_has_permission(pharmacy_id, 'financials:write')
    OR public.user_has_permission(pharmacy_id, 'crm:write')
  );

CREATE OR REPLACE FUNCTION public.record_partner_balance_entry_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_partner_id UUID,
  p_source_table TEXT,
  p_source_id UUID,
  p_entry_type TEXT,
  p_delta NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_apply_balance BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_partner public.pharmacy_partners%ROWTYPE;
  v_existing public.pharmacy_partner_balance_ledger%ROWTYPE;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'crm:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'sales:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'purchases:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تحديث رصيد جهة الاتصال';
  END IF;
  IF p_partner_id IS NULL OR p_source_id IS NULL OR NULLIF(BTRIM(p_source_table),'') IS NULL THEN
    RAISE EXCEPTION 'بيانات حركة الرصيد غير مكتملة';
  END IF;
  IF p_entry_type NOT IN ('opening','charge','settlement','return','adjustment') THEN
    RAISE EXCEPTION 'نوع حركة الرصيد غير صالح';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_partner_id::TEXT||':partner-balance',0));
  SELECT * INTO v_existing FROM public.pharmacy_partner_balance_ledger
  WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id
    AND source_table=p_source_table AND source_id=p_source_id AND entry_type=p_entry_type
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('duplicate',true,'entry',to_jsonb(v_existing),'balance',v_existing.balance_after);
  END IF;

  SELECT * INTO v_partner FROM public.pharmacy_partners
  WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة الاتصال غير موجودة'; END IF;
  v_before := COALESCE(v_partner.balance,0);
  v_after := CASE WHEN p_apply_balance THEN GREATEST(v_before+COALESCE(p_delta,0),0) ELSE v_before END;
  IF p_apply_balance THEN
    UPDATE public.pharmacy_partners SET balance=v_after,updated_at=now()
    WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id;
  END IF;

  INSERT INTO public.pharmacy_partner_balance_ledger(
    pharmacy_id,branch_id,partner_id,source_table,source_id,entry_type,amount,
    balance_before,balance_after,notes,created_by
  ) VALUES(
    p_pharmacy_id,p_branch_id,p_partner_id,p_source_table,p_source_id,p_entry_type,
    COALESCE(p_delta,0),v_before,v_after,NULLIF(BTRIM(p_notes),''),v_actor
  ) RETURNING * INTO v_existing;
  RETURN jsonb_build_object('duplicate',false,'entry',to_jsonb(v_existing),'balance',v_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_partner_payment_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_partner_id UUID,
  p_actor_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_payment_date TIMESTAMPTZ,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_client_request_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(),p_actor_id);
  v_partner public.pharmacy_partners%ROWTYPE;
  v_payment public.pharmacy_payments%ROWTYPE;
  v_kind TEXT;
  v_direction TEXT;
  v_type TEXT;
  v_amount NUMERIC := round(COALESCE(p_amount,0),2);
  v_balance NUMERIC;
  v_entry UUID;
  v_cash UUID; v_bank UUID; v_receivable UUID; v_payable UUID; v_money UUID;
  v_ledger JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'crm:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل المدفوعات';
  END IF;
  IF v_amount<=0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF p_branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,p_branch_id,v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على الفرع';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_partner_id::TEXT||':payment',0));
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.pharmacy_payments
    WHERE pharmacy_id=p_pharmacy_id AND client_request_id=p_client_request_id LIMIT 1;
    IF FOUND THEN
      SELECT balance INTO v_balance FROM public.pharmacy_partners WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id;
      RETURN jsonb_build_object('duplicate',true,'payment',to_jsonb(v_payment),'balance',COALESCE(v_balance,0));
    END IF;
  END IF;

  SELECT * INTO v_partner FROM public.pharmacy_partners
  WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة الاتصال غير موجودة أو غير نشطة'; END IF;
  v_kind := lower(COALESCE(NULLIF(BTRIM(p_kind),''),CASE WHEN v_partner.type='supplier' THEN 'supplier_payment' ELSE 'customer_receipt' END));
  IF v_kind='supplier_payment' AND v_partner.type NOT IN ('supplier','both') THEN RAISE EXCEPTION 'جهة الاتصال ليست مورداً'; END IF;
  IF v_kind='customer_receipt' AND v_partner.type NOT IN ('customer','both') THEN RAISE EXCEPTION 'جهة الاتصال ليست عميلاً'; END IF;
  IF v_kind NOT IN ('supplier_payment','customer_receipt') THEN RAISE EXCEPTION 'نوع الدفعة غير صالح'; END IF;
  IF v_amount>COALESCE(v_partner.balance,0) THEN RAISE EXCEPTION 'المبلغ أكبر من الرصيد المستحق'; END IF;

  v_direction := CASE WHEN v_kind='supplier_payment' THEN 'out' ELSE 'in' END;
  v_type := CASE WHEN v_kind='supplier_payment' THEN 'purchase' ELSE 'sale' END;
  INSERT INTO public.pharmacy_payments(
    pharmacy_id,branch_id,source_table,source_id,partner_id,type,direction,payment_method,
    amount,reference,notes,payment_date,created_by,client_request_id
  ) VALUES(
    p_pharmacy_id,p_branch_id,'pharmacy_partners',p_partner_id,p_partner_id,v_type,v_direction,
    COALESCE(NULLIF(BTRIM(p_payment_method),''),'cash'),v_amount,NULLIF(BTRIM(p_reference),''),
    NULLIF(BTRIM(p_notes),''),COALESCE(p_payment_date,now()),v_actor,p_client_request_id
  ) RETURNING * INTO v_payment;

  SELECT public.record_partner_balance_entry_v1(
    p_pharmacy_id,p_branch_id,p_partner_id,'pharmacy_payments',v_payment.id,'settlement',-v_amount,
    CASE WHEN v_kind='supplier_payment' THEN 'دفعة للمورد' ELSE 'تحصيل من العميل' END,v_actor,true
  ) INTO v_ledger;
  v_balance := COALESCE((v_ledger->>'balance')::NUMERIC,0);

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_bank FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1020';
  SELECT id INTO v_receivable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1100';
  SELECT id INTO v_payable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='2010';
  v_money := CASE WHEN p_payment_method IN ('card','wallet','bank','bank-transfer','cheque','mixed') THEN v_bank ELSE v_cash END;

  INSERT INTO public.pharmacy_journal_entries(
    pharmacy_id,branch_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by
  ) VALUES(
    p_pharmacy_id,p_branch_id,'PAY-'||replace(v_payment.id::TEXT,'-',''),COALESCE(p_payment_date,now())::DATE,
    COALESCE(NULLIF(BTRIM(p_reference),''),v_payment.id::TEXT),
    CASE WHEN v_kind='supplier_payment' THEN 'سداد رصيد مورد' ELSE 'تحصيل رصيد عميل' END,
    'pharmacy_payments',v_payment.id,v_amount,v_amount,v_actor
  ) RETURNING id INTO v_entry;

  IF v_kind='supplier_payment' THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
      (p_pharmacy_id,v_entry,v_payable,v_amount,0,'تخفيض ذمم الموردين'),
      (p_pharmacy_id,v_entry,v_money,0,v_amount,'سداد المورد');
  ELSE
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
      (p_pharmacy_id,v_entry,v_money,v_amount,0,'تحصيل من العميل'),
      (p_pharmacy_id,v_entry,v_receivable,0,v_amount,'تخفيض ذمم العملاء');
  END IF;

  INSERT INTO public.pharmacy_financial_movements(
    pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by
  ) VALUES(
    p_pharmacy_id,p_branch_id,'partner_payment',v_kind,v_amount,v_direction,'pharmacy_payments',v_payment.id,
    CASE WHEN v_kind='supplier_payment' THEN 'دفعة للمورد '||v_partner.name ELSE 'تحصيل من العميل '||v_partner.name END,
    COALESCE(p_payment_date,now()),v_actor
  );

  RETURN jsonb_build_object('duplicate',false,'payment',to_jsonb(v_payment),'balance',v_balance,'journal_entry_id',v_entry);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_prescription_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_patient_record_id UUID,
  p_patient_name TEXT,
  p_doctor_name TEXT,
  p_diagnosis TEXT,
  p_notes TEXT,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_valid_until DATE DEFAULT NULL,
  p_client_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID:=COALESCE(auth.uid(),p_actor_id);
  v_patient public.pharmacy_patients%ROWTYPE;
  v_row public.pharmacy_prescriptions%ROWTYPE;
  v_number TEXT;
  v_visit UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'prescriptions:write',v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية إضافة وصفة'; END IF;
  IF p_branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,p_branch_id,v_actor) THEN RAISE EXCEPTION 'ليست لديك صلاحية على الفرع'; END IF;
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.pharmacy_prescriptions WHERE pharmacy_id=p_pharmacy_id AND client_request_id=p_client_request_id LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('duplicate',true,'prescription',to_jsonb(v_row)); END IF;
  END IF;
  IF p_patient_record_id IS NOT NULL THEN
    SELECT * INTO v_patient FROM public.pharmacy_patients WHERE id=p_patient_record_id AND pharmacy_id=p_pharmacy_id AND status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'المريض غير موجود أو غير نشط'; END IF;
  END IF;
  IF p_patient_record_id IS NULL AND NULLIF(BTRIM(p_patient_name),'') IS NULL THEN RAISE EXCEPTION 'اسم المريض مطلوب'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':prescription-number',0));
  v_number:='RX-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad((COALESCE((SELECT COUNT(*) FROM public.pharmacy_prescriptions WHERE pharmacy_id=p_pharmacy_id AND created_at::DATE=CURRENT_DATE),0)+1)::TEXT,4,'0');
  INSERT INTO public.pharmacy_prescriptions(
    pharmacy_id,branch_id,patient_id,patient_record_id,patient_name,doctor_name,diagnosis,notes,items,
    prescription_number,prescription_date,valid_until,status,created_by,client_request_id
  ) VALUES(
    p_pharmacy_id,p_branch_id,v_patient.partner_id,p_patient_record_id,
    COALESCE(NULLIF(BTRIM(v_patient.name),''),NULLIF(BTRIM(p_patient_name),''),'مريض'),
    NULLIF(BTRIM(p_doctor_name),''),NULLIF(BTRIM(p_diagnosis),''),NULLIF(BTRIM(p_notes),''),
    CASE WHEN jsonb_typeof(p_items)='array' THEN p_items ELSE '[]'::jsonb END,v_number,now(),p_valid_until,'open',v_actor,p_client_request_id
  ) RETURNING * INTO v_row;
  IF p_patient_record_id IS NOT NULL THEN
    INSERT INTO public.pharmacy_patient_visits(pharmacy_id,branch_id,patient_id,visit_type,reference_table,reference_id,visit_date,total_amount,notes,created_by)
    VALUES(p_pharmacy_id,p_branch_id,p_patient_record_id,'prescription','pharmacy_prescriptions',v_row.id,now(),0,'وصفة طبية '||v_number,v_actor)
    ON CONFLICT DO NOTHING RETURNING id INTO v_visit;
    IF v_visit IS NOT NULL THEN
      UPDATE public.pharmacy_patients SET visit_count=visit_count+1,last_visit_date=GREATEST(COALESCE(last_visit_date,now()),now()),updated_at=now()
      WHERE id=p_patient_record_id AND pharmacy_id=p_pharmacy_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('duplicate',false,'prescription',to_jsonb(v_row),'visit_id',v_visit);
END;
$$;


CREATE OR REPLACE FUNCTION public.finalize_sales_return_partner_v1(
  p_pharmacy_id UUID,p_return_id UUID,p_actor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_return public.pharmacy_sales_returns%ROWTYPE;
  v_sale public.pharmacy_sales%ROWTYPE;
  v_due_reduction NUMERIC;
  v_ledger JSONB;
  v_visit UUID;
BEGIN
  SELECT * INTO v_return FROM public.pharmacy_sales_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المبيعات غير موجود'; END IF;
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE id=v_return.sale_id AND pharmacy_id=p_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع الأصلية غير موجودة'; END IF;
  UPDATE public.pharmacy_sales_returns SET customer_id=v_sale.customer_id,patient_id=v_sale.patient_id,updated_at=now()
  WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id;
  v_due_reduction:=GREATEST(COALESCE(v_return.total,0)-COALESCE(v_return.refund_amount,0),0);
  IF v_sale.customer_id IS NOT NULL AND v_due_reduction>0 THEN
    SELECT public.record_partner_balance_entry_v1(p_pharmacy_id,v_return.branch_id,v_sale.customer_id,
      'pharmacy_sales_returns',p_return_id,'return',-v_due_reduction,'تخفيض مديونية العميل بمرتجع مبيعات',p_actor_id,true) INTO v_ledger;
  END IF;
  IF v_sale.patient_id IS NOT NULL THEN
    INSERT INTO public.pharmacy_patient_visits(pharmacy_id,branch_id,patient_id,visit_type,reference_table,reference_id,visit_date,total_amount,notes,created_by)
    VALUES(p_pharmacy_id,v_return.branch_id,v_sale.patient_id,'sale_return','pharmacy_sales_returns',p_return_id,v_return.return_date,-v_return.total,'مرتجع مبيعات '||v_return.return_number,p_actor_id)
    ON CONFLICT DO NOTHING RETURNING id INTO v_visit;
    IF v_visit IS NOT NULL THEN
      UPDATE public.pharmacy_patients SET total_purchases=GREATEST(total_purchases-v_return.total,0),updated_at=now()
      WHERE id=v_sale.patient_id AND pharmacy_id=p_pharmacy_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('customer_id',v_sale.customer_id,'patient_id',v_sale.patient_id,'due_reduction',v_due_reduction,'ledger',v_ledger,'visit_id',v_visit);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_purchase_return_partner_v1(
  p_pharmacy_id UUID,p_return_id UUID,p_actor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_return public.pharmacy_purchase_returns%ROWTYPE;
  v_purchase public.pharmacy_purchases%ROWTYPE;
  v_prior_returns NUMERIC:=0;
  v_original_due NUMERIC:=0;
  v_due_reduction NUMERIC:=0;
  v_refund NUMERIC:=0;
  v_ledger JSONB;
BEGIN
  SELECT * INTO v_return FROM public.pharmacy_purchase_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المشتريات غير موجود'; END IF;
  SELECT * INTO v_purchase FROM public.pharmacy_purchases WHERE id=v_return.purchase_id AND pharmacy_id=p_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء الأصلية غير موجودة'; END IF;
  SELECT COALESCE(SUM(total),0) INTO v_prior_returns FROM public.pharmacy_purchase_returns
  WHERE pharmacy_id=p_pharmacy_id AND purchase_id=v_purchase.id AND id<>p_return_id AND voided_at IS NULL
    AND created_at<=v_return.created_at;
  v_original_due:=GREATEST(COALESCE(v_purchase.total,0)-COALESCE(v_purchase.paid_amount,0),0);
  v_due_reduction:=LEAST(COALESCE(v_return.total,0),GREATEST(v_original_due-v_prior_returns,0));
  v_refund:=GREATEST(COALESCE(v_return.total,0)-v_due_reduction,0);
  UPDATE public.pharmacy_purchase_returns SET supplier_id=v_purchase.supplier_id,refund_amount=v_refund,updated_at=now()
  WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id;
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
  RETURN jsonb_build_object('supplier_id',v_purchase.supplier_id,'due_reduction',v_due_reduction,'refund_amount',v_refund,'ledger',v_ledger);
END;
$$;

-- Correct report aggregations: aggregate invoices and lines separately to avoid duplicate totals.

CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,p_from_date DATE DEFAULT CURRENT_DATE-INTERVAL '30 days',p_to_date DATE DEFAULT CURRENT_DATE,p_branch_id UUID DEFAULT NULL
) RETURNS TABLE(sale_date DATE,invoice_count BIGINT,total_sales NUMERIC,total_discounts NUMERIC,total_tax NUMERIC,total_cost NUMERIC,total_profit NUMERIC,cash_sales NUMERIC,card_sales NUMERIC,credit_sales NUMERIC,item_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH headers AS (
    SELECT s.sale_date::DATE day,COUNT(*)::BIGINT invoices,SUM(s.total) sales,SUM(s.discount_total) discounts,SUM(s.tax_total) tax,
      SUM(CASE WHEN s.payment_method='cash' THEN s.paid_amount ELSE 0 END) cash,
      SUM(CASE WHEN s.payment_method IN ('card','wallet','bank','bank-transfer','mixed') THEN s.paid_amount ELSE 0 END) cards,
      SUM(CASE WHEN s.payment_method='credit' THEN s.total ELSE 0 END) credit
    FROM public.pharmacy_sales s WHERE s.pharmacy_id=p_pharmacy_id AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
      AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    GROUP BY s.sale_date::DATE
  ), lines AS (
    SELECT s.sale_date::DATE day,SUM(sl.purchase_price*sl.quantity) cost,SUM(sl.quantity)::BIGINT item_count
    FROM public.pharmacy_sale_lines sl JOIN public.pharmacy_sales s ON s.id=sl.sale_id AND s.pharmacy_id=sl.pharmacy_id
    WHERE sl.pharmacy_id=p_pharmacy_id AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
      AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    GROUP BY s.sale_date::DATE
  ), returns AS (
    SELECT r.return_date::DATE day,SUM(r.total) amount,
      COALESCE(SUM(rl.quantity*COALESCE(sl.purchase_price,0)),0) cost
    FROM public.pharmacy_sales_returns r LEFT JOIN public.pharmacy_sales_return_lines rl ON rl.return_id=r.id AND rl.pharmacy_id=r.pharmacy_id
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id
    WHERE r.pharmacy_id=p_pharmacy_id AND r.voided_at IS NULL AND r.return_date::DATE BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR r.branch_id=p_branch_id)
    GROUP BY r.return_date::DATE
  )
  SELECT h.day,h.invoices,GREATEST(h.sales-COALESCE(r.amount,0),0),h.discounts,h.tax,
    GREATEST(COALESCE(l.cost,0)-COALESCE(r.cost,0),0),
    GREATEST(h.sales-COALESCE(r.amount,0),0)-GREATEST(COALESCE(l.cost,0)-COALESCE(r.cost,0),0),
    h.cash,h.cards,h.credit,COALESCE(l.item_count,0)
  FROM headers h LEFT JOIN lines l ON l.day=h.day LEFT JOIN returns r ON r.day=h.day ORDER BY h.day DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_top_selling_items(
  p_pharmacy_id UUID,p_from_date DATE DEFAULT CURRENT_DATE-INTERVAL '30 days',p_to_date DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 20,p_branch_id UUID DEFAULT NULL
) RETURNS TABLE(item_id UUID,item_name TEXT,sku TEXT,total_quantity NUMERIC,total_sales NUMERIC,total_cost NUMERIC,total_profit NUMERIC,sale_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT sl.item_id,COALESCE(i.name_ar,MAX(sl.item_name),'')::TEXT,i.sku,
    SUM(sl.quantity),SUM(sl.net_total),SUM(sl.purchase_price*sl.quantity),
    SUM(sl.net_total-(sl.purchase_price*sl.quantity)),COUNT(DISTINCT sl.sale_id)::BIGINT
  FROM public.pharmacy_sale_lines sl
  JOIN public.pharmacy_sales s ON s.id=sl.sale_id AND s.pharmacy_id=sl.pharmacy_id
  LEFT JOIN public.pharmacy_items i ON i.id=sl.item_id AND i.pharmacy_id=sl.pharmacy_id
  WHERE sl.pharmacy_id=p_pharmacy_id AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
    AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
  GROUP BY sl.item_id,i.name_ar,i.sku ORDER BY SUM(sl.net_total) DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,20),100));
$$;

CREATE OR REPLACE FUNCTION public.get_profit_loss_summary(
  p_pharmacy_id UUID,p_from_date DATE DEFAULT CURRENT_DATE-INTERVAL '30 days',p_to_date DATE DEFAULT CURRENT_DATE,p_branch_id UUID DEFAULT NULL
) RETURNS TABLE(period_label TEXT,total_revenue NUMERIC,total_cost NUMERIC,gross_profit NUMERIC,gross_margin_percent NUMERIC,total_discounts NUMERIC,total_expenses NUMERIC,net_profit NUMERIC,invoice_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH sale_headers AS (
    SELECT COALESCE(SUM(total),0) revenue,COALESCE(SUM(discount_total),0) discounts,COUNT(*)::BIGINT invoices
    FROM public.pharmacy_sales WHERE pharmacy_id=p_pharmacy_id AND voided_at IS NULL AND status NOT IN ('void','cancelled')
      AND sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR branch_id=p_branch_id)
  ), sale_cost AS (
    SELECT COALESCE(SUM(sl.purchase_price*sl.quantity),0) cost
    FROM public.pharmacy_sale_lines sl JOIN public.pharmacy_sales s ON s.id=sl.sale_id AND s.pharmacy_id=sl.pharmacy_id
    WHERE sl.pharmacy_id=p_pharmacy_id AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
      AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
  ), return_data AS (
    SELECT COALESCE(SUM(total),0) return_revenue,
      COALESCE((SELECT SUM(rl.quantity*COALESCE(sl.purchase_price,0)) FROM public.pharmacy_sales_return_lines rl
        JOIN public.pharmacy_sales_returns r ON r.id=rl.return_id AND r.pharmacy_id=rl.pharmacy_id
        LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id
        WHERE r.pharmacy_id=p_pharmacy_id AND r.voided_at IS NULL AND r.return_date::DATE BETWEEN p_from_date AND p_to_date
          AND (p_branch_id IS NULL OR r.branch_id=p_branch_id)),0) return_cost
    FROM public.pharmacy_sales_returns WHERE pharmacy_id=p_pharmacy_id AND voided_at IS NULL
      AND return_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR branch_id=p_branch_id)
  ), exp AS (
    SELECT COALESCE(SUM(total),0) expenses FROM public.pharmacy_expenses WHERE pharmacy_id=p_pharmacy_id AND voided_at IS NULL
      AND expense_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR branch_id=p_branch_id)
  )
  SELECT to_char(p_from_date,'YYYY-MM-DD')||' إلى '||to_char(p_to_date,'YYYY-MM-DD'),
    GREATEST(h.revenue-r.return_revenue,0),GREATEST(c.cost-r.return_cost,0),
    GREATEST(h.revenue-r.return_revenue,0)-GREATEST(c.cost-r.return_cost,0),
    CASE WHEN GREATEST(h.revenue-r.return_revenue,0)>0 THEN round(((GREATEST(h.revenue-r.return_revenue,0)-GREATEST(c.cost-r.return_cost,0))/GREATEST(h.revenue-r.return_revenue,0))*100,2) ELSE 0 END,
    h.discounts,e.expenses,
    (GREATEST(h.revenue-r.return_revenue,0)-GREATEST(c.cost-r.return_cost,0))-e.expenses,h.invoices
  FROM sale_headers h,sale_cost c,return_data r,exp e;
$$;

DROP FUNCTION IF EXISTS public.get_customer_activity_summary(UUID,DATE,DATE,UUID);
CREATE FUNCTION public.get_customer_activity_summary(
  p_pharmacy_id UUID,p_from_date DATE DEFAULT CURRENT_DATE-INTERVAL '30 days',p_to_date DATE DEFAULT CURRENT_DATE,p_branch_id UUID DEFAULT NULL
) RETURNS TABLE(customer_id UUID,customer_name TEXT,customer_phone TEXT,invoice_count BIGINT,total_spent NUMERIC,total_discounts NUMERIC,total_paid NUMERIC,total_due NUMERIC,last_visit_date TIMESTAMPTZ,average_invoice NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT s.customer_id,COALESCE(MAX(p.name),MAX(s.customer_name),'عميل نقدي'),MAX(p.phone),COUNT(*)::BIGINT,
    SUM(s.total),SUM(s.discount_total),SUM(s.paid_amount),SUM(s.due_amount),MAX(s.sale_date),round(AVG(s.total),2)
  FROM public.pharmacy_sales s LEFT JOIN public.pharmacy_partners p ON p.id=s.customer_id AND p.pharmacy_id=s.pharmacy_id
  WHERE s.pharmacy_id=p_pharmacy_id AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
    AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
  GROUP BY s.customer_id,COALESCE(p.name,s.customer_name,'عميل نقدي'),p.phone ORDER BY SUM(s.total) DESC LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.record_partner_balance_entry_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,NUMERIC,TEXT,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_partner_payment_v1(UUID,UUID,UUID,UUID,NUMERIC,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_prescription_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,DATE,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_sales_return_partner_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_purchase_return_partner_v1(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_partner_balance_entry_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,NUMERIC,TEXT,UUID,BOOLEAN) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_partner_payment_v1(UUID,UUID,UUID,UUID,NUMERIC,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_prescription_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,DATE,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_sales_return_partner_v1(UUID,UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_purchase_return_partner_v1(UUID,UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID,DATE,DATE,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(UUID,DATE,DATE,INT,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_summary(UUID,DATE,DATE,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(UUID,DATE,DATE,UUID) TO authenticated,service_role;

COMMIT;
