BEGIN;

-- Manual patient visits are first-class, idempotent offline operations.

ALTER TABLE public.pharmacy_partners
  ADD COLUMN IF NOT EXISTS client_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_partners_client_request
  ON public.pharmacy_partners(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Backfill relations for historic returns without changing financial values.
UPDATE public.pharmacy_purchase_returns r
SET supplier_id = p.supplier_id
FROM public.pharmacy_purchases p
WHERE r.purchase_id = p.id
  AND r.pharmacy_id = p.pharmacy_id
  AND r.supplier_id IS NULL
  AND p.supplier_id IS NOT NULL;

UPDATE public.pharmacy_sales_returns r
SET customer_id = s.customer_id,
    patient_id = s.patient_id
FROM public.pharmacy_sales s
WHERE r.sale_id = s.id
  AND r.pharmacy_id = s.pharmacy_id
  AND (r.customer_id IS NULL OR r.patient_id IS NULL);

ALTER TABLE public.pharmacy_patient_visits
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_client_request
  ON public.pharmacy_patient_visits(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_patient_visit_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_patient_id UUID,
  p_visit_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_visit_date TIMESTAMPTZ DEFAULT now(),
  p_actor_id UUID DEFAULT NULL,
  p_client_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_patient public.pharmacy_patients%ROWTYPE;
  v_visit public.pharmacy_patient_visits%ROWTYPE;
  v_type TEXT := COALESCE(NULLIF(BTRIM(p_visit_type), ''), 'manual');
  v_request UUID := COALESCE(p_client_request_id, gen_random_uuid());
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'crm:write', v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل زيارة مريض';
  END IF;
  IF v_type NOT IN ('consultation','medication_review','manual','other') THEN
    RAISE EXCEPTION 'نوع الزيارة غير صالح';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':patient-visit:' || v_request::TEXT, 0));

  SELECT * INTO v_visit
  FROM public.pharmacy_patient_visits
  WHERE pharmacy_id = p_pharmacy_id AND client_request_id = v_request
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('visit', to_jsonb(v_visit), 'duplicate', true);
  END IF;

  SELECT * INTO v_patient
  FROM public.pharmacy_patients
  WHERE id = p_patient_id AND pharmacy_id = p_pharmacy_id AND status <> 'archived'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف المريض غير موجود أو مؤرشف'; END IF;

  INSERT INTO public.pharmacy_patient_visits(
    id, pharmacy_id, branch_id, patient_id, visit_type, reference_table,
    visit_date, total_amount, notes, created_by, client_request_id
  ) VALUES (
    gen_random_uuid(), p_pharmacy_id, p_branch_id, p_patient_id, v_type, 'manual_patient_visit',
    COALESCE(p_visit_date, now()), 0, NULLIF(BTRIM(p_notes), ''), v_actor, v_request
  ) RETURNING * INTO v_visit;

  UPDATE public.pharmacy_patients
  SET visit_count = COALESCE(visit_count, 0) + 1,
      last_visit_date = GREATEST(COALESCE(last_visit_date, '-infinity'::timestamptz), v_visit.visit_date),
      updated_at = now()
  WHERE id = p_patient_id AND pharmacy_id = p_pharmacy_id;

  RETURN jsonb_build_object('visit', to_jsonb(v_visit), 'duplicate', false);
END;
$$;

-- Opening balances must be represented in both the partner ledger and general ledger.
CREATE OR REPLACE FUNCTION public.post_partner_opening_balance_v1(
  p_pharmacy_id UUID,
  p_partner_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_partner public.pharmacy_partners%ROWTYPE;
  v_entry UUID;
  v_receivable UUID;
  v_payable UUID;
  v_capital UUID;
  v_amount NUMERIC;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'financials:write', v_actor)
     AND NOT public.user_has_permission(p_pharmacy_id, 'crm:write', v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تسجيل الرصيد الافتتاحي';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_partner_id::TEXT || ':opening-balance', 0));
  SELECT * INTO v_partner
  FROM public.pharmacy_partners
  WHERE id = p_partner_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة الاتصال غير موجودة'; END IF;

  v_amount := GREATEST(COALESCE(v_partner.opening_balance, 0), 0);
  IF v_amount = 0 THEN RETURN jsonb_build_object('journal_entry_id', NULL, 'amount', 0); END IF;

  PERFORM public.record_partner_balance_entry_v1(
    p_pharmacy_id, NULL, p_partner_id, 'pharmacy_partners', p_partner_id,
    'opening', v_amount, 'الرصيد الافتتاحي', v_actor, false
  );

  SELECT id INTO v_entry
  FROM public.pharmacy_journal_entries
  WHERE pharmacy_id = p_pharmacy_id AND source_table = 'pharmacy_partner_opening' AND source_id = p_partner_id
  LIMIT 1;
  IF v_entry IS NOT NULL THEN
    RETURN jsonb_build_object('journal_entry_id', v_entry, 'amount', v_amount, 'duplicate', true);
  END IF;

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_receivable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1100';
  SELECT id INTO v_payable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='2010';
  SELECT id INTO v_capital FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='3010';

  INSERT INTO public.pharmacy_journal_entries(
    pharmacy_id, entry_number, entry_date, reference, description,
    source_table, source_id, total_debit, total_credit, created_by
  ) VALUES (
    p_pharmacy_id, 'OPEN-' || replace(p_partner_id::TEXT,'-',''), CURRENT_DATE,
    v_partner.name, 'الرصيد الافتتاحي لجهة الاتصال ' || v_partner.name,
    'pharmacy_partner_opening', p_partner_id, v_amount, v_amount, v_actor
  ) RETURNING id INTO v_entry;

  IF v_partner.type = 'supplier' THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES
      (p_pharmacy_id,v_entry,v_capital,v_amount,0,'رصيد افتتاحي مستحق للمورد'),
      (p_pharmacy_id,v_entry,v_payable,0,v_amount,'ذمم الموردين الافتتاحية');
  ELSE
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES
      (p_pharmacy_id,v_entry,v_receivable,v_amount,0,'ذمم العملاء الافتتاحية'),
      (p_pharmacy_id,v_entry,v_capital,0,v_amount,'مقابل الرصيد الافتتاحي');
  END IF;

  RETURN jsonb_build_object('journal_entry_id', v_entry, 'amount', v_amount, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_partner_v1(
  p_pharmacy_id UUID,
  p_actor_id UUID,
  p_payload JSONB,
  p_client_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_actor_id);
  v_request UUID := COALESCE(p_client_request_id, gen_random_uuid());
  v_partner public.pharmacy_partners%ROWTYPE;
  v_name TEXT := NULLIF(BTRIM(p_payload->>'name'), '');
  v_type TEXT := COALESCE(NULLIF(BTRIM(p_payload->>'type'), ''), 'customer');
  v_opening NUMERIC := GREATEST(COALESCE(NULLIF(p_payload->>'opening_balance','')::NUMERIC, 0), 0);
  v_accounting JSONB;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'crm:write', v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إضافة جهات اتصال';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  IF v_type NOT IN ('customer','supplier','both') THEN RAISE EXCEPTION 'نوع جهة الاتصال غير صالح'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':partner:' || v_request::TEXT, 0));
  SELECT * INTO v_partner FROM public.pharmacy_partners
  WHERE pharmacy_id=p_pharmacy_id AND client_request_id=v_request LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('partner',to_jsonb(v_partner),'duplicate',true); END IF;

  INSERT INTO public.pharmacy_partners(
    id, pharmacy_id, type, name, phone, email, address, tax_id, opening_balance, balance,
    credit_limit, notes, status, client_request_id
  ) VALUES (
    gen_random_uuid(), p_pharmacy_id, v_type, v_name, NULLIF(BTRIM(p_payload->>'phone'), ''),
    NULLIF(BTRIM(p_payload->>'email'), ''), NULLIF(BTRIM(p_payload->>'address'), ''),
    NULLIF(BTRIM(p_payload->>'tax_id'), ''), v_opening, v_opening,
    GREATEST(COALESCE(NULLIF(p_payload->>'credit_limit','')::NUMERIC,0),0),
    NULLIF(BTRIM(p_payload->>'notes'), ''),
    CASE WHEN p_payload->>'status'='inactive' THEN 'inactive' ELSE 'active' END, v_request
  ) RETURNING * INTO v_partner;

  IF v_opening > 0 THEN
    v_accounting := public.post_partner_opening_balance_v1(p_pharmacy_id, v_partner.id, v_actor);
  END IF;

  RETURN jsonb_build_object('partner',to_jsonb(v_partner),'accounting',v_accounting,'duplicate',false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_patient_visit_v1(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_partner_opening_balance_v1(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_partner_v1(UUID,UUID,JSONB,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_patient_visit_v1(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_partner_opening_balance_v1(UUID,UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partner_v1(UUID,UUID,JSONB,UUID) TO authenticated, service_role;

COMMIT;
