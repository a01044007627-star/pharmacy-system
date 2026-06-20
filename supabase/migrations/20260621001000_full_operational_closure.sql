BEGIN;

-- Full operational closure for patients, loyalty and accounting.
-- The migration is additive/idempotent and preserves all existing tenant data.

ALTER TABLE public.pharmacy_patients
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_client_request
  ON public.pharmacy_patients(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.pharmacy_patients(id) ON DELETE SET NULL;

ALTER TABLE public.pharmacy_prescriptions
  ADD COLUMN IF NOT EXISTS patient_record_id UUID REFERENCES public.pharmacy_patients(id) ON DELETE SET NULL;

ALTER TABLE public.pharmacy_loyalty_transactions
  ADD COLUMN IF NOT EXISTS source_table TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS balance_after INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.pharmacy_patient_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.pharmacy_patients(id) ON DELETE CASCADE,
  visit_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (visit_type IN ('sale','sale_return','prescription','consultation','medication_review','manual','other')),
  reference_table TEXT,
  reference_id UUID,
  visit_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_visits_patient_date
  ON public.pharmacy_patient_visits(pharmacy_id, patient_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_visits_reference
  ON public.pharmacy_patient_visits(pharmacy_id, reference_table, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_visits_unique_reference
  ON public.pharmacy_patient_visits(pharmacy_id, patient_id, visit_type, reference_table, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_patient_date
  ON public.pharmacy_sales(pharmacy_id, patient_id, sale_date DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_record
  ON public.pharmacy_prescriptions(pharmacy_id, patient_record_id, created_at DESC)
  WHERE patient_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_source
  ON public.pharmacy_loyalty_transactions(pharmacy_id, partner_id, source_table, source_id, type)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON public.pharmacy_journal_entries(pharmacy_id, source_table, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_movements_source
  ON public.pharmacy_financial_movements(pharmacy_id, source_table, source_id, category)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.pharmacy_patient_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patient_visits_select ON public.pharmacy_patient_visits;
DROP POLICY IF EXISTS patient_visits_insert ON public.pharmacy_patient_visits;
DROP POLICY IF EXISTS patient_visits_update ON public.pharmacy_patient_visits;
DROP POLICY IF EXISTS patient_visits_delete ON public.pharmacy_patient_visits;
CREATE POLICY patient_visits_select ON public.pharmacy_patient_visits
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY patient_visits_insert ON public.pharmacy_patient_visits
  FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write'));
CREATE POLICY patient_visits_update ON public.pharmacy_patient_visits
  FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'crm:write'))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write'));
CREATE POLICY patient_visits_delete ON public.pharmacy_patient_visits
  FOR DELETE USING (public.user_has_permission(pharmacy_id, 'crm:write'));

DROP TRIGGER IF EXISTS trg_pharmacy_patient_visits_updated_at ON public.pharmacy_patient_visits;
CREATE TRIGGER trg_pharmacy_patient_visits_updated_at
  BEFORE UPDATE ON public.pharmacy_patient_visits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.next_patient_code(p_pharmacy_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':patient-code', 0));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '[^0-9]', '', 'g'), '')::INTEGER), 0) + 1
    INTO v_next
  FROM public.pharmacy_patients
  WHERE pharmacy_id = p_pharmacy_id;
  RETURN 'PAT-' || lpad(v_next::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_pharmacy_patient_v1(
  p_pharmacy_id UUID,
  p_actor_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_partner public.pharmacy_partners%ROWTYPE;
  v_patient public.pharmacy_patients%ROWTYPE;
  v_name TEXT := NULLIF(BTRIM(p_payload->>'name'), '');
  v_phone TEXT := NULLIF(BTRIM(p_payload->>'phone'), '');
  v_email TEXT := NULLIF(BTRIM(p_payload->>'email'), '');
  v_birth DATE;
  v_existing UUID;
  v_patient_id UUID := COALESCE(NULLIF(BTRIM(p_payload->>'client_request_id'), '')::UUID, gen_random_uuid());
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'crm:write', v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إضافة مرضى';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'اسم المريض مطلوب'; END IF;

  SELECT id INTO v_existing FROM public.pharmacy_patients
  WHERE pharmacy_id=p_pharmacy_id AND client_request_id=v_patient_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'patient', (SELECT to_jsonb(p) FROM public.pharmacy_patients p WHERE p.id=v_existing),
      'partner', (SELECT to_jsonb(pr) FROM public.pharmacy_partners pr JOIN public.pharmacy_patients p ON p.partner_id=pr.id WHERE p.id=v_existing),
      'duplicate', true
    );
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_payload->>'date_of_birth', p_payload->>'birth_date')), '') IS NOT NULL THEN
    v_birth := COALESCE(p_payload->>'date_of_birth', p_payload->>'birth_date')::DATE;
    IF v_birth > CURRENT_DATE THEN RAISE EXCEPTION 'تاريخ الميلاد لا يمكن أن يكون في المستقبل'; END IF;
  END IF;

  IF NULLIF(BTRIM(p_payload->>'id_number'), '') IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.pharmacy_patients
    WHERE pharmacy_id = p_pharmacy_id
      AND id_number = BTRIM(p_payload->>'id_number')
      AND status <> 'archived'
    LIMIT 1;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'يوجد مريض بنفس رقم الهوية'; END IF;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.pharmacy_patients
    WHERE pharmacy_id = p_pharmacy_id
      AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')
      AND lower(BTRIM(name)) = lower(v_name)
      AND status <> 'archived'
    LIMIT 1;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'المريض مسجل بالفعل بنفس الاسم والهاتف'; END IF;
  END IF;

  INSERT INTO public.pharmacy_partners (
    pharmacy_id, type, name, phone, email, address, notes, status
  ) VALUES (
    p_pharmacy_id, 'customer', v_name, v_phone, v_email,
    NULLIF(BTRIM(p_payload->>'address'), ''),
    NULLIF(BTRIM(p_payload->>'notes'), ''), 'active'
  ) RETURNING * INTO v_partner;

  INSERT INTO public.pharmacy_patients (
    id, client_request_id, pharmacy_id, partner_id, code, name, phone, email, address, gender,
    date_of_birth, age, id_number, blood_type, allergies, chronic_diseases,
    current_medications, medical_history, surgical_history, family_history,
    emergency_contact_name, emergency_contact_phone, insurance_company,
    insurance_policy_number, insurance_expiry_date, notes, status, created_by
  ) VALUES (
    v_patient_id, v_patient_id, p_pharmacy_id, v_partner.id, public.next_patient_code(p_pharmacy_id), v_name,
    v_phone, v_email, NULLIF(BTRIM(p_payload->>'address'), ''),
    CASE WHEN p_payload->>'gender' IN ('male','female') THEN p_payload->>'gender' ELSE NULL END,
    v_birth,
    CASE WHEN v_birth IS NOT NULL THEN date_part('year', age(CURRENT_DATE, v_birth))::INTEGER ELSE NULL END,
    NULLIF(BTRIM(p_payload->>'id_number'), ''),
    CASE WHEN p_payload->>'blood_type' IN ('A+','A-','B+','B-','AB+','AB-','O+','O-') THEN p_payload->>'blood_type' ELSE NULL END,
    CASE WHEN jsonb_typeof(p_payload->'allergies') = 'array' THEN p_payload->'allergies' ELSE '[]'::JSONB END,
    CASE WHEN jsonb_typeof(p_payload->'chronic_diseases') = 'array' THEN p_payload->'chronic_diseases' ELSE '[]'::JSONB END,
    CASE WHEN jsonb_typeof(p_payload->'current_medications') = 'array' THEN p_payload->'current_medications' ELSE '[]'::JSONB END,
    NULLIF(BTRIM(p_payload->>'medical_history'), ''),
    NULLIF(BTRIM(p_payload->>'surgical_history'), ''),
    NULLIF(BTRIM(p_payload->>'family_history'), ''),
    NULLIF(BTRIM(p_payload->>'emergency_contact_name'), ''),
    NULLIF(BTRIM(p_payload->>'emergency_contact_phone'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_company'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_policy_number'), ''),
    CASE WHEN NULLIF(BTRIM(p_payload->>'insurance_expiry_date'), '') IS NULL THEN NULL ELSE (p_payload->>'insurance_expiry_date')::DATE END,
    NULLIF(BTRIM(p_payload->>'notes'), ''), 'active', v_actor
  ) RETURNING * INTO v_patient;

  RETURN jsonb_build_object('patient', to_jsonb(v_patient), 'partner', to_jsonb(v_partner));
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_pharmacy_accounts(p_pharmacy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pharmacy_chart_of_accounts(pharmacy_id, code, name, type, is_active, sort_order)
  VALUES
    (p_pharmacy_id, '1010', 'الخزينة والنقدية', 'asset', true, 10),
    (p_pharmacy_id, '1020', 'البنوك والبطاقات والمحافظ', 'asset', true, 20),
    (p_pharmacy_id, '1100', 'ذمم العملاء', 'asset', true, 30),
    (p_pharmacy_id, '1200', 'مخزون الأدوية والأصناف', 'asset', true, 40),
    (p_pharmacy_id, '2010', 'ذمم الموردين', 'liability', true, 50),
    (p_pharmacy_id, '3010', 'رأس المال والأرصدة الافتتاحية', 'equity', true, 60),
    (p_pharmacy_id, '4010', 'إيرادات المبيعات', 'income', true, 70),
    (p_pharmacy_id, '4020', 'مردودات وخصومات المبيعات', 'income', true, 80),
    (p_pharmacy_id, '5010', 'تكلفة البضاعة المباعة', 'expense', true, 90),
    (p_pharmacy_id, '5020', 'المصروفات التشغيلية', 'expense', true, 100)
  ON CONFLICT (pharmacy_id, code) DO UPDATE
    SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = true, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.post_sale_accounting_v1(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.pharmacy_sales%ROWTYPE;
  v_entry_id UUID;
  v_cash UUID; v_bank UUID; v_receivable UUID; v_inventory UUID; v_revenue UUID; v_cogs UUID;
  v_paid NUMERIC; v_due NUMERIC; v_cost NUMERIC; v_debit_account UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sale_id::TEXT || ':sale-accounting', 0));
  SELECT id INTO v_entry_id FROM public.pharmacy_journal_entries
  WHERE pharmacy_id = p_pharmacy_id AND source_table = 'pharmacy_sales' AND source_id = p_sale_id LIMIT 1;
  IF v_entry_id IS NOT NULL THEN RETURN v_entry_id; END IF;

  SELECT * INTO v_sale FROM public.pharmacy_sales
  WHERE id = p_sale_id AND pharmacy_id = p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع غير موجودة'; END IF;

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_bank FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1020';
  SELECT id INTO v_receivable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1100';
  SELECT id INTO v_inventory FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1200';
  SELECT id INTO v_revenue FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='4010';
  SELECT id INTO v_cogs FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='5010';

  v_paid := LEAST(GREATEST(COALESCE(v_sale.paid_amount,0),0), GREATEST(COALESCE(v_sale.total,0),0));
  v_due := GREATEST(COALESCE(v_sale.total,0) - v_paid, 0);
  SELECT COALESCE(SUM(quantity * COALESCE(purchase_price,0)),0) INTO v_cost
  FROM public.pharmacy_sale_lines WHERE pharmacy_id=p_pharmacy_id AND sale_id=p_sale_id;
  v_debit_account := CASE WHEN v_sale.payment_method IN ('card','wallet','bank-transfer','mixed') THEN v_bank ELSE v_cash END;

  INSERT INTO public.pharmacy_journal_entries(
    pharmacy_id, branch_id, entry_number, entry_date, reference, description,
    source_table, source_id, total_debit, total_credit, created_by
  ) VALUES (
    p_pharmacy_id, v_sale.branch_id, 'SAL-' || replace(p_sale_id::TEXT,'-',''), v_sale.sale_date::DATE,
    v_sale.invoice_number, 'قيد فاتورة بيع ' || v_sale.invoice_number,
    'pharmacy_sales', p_sale_id, COALESCE(v_sale.total,0)+v_cost, COALESCE(v_sale.total,0)+v_cost, COALESCE(p_actor_id,v_sale.created_by)
  ) RETURNING id INTO v_entry_id;

  IF v_paid > 0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES(p_pharmacy_id,v_entry_id,v_debit_account,v_paid,0,'المبلغ المحصل من فاتورة البيع');
  END IF;
  IF v_due > 0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES(p_pharmacy_id,v_entry_id,v_receivable,v_due,0,'الرصيد الآجل على العميل');
  END IF;
  IF COALESCE(v_sale.total,0) > 0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES(p_pharmacy_id,v_entry_id,v_revenue,0,v_sale.total,'إيراد المبيعات');
  END IF;
  IF v_cost > 0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES
      (p_pharmacy_id,v_entry_id,v_cogs,v_cost,0,'تكلفة الأصناف المباعة'),
      (p_pharmacy_id,v_entry_id,v_inventory,0,v_cost,'تخفيض المخزون بالتكلفة');
  END IF;

  IF v_paid > 0 AND NOT EXISTS (
    SELECT 1 FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_sales' AND source_id=p_sale_id AND category='sale_collection'
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by
    ) VALUES (
      p_pharmacy_id,v_sale.branch_id,'sale','sale_collection',v_paid,'in','pharmacy_sales',p_sale_id,
      'تحصيل فاتورة '||v_sale.invoice_number,v_sale.sale_date,COALESCE(p_actor_id,v_sale.created_by)
    );
  END IF;
  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sale_loyalty_v1(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_partner_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.pharmacy_sales%ROWTYPE;
  v_enabled BOOLEAN := false;
  v_amount NUMERIC := 100;
  v_points_per_purchase INTEGER := 1;
  v_expiry_days INTEGER := 365;
  v_points INTEGER := 0;
  v_balance INTEGER := 0;
BEGIN
  IF p_partner_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sale_id::TEXT || ':sale-loyalty', 0));
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id AND type='earn'
      AND source_table='pharmacy_sales' AND source_id=p_sale_id
  ) THEN
    SELECT points INTO v_points FROM public.pharmacy_loyalty_transactions
    WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id AND type='earn'
      AND source_table='pharmacy_sales' AND source_id=p_sale_id LIMIT 1;
    RETURN COALESCE(v_points,0);
  END IF;

  SELECT * INTO v_sale FROM public.pharmacy_sales
  WHERE id=p_sale_id AND pharmacy_id=p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE((SELECT value::BOOLEAN FROM public.pharmacy_settings WHERE pharmacy_id=p_pharmacy_id AND key='rewards.enableRewards' LIMIT 1), false)
    INTO v_enabled;
  v_enabled := COALESCE(v_enabled, false);
  IF NOT v_enabled THEN RETURN 0; END IF;
  SELECT COALESCE(NULLIF(value,'')::NUMERIC,100) INTO v_amount
    FROM public.pharmacy_settings WHERE pharmacy_id=p_pharmacy_id AND key='rewards.pointsPerAmount' LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::INTEGER,1) INTO v_points_per_purchase
    FROM public.pharmacy_settings WHERE pharmacy_id=p_pharmacy_id AND key='rewards.pointsPerPurchase' LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::INTEGER,365) INTO v_expiry_days
    FROM public.pharmacy_settings WHERE pharmacy_id=p_pharmacy_id AND key='rewards.expiryDays' LIMIT 1;
  v_amount := GREATEST(COALESCE(v_amount,100),0.01);
  v_expiry_days := GREATEST(COALESCE(v_expiry_days,365),1);
  v_points_per_purchase := GREATEST(COALESCE(v_points_per_purchase,1),0);
  v_points := FLOOR(GREATEST(COALESCE(v_sale.total,0),0) / v_amount)::INTEGER * v_points_per_purchase;
  IF v_points <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.pharmacy_loyalty_balances(pharmacy_id,partner_id,total_earned,total_redeemed,total_expired,current_balance,updated_at)
  VALUES(p_pharmacy_id,p_partner_id,v_points,0,0,v_points,now())
  ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET
    total_earned=public.pharmacy_loyalty_balances.total_earned+EXCLUDED.total_earned,
    current_balance=public.pharmacy_loyalty_balances.current_balance+EXCLUDED.current_balance,
    updated_at=now()
  RETURNING current_balance INTO v_balance;

  INSERT INTO public.pharmacy_loyalty_points(pharmacy_id,partner_id,points,updated_at)
  VALUES(p_pharmacy_id,p_partner_id,v_balance,now())
  ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET points=EXCLUDED.points,updated_at=now();

  INSERT INTO public.pharmacy_loyalty_transactions(
    pharmacy_id,partner_id,type,points,reference,source_table,source_id,balance_after,notes,expires_at,created_by
  ) VALUES(
    p_pharmacy_id,p_partner_id,'earn',v_points,v_sale.invoice_number,'pharmacy_sales',p_sale_id,v_balance,
    'نقاط مكتسبة من فاتورة بيع',now()+(v_expiry_days||' days')::INTERVAL,p_actor_id
  );
  RETURN v_points;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_sale_operations_v1(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_patient_id UUID DEFAULT NULL,
  p_partner_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.pharmacy_sales%ROWTYPE;
  v_patient public.pharmacy_patients%ROWTYPE;
  v_partner_id UUID := p_partner_id;
  v_visit_id UUID;
  v_points INTEGER := 0;
  v_entry UUID;
BEGIN
  SELECT * INTO v_sale FROM public.pharmacy_sales
  WHERE id=p_sale_id AND pharmacy_id=p_pharmacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع غير موجودة'; END IF;

  IF p_patient_id IS NOT NULL THEN
    SELECT * INTO v_patient FROM public.pharmacy_patients
    WHERE id=p_patient_id AND pharmacy_id=p_pharmacy_id AND status <> 'archived';
    IF NOT FOUND THEN RAISE EXCEPTION 'المريض غير موجود أو مؤرشف'; END IF;
    v_partner_id := COALESCE(v_partner_id,v_patient.partner_id);
    UPDATE public.pharmacy_sales SET
      patient_id=v_patient.id,
      customer_id=COALESCE(v_partner_id,customer_id),
      customer_name=COALESCE(NULLIF(v_patient.name,''),customer_name),
      patient_name=COALESCE(NULLIF(v_patient.name,''),patient_name),
      updated_at=now()
    WHERE id=p_sale_id AND pharmacy_id=p_pharmacy_id;

    INSERT INTO public.pharmacy_patient_visits(
      pharmacy_id,branch_id,patient_id,visit_type,reference_table,reference_id,visit_date,total_amount,notes,created_by
    ) VALUES(
      p_pharmacy_id,v_sale.branch_id,v_patient.id,'sale','pharmacy_sales',p_sale_id,v_sale.sale_date,v_sale.total,
      'زيارة ناتجة عن فاتورة بيع '||v_sale.invoice_number,p_actor_id
    ) ON CONFLICT DO NOTHING RETURNING id INTO v_visit_id;

    IF v_visit_id IS NOT NULL THEN
      UPDATE public.pharmacy_patients SET
        visit_count=visit_count+1,
        total_purchases=total_purchases+GREATEST(COALESCE(v_sale.total,0),0),
        last_visit_date=GREATEST(COALESCE(last_visit_date,v_sale.sale_date),v_sale.sale_date),
        updated_at=now()
      WHERE id=v_patient.id AND pharmacy_id=p_pharmacy_id;
    END IF;
  ELSIF v_partner_id IS NOT NULL THEN
    UPDATE public.pharmacy_sales SET customer_id=v_partner_id,updated_at=now()
    WHERE id=p_sale_id AND pharmacy_id=p_pharmacy_id;
  END IF;

  IF v_partner_id IS NOT NULL THEN
    SELECT public.apply_sale_loyalty_v1(p_pharmacy_id,p_sale_id,v_partner_id,p_actor_id) INTO v_points;
  END IF;
  SELECT public.post_sale_accounting_v1(p_pharmacy_id,p_sale_id,p_actor_id) INTO v_entry;
  RETURN jsonb_build_object('journal_entry_id',v_entry,'loyalty_points',v_points,'patient_visit_id',v_visit_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_purchase_accounting_v1(
  p_pharmacy_id UUID,
  p_purchase_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.pharmacy_purchases%ROWTYPE;
  v_entry UUID; v_cash UUID; v_bank UUID; v_inventory UUID; v_payable UUID; v_paid NUMERIC; v_due NUMERIC; v_credit UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_purchase_id::TEXT || ':purchase-accounting',0));
  SELECT id INTO v_entry FROM public.pharmacy_journal_entries WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchases' AND source_id=p_purchase_id LIMIT 1;
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  SELECT * INTO v_doc FROM public.pharmacy_purchases WHERE id=p_purchase_id AND pharmacy_id=p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_bank FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1020';
  SELECT id INTO v_inventory FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1200';
  SELECT id INTO v_payable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='2010';
  v_paid:=LEAST(GREATEST(COALESCE(v_doc.paid_amount,0),0),GREATEST(COALESCE(v_doc.total,0),0));
  v_due:=GREATEST(COALESCE(v_doc.total,0)-v_paid,0);
  v_credit:=CASE WHEN v_doc.payment_method IN ('card','wallet','bank-transfer','mixed') THEN v_bank ELSE v_cash END;
  INSERT INTO public.pharmacy_journal_entries(pharmacy_id,branch_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by)
  VALUES(p_pharmacy_id,v_doc.branch_id,'PUR-'||replace(p_purchase_id::TEXT,'-',''),v_doc.purchase_date::DATE,v_doc.purchase_number,'قيد فاتورة شراء '||v_doc.purchase_number,'pharmacy_purchases',p_purchase_id,v_doc.total,v_doc.total,COALESCE(p_actor_id,v_doc.created_by))
  RETURNING id INTO v_entry;
  IF v_doc.total>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_inventory,v_doc.total,0,'إضافة مخزون من المشتريات'); END IF;
  IF v_paid>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_credit,0,v_paid,'المبلغ المدفوع للمورد'); END IF;
  IF v_due>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_payable,0,v_due,'الرصيد المستحق للمورد'); END IF;
  IF v_paid>0 AND NOT EXISTS(SELECT 1 FROM public.pharmacy_financial_movements WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchases' AND source_id=p_purchase_id AND category='purchase_payment') THEN
    INSERT INTO public.pharmacy_financial_movements(pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by)
    VALUES(p_pharmacy_id,v_doc.branch_id,'purchase','purchase_payment',v_paid,'out','pharmacy_purchases',p_purchase_id,'سداد فاتورة شراء '||v_doc.purchase_number,v_doc.purchase_date,COALESCE(p_actor_id,v_doc.created_by));
  END IF;
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_expense_accounting_v1(
  p_pharmacy_id UUID,
  p_expense_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.pharmacy_expenses%ROWTYPE;
  v_entry UUID; v_cash UUID; v_bank UUID; v_expense UUID; v_credit UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expense_id::TEXT || ':expense-accounting',0));
  SELECT id INTO v_entry FROM public.pharmacy_journal_entries WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_expenses' AND source_id=p_expense_id LIMIT 1;
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  SELECT * INTO v_doc FROM public.pharmacy_expenses WHERE id=p_expense_id AND pharmacy_id=p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_bank FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1020';
  SELECT id INTO v_expense FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='5020';
  v_credit:=CASE WHEN v_doc.payment_method IN ('card','wallet','bank-transfer','mixed') THEN v_bank ELSE v_cash END;
  INSERT INTO public.pharmacy_journal_entries(pharmacy_id,branch_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by)
  VALUES(p_pharmacy_id,v_doc.branch_id,'EXP-'||replace(p_expense_id::TEXT,'-',''),v_doc.expense_date::DATE,v_doc.title,'قيد مصروف '||v_doc.title,'pharmacy_expenses',p_expense_id,v_doc.total,v_doc.total,p_actor_id)
  RETURNING id INTO v_entry;
  INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
    (p_pharmacy_id,v_entry,v_expense,v_doc.total,0,v_doc.title),
    (p_pharmacy_id,v_entry,v_credit,0,v_doc.total,'سداد المصروف');
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_financial_movements WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_expenses' AND source_id=p_expense_id AND category='expense') THEN
    INSERT INTO public.pharmacy_financial_movements(pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,description,movement_date,created_by)
    VALUES(p_pharmacy_id,v_doc.branch_id,'expense','expense',v_doc.total,'out','pharmacy_expenses',p_expense_id,v_doc.title,v_doc.expense_date,p_actor_id);
  END IF;
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_sales_return_accounting_v1(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.pharmacy_sales_returns%ROWTYPE;
  v_sale public.pharmacy_sales%ROWTYPE;
  v_entry UUID; v_cash UUID; v_receivable UUID; v_inventory UUID; v_returns UUID; v_cogs UUID;
  v_refund NUMERIC; v_credit_customer NUMERIC; v_cost NUMERIC; v_earned INTEGER; v_reverse INTEGER; v_balance INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_return_id::TEXT || ':sales-return-accounting',0));
  SELECT id INTO v_entry FROM public.pharmacy_journal_entries WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_sales_returns' AND source_id=p_return_id LIMIT 1;
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  SELECT * INTO v_doc FROM public.pharmacy_sales_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المبيعات غير موجود'; END IF;
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE id=v_doc.sale_id AND pharmacy_id=p_pharmacy_id;
  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_receivable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1100';
  SELECT id INTO v_inventory FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1200';
  SELECT id INTO v_returns FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='4020';
  SELECT id INTO v_cogs FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='5010';
  v_refund:=LEAST(GREATEST(COALESCE(v_doc.refund_amount,0),0),GREATEST(COALESCE(v_doc.total,0),0));
  v_credit_customer:=GREATEST(COALESCE(v_doc.total,0)-v_refund,0);
  SELECT COALESCE(SUM(rl.quantity*COALESCE(sl.purchase_price,0)),0) INTO v_cost
  FROM public.pharmacy_sales_return_lines rl LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id
  WHERE rl.pharmacy_id=p_pharmacy_id AND rl.return_id=p_return_id;
  INSERT INTO public.pharmacy_journal_entries(pharmacy_id,branch_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by)
  VALUES(p_pharmacy_id,v_doc.branch_id,'SRT-'||replace(p_return_id::TEXT,'-',''),v_doc.return_date::DATE,v_doc.return_number,'قيد مرتجع مبيعات '||v_doc.return_number,'pharmacy_sales_returns',p_return_id,v_doc.total+v_cost,v_doc.total+v_cost,COALESCE(p_actor_id,v_doc.created_by))
  RETURNING id INTO v_entry;
  IF v_doc.total>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_returns,v_doc.total,0,'مردودات المبيعات'); END IF;
  IF v_refund>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_cash,0,v_refund,'رد نقدية للعميل'); END IF;
  IF v_credit_customer>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_receivable,0,v_credit_customer,'تخفيض رصيد العميل'); END IF;
  IF v_cost>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
    (p_pharmacy_id,v_entry,v_inventory,v_cost,0,'إعادة تكلفة الأصناف للمخزون'),
    (p_pharmacy_id,v_entry,v_cogs,0,v_cost,'عكس تكلفة البضاعة المباعة'); END IF;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT points INTO v_earned FROM public.pharmacy_loyalty_transactions WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id AND type='earn' AND source_table='pharmacy_sales' AND source_id=v_sale.id LIMIT 1;
    IF COALESCE(v_earned,0)>0 AND COALESCE(v_sale.total,0)>0 AND NOT EXISTS(SELECT 1 FROM public.pharmacy_loyalty_transactions WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id AND type='adjust' AND source_table='pharmacy_sales_returns' AND source_id=p_return_id) THEN
      v_reverse:=LEAST(v_earned,GREATEST(1,FLOOR(v_earned*(v_doc.total/v_sale.total))::INTEGER));
      UPDATE public.pharmacy_loyalty_balances SET total_redeemed=total_redeemed+LEAST(current_balance,v_reverse),current_balance=GREATEST(current_balance-v_reverse,0),updated_at=now()
      WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id RETURNING current_balance INTO v_balance;
      UPDATE public.pharmacy_loyalty_points SET points=COALESCE(v_balance,0),updated_at=now() WHERE pharmacy_id=p_pharmacy_id AND partner_id=v_sale.customer_id;
      INSERT INTO public.pharmacy_loyalty_transactions(pharmacy_id,partner_id,type,points,reference,source_table,source_id,balance_after,notes,created_by)
      VALUES(p_pharmacy_id,v_sale.customer_id,'adjust',-v_reverse,v_doc.return_number,'pharmacy_sales_returns',p_return_id,COALESCE(v_balance,0),'عكس نقاط بسبب مرتجع مبيعات',p_actor_id);
    END IF;
  END IF;
  IF v_sale.patient_id IS NOT NULL THEN
    UPDATE public.pharmacy_patients SET total_purchases=GREATEST(total_purchases-v_doc.total,0),updated_at=now() WHERE id=v_sale.patient_id AND pharmacy_id=p_pharmacy_id;
    INSERT INTO public.pharmacy_patient_visits(pharmacy_id,branch_id,patient_id,visit_type,reference_table,reference_id,visit_date,total_amount,notes,created_by)
    VALUES(p_pharmacy_id,v_doc.branch_id,v_sale.patient_id,'sale_return','pharmacy_sales_returns',p_return_id,v_doc.return_date,-v_doc.total,'مرتجع مبيعات '||v_doc.return_number,p_actor_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_purchase_return_accounting_v1(
  p_pharmacy_id UUID,
  p_return_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.pharmacy_purchase_returns%ROWTYPE;
  v_entry UUID; v_cash UUID; v_payable UUID; v_inventory UUID; v_refund NUMERIC; v_supplier_credit NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_return_id::TEXT || ':purchase-return-accounting',0));
  SELECT id INTO v_entry FROM public.pharmacy_journal_entries WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_purchase_returns' AND source_id=p_return_id LIMIT 1;
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  SELECT * INTO v_doc FROM public.pharmacy_purchase_returns WHERE id=p_return_id AND pharmacy_id=p_pharmacy_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المشتريات غير موجود'; END IF;
  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_cash FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1010';
  SELECT id INTO v_payable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='2010';
  SELECT id INTO v_inventory FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1200';
  v_refund:=LEAST(GREATEST(COALESCE(v_doc.refund_amount,0),0),GREATEST(COALESCE(v_doc.total,0),0));
  v_supplier_credit:=GREATEST(COALESCE(v_doc.total,0)-v_refund,0);
  INSERT INTO public.pharmacy_journal_entries(pharmacy_id,branch_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by)
  VALUES(p_pharmacy_id,v_doc.branch_id,'PRT-'||replace(p_return_id::TEXT,'-',''),v_doc.created_at::DATE,v_doc.return_number,'قيد مرتجع مشتريات '||v_doc.return_number,'pharmacy_purchase_returns',p_return_id,v_doc.total,v_doc.total,COALESCE(p_actor_id,v_doc.created_by))
  RETURNING id INTO v_entry;
  IF v_refund>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_cash,v_refund,0,'مبلغ مسترد من المورد'); END IF;
  IF v_supplier_credit>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_payable,v_supplier_credit,0,'تخفيض رصيد المورد'); END IF;
  IF v_doc.total>0 THEN INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES(p_pharmacy_id,v_entry,v_inventory,0,v_doc.total,'تخفيض المخزون بمرتجع مشتريات'); END IF;
  RETURN v_entry;
END;
$$;


CREATE OR REPLACE FUNCTION public.adjust_loyalty_balance_v1(
  p_pharmacy_id UUID,
  p_partner_id UUID,
  p_actor_id UUID,
  p_operation TEXT,
  p_points INTEGER,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_client_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_operation TEXT := lower(BTRIM(COALESCE(p_operation,'')));
  v_points INTEGER := ABS(COALESCE(p_points,0));
  v_signed INTEGER;
  v_balance INTEGER := 0;
  v_total_earned INTEGER := 0;
  v_total_redeemed INTEGER := 0;
  v_total_expired INTEGER := 0;
  v_type TEXT;
  v_source UUID := COALESCE(p_client_request_id, gen_random_uuid());
  v_existing public.pharmacy_loyalty_transactions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'loyalty:write',v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id,'crm:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تعديل نقاط الولاء';
  END IF;
  IF v_operation NOT IN ('earn','redeem','adjust_add','adjust_deduct','expire') THEN
    RAISE EXCEPTION 'نوع حركة الولاء غير صالح';
  END IF;
  IF v_points <= 0 THEN RAISE EXCEPTION 'عدد النقاط يجب أن يكون أكبر من صفر'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pharmacy_partners WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id AND type IN ('customer','both')) THEN
    RAISE EXCEPTION 'العميل غير موجود';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_partner_id::TEXT||':loyalty',0));
  SELECT * INTO v_existing FROM public.pharmacy_loyalty_transactions
  WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id
    AND source_table='manual_loyalty' AND source_id=v_source LIMIT 1;
  IF FOUND THEN
    SELECT current_balance,total_earned,total_redeemed,total_expired
      INTO v_balance,v_total_earned,v_total_redeemed,v_total_expired
    FROM public.pharmacy_loyalty_balances WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id;
    RETURN jsonb_build_object('duplicate',true,'transaction',to_jsonb(v_existing),'balance',COALESCE(v_balance,0));
  END IF;

  INSERT INTO public.pharmacy_loyalty_balances(pharmacy_id,partner_id,total_earned,total_redeemed,total_expired,current_balance,updated_at)
  VALUES(p_pharmacy_id,p_partner_id,0,0,0,0,now())
  ON CONFLICT(pharmacy_id,partner_id) DO NOTHING;

  SELECT current_balance,total_earned,total_redeemed,total_expired
    INTO v_balance,v_total_earned,v_total_redeemed,v_total_expired
  FROM public.pharmacy_loyalty_balances
  WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id
  FOR UPDATE;

  IF v_operation IN ('redeem','adjust_deduct','expire') AND v_points > v_balance THEN
    RAISE EXCEPTION 'رصيد النقاط غير كافٍ';
  END IF;

  IF v_operation IN ('earn','adjust_add') THEN
    v_signed := v_points;
    v_type := CASE WHEN v_operation='earn' THEN 'earn' ELSE 'adjust' END;
    v_total_earned := v_total_earned + CASE WHEN v_operation='earn' THEN v_points ELSE 0 END;
  ELSIF v_operation='expire' THEN
    v_signed := -v_points; v_type := 'expire'; v_total_expired := v_total_expired + v_points;
  ELSE
    v_signed := -v_points; v_type := CASE WHEN v_operation='redeem' THEN 'redeem' ELSE 'adjust' END;
    v_total_redeemed := v_total_redeemed + CASE WHEN v_operation='redeem' THEN v_points ELSE 0 END;
  END IF;
  v_balance := v_balance + v_signed;

  UPDATE public.pharmacy_loyalty_balances SET
    total_earned=v_total_earned,total_redeemed=v_total_redeemed,total_expired=v_total_expired,
    current_balance=v_balance,updated_at=now()
  WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id;

  INSERT INTO public.pharmacy_loyalty_points(pharmacy_id,partner_id,points,updated_at)
  VALUES(p_pharmacy_id,p_partner_id,v_balance,now())
  ON CONFLICT(pharmacy_id,partner_id) DO UPDATE SET points=EXCLUDED.points,updated_at=now();

  INSERT INTO public.pharmacy_loyalty_transactions(
    pharmacy_id,partner_id,type,points,reference,source_table,source_id,balance_after,notes,created_by
  ) VALUES(
    p_pharmacy_id,p_partner_id,v_type,v_signed,NULLIF(BTRIM(p_reference),''),'manual_loyalty',v_source,v_balance,
    NULLIF(BTRIM(p_notes),''),v_actor
  ) RETURNING * INTO v_existing;

  RETURN jsonb_build_object('duplicate',false,'transaction',to_jsonb(v_existing),'balance',v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.next_patient_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pharmacy_patient_v1(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_default_pharmacy_accounts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_accounting_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_sale_loyalty_v1(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_sale_operations_v1(UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_purchase_accounting_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_expense_accounting_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sales_return_accounting_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_purchase_return_accounting_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_loyalty_balance_v1(UUID,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_patient_code(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_pharmacy_patient_v1(UUID,UUID,JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_default_pharmacy_accounts(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sale_accounting_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_sale_loyalty_v1(UUID,UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_sale_operations_v1(UUID,UUID,UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_accounting_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_expense_accounting_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_return_accounting_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_return_accounting_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_balance_v1(UUID,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,UUID) TO authenticated, service_role;

COMMIT;
