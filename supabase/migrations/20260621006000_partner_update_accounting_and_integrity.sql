BEGIN;

CREATE OR REPLACE FUNCTION public.update_partner_v1(
  p_pharmacy_id UUID,
  p_partner_id UUID,
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
  v_actor UUID := COALESCE(auth.uid(),p_actor_id);
  v_request UUID := COALESCE(p_client_request_id,gen_random_uuid());
  v_partner public.pharmacy_partners%ROWTYPE;
  v_updated public.pharmacy_partners%ROWTYPE;
  v_new_type TEXT;
  v_old_opening NUMERIC := 0;
  v_new_opening NUMERIC := 0;
  v_delta NUMERIC := 0;
  v_ledger JSONB;
  v_entry UUID;
  v_receivable UUID;
  v_payable UUID;
  v_capital UUID;
  v_abs NUMERIC;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'crm:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تعديل جهات الاتصال';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_partner_id::TEXT||':partner-update',0));
  SELECT * INTO v_partner FROM public.pharmacy_partners
  WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة الاتصال غير موجودة'; END IF;

  SELECT id INTO v_entry FROM public.pharmacy_journal_entries
  WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_partner_opening_adjustment' AND source_id=v_request LIMIT 1;
  IF v_entry IS NOT NULL THEN
    RETURN jsonb_build_object('partner',to_jsonb(v_partner),'duplicate',true,'journal_entry_id',v_entry);
  END IF;

  v_new_type := COALESCE(NULLIF(BTRIM(p_payload->>'type'),''),v_partner.type);
  IF v_new_type NOT IN ('customer','supplier','both') THEN RAISE EXCEPTION 'نوع جهة الاتصال غير صالح'; END IF;
  IF v_new_type<>v_partner.type AND (
    COALESCE(v_partner.balance,0)>0
    OR EXISTS(SELECT 1 FROM public.pharmacy_sales WHERE pharmacy_id=p_pharmacy_id AND customer_id=p_partner_id LIMIT 1)
    OR EXISTS(SELECT 1 FROM public.pharmacy_purchases WHERE pharmacy_id=p_pharmacy_id AND supplier_id=p_partner_id LIMIT 1)
    OR EXISTS(SELECT 1 FROM public.pharmacy_payments WHERE pharmacy_id=p_pharmacy_id AND partner_id=p_partner_id LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'لا يمكن تغيير نوع العميل/المورد بعد وجود رصيد أو حركات؛ أنشئ جهة اتصال مستقلة للحفاظ على الحسابات';
  END IF;

  v_old_opening := GREATEST(COALESCE(v_partner.opening_balance,0),0);
  v_new_opening := CASE WHEN p_payload ? 'opening_balance'
    THEN GREATEST(COALESCE(NULLIF(p_payload->>'opening_balance','')::NUMERIC,0),0)
    ELSE v_old_opening END;
  v_delta := round(v_new_opening-v_old_opening,2);

  UPDATE public.pharmacy_partners SET
    name=CASE WHEN p_payload ? 'name' THEN COALESCE(NULLIF(BTRIM(p_payload->>'name'),''),name) ELSE name END,
    type=v_new_type,
    phone=CASE WHEN p_payload ? 'phone' THEN NULLIF(BTRIM(p_payload->>'phone'),'') ELSE phone END,
    email=CASE WHEN p_payload ? 'email' THEN NULLIF(BTRIM(p_payload->>'email'),'') ELSE email END,
    address=CASE WHEN p_payload ? 'address' THEN NULLIF(BTRIM(p_payload->>'address'),'') ELSE address END,
    tax_id=CASE WHEN p_payload ? 'tax_id' THEN NULLIF(BTRIM(p_payload->>'tax_id'),'') ELSE tax_id END,
    opening_balance=v_new_opening,
    credit_limit=CASE WHEN p_payload ? 'credit_limit' THEN GREATEST(COALESCE(NULLIF(p_payload->>'credit_limit','')::NUMERIC,0),0) ELSE credit_limit END,
    notes=CASE WHEN p_payload ? 'notes' THEN NULLIF(BTRIM(p_payload->>'notes'),'') ELSE notes END,
    status=CASE WHEN p_payload ? 'status' AND p_payload->>'status'='inactive' THEN 'inactive' ELSE CASE WHEN p_payload ? 'status' THEN 'active' ELSE status END END,
    updated_at=now()
  WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id
  RETURNING * INTO v_updated;

  IF v_delta<>0 THEN
    SELECT public.record_partner_balance_entry_v1(
      p_pharmacy_id,NULL,p_partner_id,'pharmacy_partner_opening_adjustment',v_request,
      'adjustment',v_delta,'تعديل الرصيد الافتتاحي',v_actor,true
    ) INTO v_ledger;

    PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
    SELECT id INTO v_receivable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='1100';
    SELECT id INTO v_payable FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='2010';
    SELECT id INTO v_capital FROM public.pharmacy_chart_of_accounts WHERE pharmacy_id=p_pharmacy_id AND code='3010';
    v_abs:=ABS(v_delta);

    INSERT INTO public.pharmacy_journal_entries(
      pharmacy_id,entry_number,entry_date,reference,description,source_table,source_id,total_debit,total_credit,created_by
    ) VALUES(
      p_pharmacy_id,'OADJ-'||replace(v_request::TEXT,'-',''),CURRENT_DATE,v_updated.name,
      'تعديل الرصيد الافتتاحي لجهة الاتصال '||v_updated.name,
      'pharmacy_partner_opening_adjustment',v_request,v_abs,v_abs,v_actor
    ) RETURNING id INTO v_entry;

    IF v_updated.type='supplier' THEN
      IF v_delta>0 THEN
        INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
          (p_pharmacy_id,v_entry,v_capital,v_abs,0,'زيادة رصيد افتتاحي للمورد'),
          (p_pharmacy_id,v_entry,v_payable,0,v_abs,'زيادة ذمم الموردين');
      ELSE
        INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
          (p_pharmacy_id,v_entry,v_payable,v_abs,0,'تخفيض ذمم الموردين'),
          (p_pharmacy_id,v_entry,v_capital,0,v_abs,'تخفيض رصيد افتتاحي للمورد');
      END IF;
    ELSE
      IF v_delta>0 THEN
        INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
          (p_pharmacy_id,v_entry,v_receivable,v_abs,0,'زيادة ذمم العملاء'),
          (p_pharmacy_id,v_entry,v_capital,0,v_abs,'زيادة مقابل الرصيد الافتتاحي');
      ELSE
        INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description) VALUES
          (p_pharmacy_id,v_entry,v_capital,v_abs,0,'تخفيض مقابل الرصيد الافتتاحي'),
          (p_pharmacy_id,v_entry,v_receivable,0,v_abs,'تخفيض ذمم العملاء');
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_updated FROM public.pharmacy_partners WHERE id=p_partner_id AND pharmacy_id=p_pharmacy_id;
  RETURN jsonb_build_object('partner',to_jsonb(v_updated),'opening_delta',v_delta,'ledger',v_ledger,'journal_entry_id',v_entry,'duplicate',false);
END;
$$;

REVOKE ALL ON FUNCTION public.update_partner_v1(UUID,UUID,UUID,JSONB,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_v1(UUID,UUID,UUID,JSONB,UUID) TO authenticated,service_role;

COMMIT;
