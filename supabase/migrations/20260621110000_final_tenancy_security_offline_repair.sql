-- FINAL TENANCY / SECURITY / OFFLINE REPAIR
-- Existing databases: run this file once after prior migrations.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_developer_users_user_id ON public.developer_users(user_id);

CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT COALESCE(p_user_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.developer_users du
    WHERE du.user_id=p_user_id AND du.is_active=true
  ),false);
$$;

CREATE OR REPLACE FUNCTION public.is_pharmacy_owner(p_pharmacy_id UUID,p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT COALESCE(p_user_id IS NOT NULL AND p_pharmacy_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.pharmacies p
    WHERE p.id=p_pharmacy_id AND p.owner_id=p_user_id AND p.status<>'closed'
  ),false);
$$;

CREATE OR REPLACE FUNCTION public.has_pharmacy_access(p_pharmacy_id UUID,p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL AND p_pharmacy_id IS NOT NULL AND (
      public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id,p_user_id)
      OR EXISTS(
        SELECT 1 FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id=p_pharmacy_id AND pp.user_id=p_user_id
          AND pp.is_active=true AND pp.role<>'no-access'
      )
    ),false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_pharmacy_id UUID,p_branch_id UUID,p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT COALESCE(
    public.has_pharmacy_access(p_pharmacy_id,p_user_id)
    AND (
      p_branch_id IS NULL
      OR (
        EXISTS(
          SELECT 1 FROM public.pharmacy_branches b
          WHERE b.id=p_branch_id AND b.pharmacy_id=p_pharmacy_id AND b.status<>'closed'
        )
        AND (
          public.is_developer(p_user_id)
          OR public.is_pharmacy_owner(p_pharmacy_id,p_user_id)
          OR EXISTS(
            SELECT 1 FROM public.pharmacy_profiles pp
            WHERE pp.pharmacy_id=p_pharmacy_id AND pp.user_id=p_user_id
              AND pp.is_active=true AND pp.role<>'no-access'
              AND (pp.branch_id IS NULL OR pp.branch_id=p_branch_id)
          )
        )
      )
    ),false
  );
$$;

-- A platform developer is not a pharmacy employee/branch member.
DELETE FROM public.pharmacy_profiles pp
USING public.developer_users du
WHERE pp.user_id=du.user_id AND du.is_active=true;

UPDATE public.pharmacy_profiles
SET role='no-access',is_active=false,updated_at=now()
WHERE role='developer';

UPDATE public.user_profiles up
SET global_role=CASE
  WHEN EXISTS(SELECT 1 FROM public.pharmacies p WHERE p.owner_id=up.user_id AND p.status<>'closed') THEN 'owner'
  ELSE 'no-access'
END,updated_at=now()
WHERE up.global_role='developer'
  AND NOT EXISTS(SELECT 1 FROM public.developer_users du WHERE du.user_id=up.user_id AND du.is_active=true);

CREATE OR REPLACE FUNCTION public.reject_developer_pharmacy_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
  IF public.is_developer(NEW.user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يمكن ربطه بعضوية صيدلية أو فرع';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reject_developer_pharmacy_membership ON public.pharmacy_profiles;
CREATE TRIGGER trg_reject_developer_pharmacy_membership
BEFORE INSERT OR UPDATE OF user_id,pharmacy_id,branch_id,role,is_active ON public.pharmacy_profiles
FOR EACH ROW EXECUTE FUNCTION public.reject_developer_pharmacy_membership();

-- Reassign legacy developer-owned pharmacies when a real active owner membership exists.
WITH replacement_owner AS (
  SELECT DISTINCT ON (pp.pharmacy_id) pp.pharmacy_id,pp.user_id
  FROM public.pharmacy_profiles pp
  JOIN public.pharmacies p ON p.id=pp.pharmacy_id
  WHERE public.is_developer(p.owner_id)
    AND pp.is_active=true AND pp.role='owner'
    AND NOT public.is_developer(pp.user_id)
  ORDER BY pp.pharmacy_id,pp.user_id::TEXT
)
UPDATE public.pharmacies p
SET owner_id=r.user_id,updated_at=now()
FROM replacement_owner r
WHERE p.id=r.pharmacy_id AND public.is_developer(p.owner_id);

CREATE OR REPLACE FUNCTION public.reject_developer_pharmacy_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
  IF public.is_developer(NEW.owner_id) THEN
    RAISE EXCEPTION 'حساب المطور لا يمكن تسجيله كصاحب صيدلية';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reject_developer_pharmacy_ownership ON public.pharmacies;
CREATE TRIGGER trg_reject_developer_pharmacy_ownership
BEFORE INSERT OR UPDATE OF owner_id ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.reject_developer_pharmacy_ownership();

-- Signup metadata and email never grant developer authority.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_project_name TEXT;
  v_currency TEXT;
  v_country TEXT;
  v_timezone TEXT;
  v_city TEXT;
  v_pharmacy_id UUID;
  v_branch_id UUID;
BEGIN
  v_full_name:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name',''),NULLIF(NEW.raw_user_meta_data->>'display_name',''),split_part(COALESCE(NEW.email,'user'),'@',1));
  v_phone:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone',''),NULLIF(NEW.raw_user_meta_data->>'mobile',''));
  v_role:=CASE
    WHEN COALESCE(NEW.raw_user_meta_data->>'role','') IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access')
      THEN NEW.raw_user_meta_data->>'role'
    ELSE 'owner'
  END;
  v_project_name:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'project_name',''),NULLIF(NEW.raw_user_meta_data->>'pharmacy_name',''),v_full_name,NEW.email,'صيدلية جديدة');
  v_currency:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'currency',''),'EGP');
  v_country:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'country',''),'EG');
  v_timezone:=COALESCE(NULLIF(NEW.raw_user_meta_data->>'timezone',''),'Africa/Cairo');
  v_city:=NULLIF(NEW.raw_user_meta_data->>'city','');

  INSERT INTO public.user_profiles(user_id,email,username,full_name,phone,avatar_url,global_role,is_active)
  VALUES(NEW.id,COALESCE(NEW.email,NEW.id::TEXT||'@user.local'),NULLIF(NEW.raw_user_meta_data->>'username',''),v_full_name,v_phone,NEW.raw_user_meta_data->>'avatar_url',v_role,true)
  ON CONFLICT(user_id) DO UPDATE SET
    email=EXCLUDED.email,
    username=COALESCE(EXCLUDED.username,public.user_profiles.username),
    full_name=COALESCE(EXCLUDED.full_name,public.user_profiles.full_name),
    phone=COALESCE(EXCLUDED.phone,public.user_profiles.phone),
    avatar_url=COALESCE(EXCLUDED.avatar_url,public.user_profiles.avatar_url),
    global_role=CASE WHEN public.is_developer(EXCLUDED.user_id) THEN 'developer' ELSE EXCLUDED.global_role END,
    is_active=true,updated_at=now();

  IF v_role='owner' THEN
    INSERT INTO public.pharmacies(owner_id,name,legal_name,currency,country,timezone,phone,email,address,status,plan)
    VALUES(NEW.id,v_project_name,v_project_name,v_currency,v_country,v_timezone,v_phone,NEW.email,v_city,'active','trial')
    ON CONFLICT(owner_id) DO UPDATE SET
      status=CASE WHEN public.pharmacies.status='closed' THEN 'active' ELSE public.pharmacies.status END,
      updated_at=now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches(pharmacy_id,code,name,address,phone,is_default,status)
    VALUES(v_pharmacy_id,'MAIN','الفرع الرئيسي',v_city,v_phone,true,'active')
    ON CONFLICT(pharmacy_id,code) DO UPDATE SET is_default=true,status='active',updated_at=now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.pharmacy_profiles(pharmacy_id,branch_id,user_id,email,full_name,phone,title,role,is_active,permissions,denied_permissions,invite_status)
    VALUES(v_pharmacy_id,v_branch_id,NEW.id,NEW.email,v_full_name,v_phone,'صاحب الصيدلية','owner',true,'[]'::jsonb,'[]'::jsonb,'created')
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
      branch_id=COALESCE(public.pharmacy_profiles.branch_id,EXCLUDED.branch_id),
      email=COALESCE(EXCLUDED.email,public.pharmacy_profiles.email),
      full_name=COALESCE(EXCLUDED.full_name,public.pharmacy_profiles.full_name),
      phone=COALESCE(EXCLUDED.phone,public.pharmacy_profiles.phone),
      title='صاحب الصيدلية',role='owner',is_active=true,disabled_reason=NULL,updated_at=now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

ALTER TABLE public.developer_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS developer_users_platform_read ON public.developer_users;
CREATE POLICY developer_users_platform_read ON public.developer_users
FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_developer(auth.uid()));
REVOKE ALL ON TABLE public.developer_users FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.developer_users FROM authenticated;
GRANT SELECT ON TABLE public.developer_users TO authenticated;

-- Defensive column and idempotency repairs for partially-applied migrations.
DO $$
BEGIN
  IF to_regclass('public.pharmacy_purchase_returns') IS NOT NULL AND to_regclass('public.pharmacy_partners') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pharmacy_purchase_returns ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL';
  END IF;
  IF to_regclass('public.pharmacy_sales_returns') IS NOT NULL AND to_regclass('public.pharmacy_partners') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pharmacy_sales_returns ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL';
  END IF;
  IF to_regclass('public.pharmacy_sales_returns') IS NOT NULL AND to_regclass('public.pharmacy_patients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pharmacy_sales_returns ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.pharmacy_patients(id) ON DELETE SET NULL';
  END IF;
  IF to_regclass('public.pharmacy_partners') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pharmacy_partners ADD COLUMN IF NOT EXISTS client_request_id UUID';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_partners_client_request ON public.pharmacy_partners(pharmacy_id,client_request_id) WHERE client_request_id IS NOT NULL';
  END IF;
  IF to_regclass('public.pharmacy_patient_visits') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pharmacy_patient_visits ADD COLUMN IF NOT EXISTS client_request_id UUID';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_client_request ON public.pharmacy_patient_visits(pharmacy_id,client_request_id) WHERE client_request_id IS NOT NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pharmacy_purchase_returns' AND column_name='supplier_id') THEN
    EXECUTE $q$UPDATE public.pharmacy_purchase_returns pr SET supplier_id=p.supplier_id FROM public.pharmacy_purchases p WHERE pr.purchase_id=p.id AND pr.pharmacy_id=p.pharmacy_id AND pr.supplier_id IS NULL AND p.supplier_id IS NOT NULL$q$;
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pharmacy_sales_returns' AND column_name='customer_id')
     AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pharmacy_sales_returns' AND column_name='patient_id') THEN
    EXECUTE $q$UPDATE public.pharmacy_sales_returns sr SET customer_id=COALESCE(sr.customer_id,s.customer_id),patient_id=COALESCE(sr.patient_id,s.patient_id) FROM public.pharmacy_sales s WHERE sr.sale_id=s.id AND sr.pharmacy_id=s.pharmacy_id AND (sr.customer_id IS NULL OR sr.patient_id IS NULL)$q$;
  END IF;
END;
$$;

-- Recreate the report with explicit aliases (fixes reserved-word alias errors).
DROP FUNCTION IF EXISTS public.get_daily_sales_summary(UUID,DATE,DATE,UUID);
CREATE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,p_from_date DATE DEFAULT (CURRENT_DATE-30),p_to_date DATE DEFAULT CURRENT_DATE,p_branch_id UUID DEFAULT NULL
) RETURNS TABLE(
  sale_date DATE,invoice_count BIGINT,total_sales NUMERIC,total_discounts NUMERIC,total_tax NUMERIC,
  total_cost NUMERIC,total_profit NUMERIC,cash_sales NUMERIC,card_sales NUMERIC,credit_sales NUMERIC,item_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  WITH sales_headers AS (
    SELECT s.sale_date::DATE AS report_date,COUNT(*)::BIGINT AS invoices,
      COALESCE(SUM(s.total),0)::NUMERIC AS sales,COALESCE(SUM(s.discount_total),0)::NUMERIC AS discounts,
      COALESCE(SUM(s.tax_total),0)::NUMERIC AS tax,
      COALESCE(SUM(CASE WHEN s.payment_method='cash' THEN s.paid_amount ELSE 0 END),0)::NUMERIC AS cash,
      COALESCE(SUM(CASE WHEN s.payment_method IN ('card','wallet','bank','bank-transfer','mixed') THEN s.paid_amount ELSE 0 END),0)::NUMERIC AS cards,
      COALESCE(SUM(CASE WHEN s.payment_method='credit' THEN s.total ELSE 0 END),0)::NUMERIC AS credit
    FROM public.pharmacy_sales s
    WHERE s.pharmacy_id=p_pharmacy_id AND public.has_pharmacy_access(p_pharmacy_id,auth.uid())
      AND (p_branch_id IS NULL OR public.has_branch_access(p_pharmacy_id,p_branch_id,auth.uid()))
      AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
      AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    GROUP BY s.sale_date::DATE
  ),sale_costs AS (
    SELECT s.sale_date::DATE AS report_date,COALESCE(SUM(sl.purchase_price*sl.quantity),0)::NUMERIC AS cost,
      COALESCE(SUM(sl.quantity),0)::BIGINT AS sold_item_count
    FROM public.pharmacy_sale_lines sl JOIN public.pharmacy_sales s ON s.id=sl.sale_id AND s.pharmacy_id=sl.pharmacy_id
    WHERE sl.pharmacy_id=p_pharmacy_id AND public.has_pharmacy_access(p_pharmacy_id,auth.uid())
      AND (p_branch_id IS NULL OR public.has_branch_access(p_pharmacy_id,p_branch_id,auth.uid()))
      AND s.voided_at IS NULL AND s.status NOT IN ('void','cancelled')
      AND s.sale_date::DATE BETWEEN p_from_date AND p_to_date AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    GROUP BY s.sale_date::DATE
  ),return_headers AS (
    SELECT r.return_date::DATE AS report_date,COALESCE(SUM(r.total),0)::NUMERIC AS return_amount
    FROM public.pharmacy_sales_returns r
    WHERE r.pharmacy_id=p_pharmacy_id AND public.has_pharmacy_access(p_pharmacy_id,auth.uid())
      AND (p_branch_id IS NULL OR public.has_branch_access(p_pharmacy_id,p_branch_id,auth.uid()))
      AND r.voided_at IS NULL AND r.return_date::DATE BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR r.branch_id=p_branch_id)
    GROUP BY r.return_date::DATE
  ),return_costs AS (
    SELECT r.return_date::DATE AS report_date,COALESCE(SUM(rl.quantity*COALESCE(sl.purchase_price,0)),0)::NUMERIC AS returned_cost,
      COALESCE(SUM(rl.quantity),0)::BIGINT AS returned_item_count
    FROM public.pharmacy_sales_returns r
    JOIN public.pharmacy_sales_return_lines rl ON rl.return_id=r.id AND rl.pharmacy_id=r.pharmacy_id
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.id=rl.sale_line_id AND sl.pharmacy_id=rl.pharmacy_id
    WHERE r.pharmacy_id=p_pharmacy_id AND public.has_pharmacy_access(p_pharmacy_id,auth.uid())
      AND (p_branch_id IS NULL OR public.has_branch_access(p_pharmacy_id,p_branch_id,auth.uid()))
      AND r.voided_at IS NULL AND r.return_date::DATE BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR r.branch_id=p_branch_id)
    GROUP BY r.return_date::DATE
  )
  SELECT h.report_date,h.invoices,(h.sales-COALESCE(rh.return_amount,0))::NUMERIC,h.discounts,h.tax,
    (COALESCE(sc.cost,0)-COALESCE(rc.returned_cost,0))::NUMERIC,
    ((h.sales-COALESCE(rh.return_amount,0))-(COALESCE(sc.cost,0)-COALESCE(rc.returned_cost,0)))::NUMERIC,
    h.cash,h.cards,h.credit,GREATEST(COALESCE(sc.sold_item_count,0)-COALESCE(rc.returned_item_count,0),0)::BIGINT
  FROM sales_headers h
  LEFT JOIN sale_costs sc ON sc.report_date=h.report_date
  LEFT JOIN return_headers rh ON rh.report_date=h.report_date
  LEFT JOIN return_costs rc ON rc.report_date=h.report_date
  ORDER BY h.report_date DESC;
$$;

REVOKE ALL ON FUNCTION public.is_developer(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_pharmacy_owner(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_pharmacy_access(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_branch_access(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_sales_summary(UUID,DATE,DATE,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_developer(UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_pharmacy_owner(UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.has_pharmacy_access(UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.has_branch_access(UUID,UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID,DATE,DATE,UUID) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
