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

-- ===== 20260621111000_domain_units_delivery_workflows.sql =====
BEGIN;

-- ============================================================================
-- DOMAIN UNITS: categorized units, quantity precision and integer enforcement
-- ============================================================================

ALTER TABLE public.pharmacy_units
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS quantity_mode TEXT NOT NULL DEFAULT 'discrete',
  ADD COLUMN IF NOT EXISTS quantity_scale SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_fraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1000;

UPDATE public.pharmacy_units
SET
  category = CASE
    WHEN lower(trim(unit_name)) IN ('علبة','علبه','عبوة','عبوه','كرتونة','كرتونه','شريط','زجاجة','زجاجه','أنبوبة','انبوبه','كيس') THEN 'package'
    WHEN lower(trim(unit_name)) IN ('قرص','حباية','حبايه','كبسولة','كبسوله','أمبول','امبول','فيال','حقنة','حقنه','سرنجة','سرنجه','لبوس','لبوسة','لبوسه','لاصقة','لاصقه','نقطة','نقطه','جرعة','جرعه','قطعة','قطعه','وحدة','وحده') THEN 'dosage'
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
    WHEN lower(trim(unit_name)) IN ('ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 'mass'
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
    WHEN lower(trim(unit_name)) IN ('خدمة','خدمه') THEN 'service'
    ELSE COALESCE(NULLIF(category,''),'other')
  END,
  quantity_mode = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN 'continuous'
    ELSE 'discrete'
  END,
  quantity_scale = CASE
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 2
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 3
    ELSE 0
  END,
  allows_fraction = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN true
    ELSE false
  END,
  updated_at = now();

ALTER TABLE public.pharmacy_units
  DROP CONSTRAINT IF EXISTS pharmacy_units_category_check,
  ADD CONSTRAINT pharmacy_units_category_check
    CHECK (category IN ('package','dosage','volume','mass','length','service','other')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_quantity_mode_check,
  ADD CONSTRAINT pharmacy_units_quantity_mode_check
    CHECK (quantity_mode IN ('discrete','continuous')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_quantity_scale_check,
  ADD CONSTRAINT pharmacy_units_quantity_scale_check
    CHECK (quantity_scale BETWEEN 0 AND 6) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_units_fraction_policy_check,
  ADD CONSTRAINT pharmacy_units_fraction_policy_check
    CHECK (
      (quantity_mode = 'discrete' AND quantity_scale = 0 AND allows_fraction = false)
      OR
      (quantity_mode = 'continuous' AND quantity_scale BETWEEN 0 AND 6 AND allows_fraction = (quantity_scale > 0))
    ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_units_code
  ON public.pharmacy_units(pharmacy_id, upper(code))
  WHERE code IS NOT NULL AND trim(code) <> '';

CREATE INDEX IF NOT EXISTS idx_pharmacy_units_category_active
  ON public.pharmacy_units(pharmacy_id, category, is_active, sort_order, unit_name);

ALTER TABLE public.pharmacy_item_units
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.pharmacy_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS quantity_mode TEXT NOT NULL DEFAULT 'discrete',
  ADD COLUMN IF NOT EXISTS quantity_scale SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_fraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sale_enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE public.pharmacy_item_units item_unit
SET unit_id = unit.id,
    unit_code = COALESCE(item_unit.unit_code, unit.code),
    category = COALESCE(NULLIF(unit.category,''), 'other'),
    quantity_mode = COALESCE(NULLIF(unit.quantity_mode,''), 'discrete'),
    quantity_scale = COALESCE(unit.quantity_scale, 0),
    allows_fraction = COALESCE(unit.allows_fraction, false)
FROM public.pharmacy_units unit
WHERE unit.pharmacy_id = item_unit.pharmacy_id
  AND lower(trim(unit.unit_name)) = lower(trim(item_unit.unit_name));

UPDATE public.pharmacy_item_units
SET
  category = CASE
    WHEN lower(trim(unit_name)) IN ('علبة','علبه','عبوة','عبوه','كرتونة','كرتونه','شريط','زجاجة','زجاجه','أنبوبة','انبوبه','كيس') THEN 'package'
    WHEN lower(trim(unit_name)) IN ('قرص','حباية','حبايه','كبسولة','كبسوله','أمبول','امبول','فيال','حقنة','حقنه','سرنجة','سرنجه','لبوس','لبوسة','لبوسه','لاصقة','لاصقه','نقطة','نقطه','جرعة','جرعه','قطعة','قطعه','وحدة','وحده') THEN 'dosage'
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
    WHEN lower(trim(unit_name)) IN ('ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 'mass'
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
    ELSE COALESCE(NULLIF(category,''),'other')
  END,
  quantity_mode = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN 'continuous'
    ELSE 'discrete'
  END,
  quantity_scale = CASE
    WHEN lower(trim(unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 2
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg') THEN 3
    ELSE 0
  END,
  allows_fraction = CASE
    WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN true
    ELSE false
  END,
  factor = CASE WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN factor ELSE GREATEST(round(factor),1) END,
  qty_per_main_unit = CASE WHEN lower(trim(unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN COALESCE(qty_per_main_unit,factor,1) ELSE GREATEST(round(COALESCE(qty_per_main_unit,factor,1)),1) END,
  updated_at = now();

ALTER TABLE public.pharmacy_item_units
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_category_check,
  ADD CONSTRAINT pharmacy_item_units_category_check
    CHECK (category IN ('package','dosage','volume','mass','length','service','other')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_quantity_mode_check,
  ADD CONSTRAINT pharmacy_item_units_quantity_mode_check
    CHECK (quantity_mode IN ('discrete','continuous')) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_quantity_scale_check,
  ADD CONSTRAINT pharmacy_item_units_quantity_scale_check
    CHECK (quantity_scale BETWEEN 0 AND 6) NOT VALID,
  DROP CONSTRAINT IF EXISTS pharmacy_item_units_fraction_policy_check,
  ADD CONSTRAINT pharmacy_item_units_fraction_policy_check
    CHECK (
      (quantity_mode = 'discrete' AND quantity_scale = 0 AND allows_fraction = false AND factor = trunc(factor) AND COALESCE(qty_per_main_unit,1) = trunc(COALESCE(qty_per_main_unit,1)))
      OR
      (quantity_mode = 'continuous' AND quantity_scale BETWEEN 0 AND 6 AND allows_fraction = (quantity_scale > 0))
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_item_units_unit_policy
  ON public.pharmacy_item_units(pharmacy_id, item_id, quantity_mode, sale_enabled, purchase_enabled);

CREATE OR REPLACE FUNCTION public.apply_unit_domain_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_unit public.pharmacy_units%ROWTYPE;
BEGIN
  NEW.unit_name := trim(NEW.unit_name);
  IF NEW.unit_name = '' THEN RAISE EXCEPTION 'unit_name_required'; END IF;

  IF TG_TABLE_NAME = 'pharmacy_units' THEN
    NEW.code := NULLIF(upper(trim(NEW.code)), '');
    NEW.category := COALESCE(NULLIF(NEW.category,''),'other');
    NEW.quantity_mode := COALESCE(NULLIF(NEW.quantity_mode,''),'discrete');
    IF NEW.quantity_mode = 'discrete' THEN
      NEW.quantity_scale := 0;
      NEW.allows_fraction := false;
    ELSE
      NEW.quantity_scale := LEAST(GREATEST(COALESCE(NEW.quantity_scale,3),0),6);
      NEW.allows_fraction := NEW.quantity_scale > 0;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM public.pharmacy_units
    WHERE id = NEW.unit_id AND pharmacy_id = NEW.pharmacy_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_in_pharmacy'; END IF;
  ELSE
    SELECT * INTO v_unit
    FROM public.pharmacy_units
    WHERE pharmacy_id = NEW.pharmacy_id
      AND lower(trim(unit_name)) = lower(trim(NEW.unit_name))
    ORDER BY is_active DESC, created_at
    LIMIT 1;
    IF FOUND THEN NEW.unit_id := v_unit.id; END IF;
  END IF;

  IF FOUND THEN
    NEW.unit_name := v_unit.unit_name;
    NEW.unit_code := COALESCE(NEW.unit_code,v_unit.code);
    NEW.category := v_unit.category;
    NEW.quantity_mode := v_unit.quantity_mode;
    NEW.quantity_scale := v_unit.quantity_scale;
    NEW.allows_fraction := v_unit.allows_fraction;
  ELSIF lower(trim(NEW.unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l','ملليجرام','مجم','جرام','جم','كيلوجرام','كجم','mg','g','kg','سنتيمتر','سم','متر','cm','m') THEN
    NEW.category := CASE
      WHEN lower(trim(NEW.unit_name)) IN ('ملليلتر','مل','ملي','لتر','ml','l') THEN 'volume'
      WHEN lower(trim(NEW.unit_name)) IN ('سنتيمتر','سم','متر','cm','m') THEN 'length'
      ELSE 'mass'
    END;
    NEW.quantity_mode := 'continuous';
    NEW.quantity_scale := CASE WHEN NEW.category = 'length' THEN 2 ELSE 3 END;
    NEW.allows_fraction := true;
  END IF;

  NEW.category := COALESCE(NULLIF(NEW.category,''),'other');
  NEW.quantity_mode := COALESCE(NULLIF(NEW.quantity_mode,''),'discrete');
  IF NEW.quantity_mode = 'discrete' THEN
    NEW.quantity_scale := 0;
    NEW.allows_fraction := false;
    IF NEW.factor <> trunc(NEW.factor) OR COALESCE(NEW.qty_per_main_unit,1) <> trunc(COALESCE(NEW.qty_per_main_unit,1)) THEN
      RAISE EXCEPTION 'discrete_unit_requires_integer_factor';
    END IF;
  ELSE
    NEW.quantity_scale := LEAST(GREATEST(COALESCE(NEW.quantity_scale,3),0),6);
    NEW.allows_fraction := NEW.quantity_scale > 0;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharmacy_units_domain_policy ON public.pharmacy_units;
CREATE TRIGGER trg_pharmacy_units_domain_policy
BEFORE INSERT OR UPDATE ON public.pharmacy_units
FOR EACH ROW EXECUTE FUNCTION public.apply_unit_domain_policy();

DROP TRIGGER IF EXISTS trg_item_units_domain_policy ON public.pharmacy_item_units;
CREATE TRIGGER trg_item_units_domain_policy
BEFORE INSERT OR UPDATE ON public.pharmacy_item_units
FOR EACH ROW EXECUTE FUNCTION public.apply_unit_domain_policy();

-- ============================================================================
-- DELIVERY LIFECYCLE: assignment, timestamps, proof and collection
-- ============================================================================

ALTER TABLE public.pharmacy_orders
  ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES public.pharmacy_employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_agent_name TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_url TEXT,
  ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.pharmacy_orders
  DROP CONSTRAINT IF EXISTS pharmacy_orders_collected_amount_check,
  ADD CONSTRAINT pharmacy_orders_collected_amount_check
    CHECK (collected_amount >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_assignment
  ON public.pharmacy_orders(pharmacy_id, assigned_employee_id, status, created_at DESC);

-- ============================================================================
-- DATABASE STATE MACHINES: protect operational workflows from invalid jumps
-- ============================================================================

-- Normalize legacy aliases before strict workflow guards are installed.
UPDATE public.pharmacy_stock_counts
SET status = CASE
  WHEN status IN ('matched','variance') THEN 'posted'
  WHEN status = 'void' THEN 'cancelled'
  ELSE status
END,
updated_at = now()
WHERE status IN ('matched','variance','void');

UPDATE public.pharmacy_purchase_orders
SET status = CASE
  WHEN status IN ('pending','approved') THEN 'sent'
  WHEN status = 'ordered' THEN 'partial'
  ELSE status
END,
updated_at = now()
WHERE status IN ('pending','approved','ordered');


CREATE OR REPLACE FUNCTION public.enforce_operational_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'pharmacy_purchase_orders' THEN
    v_allowed := CASE OLD.status
      WHEN 'draft' THEN NEW.status IN ('sent','cancelled')
      WHEN 'sent' THEN NEW.status IN ('partial','received','cancelled')
      WHEN 'partial' THEN NEW.status IN ('received','cancelled')
      ELSE false
    END;
  ELSIF TG_TABLE_NAME = 'pharmacy_orders' THEN
    v_allowed := CASE OLD.status
      WHEN 'pending' THEN NEW.status IN ('confirmed','cancelled')
      WHEN 'confirmed' THEN NEW.status IN ('preparing','cancelled')
      WHEN 'preparing' THEN NEW.status IN ('shipped','cancelled')
      WHEN 'shipped' THEN NEW.status IN ('delivered','returned')
      WHEN 'delivered' THEN NEW.status IN ('returned')
      ELSE false
    END;
    IF NEW.status = 'shipped' AND NEW.dispatched_at IS NULL THEN NEW.dispatched_at := now(); END IF;
    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN NEW.delivered_at := now(); END IF;
    IF NEW.status = 'returned' AND NEW.returned_at IS NULL THEN NEW.returned_at := now(); END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  ELSIF TG_TABLE_NAME = 'pharmacy_stock_counts' THEN
    v_allowed := CASE OLD.status
      WHEN 'draft' THEN NEW.status IN ('posted','cancelled')
      WHEN 'posted' THEN NEW.status IN ('approved','cancelled')
      ELSE false
    END;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid_status_transition:%:%:%', TG_TABLE_NAME, OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_order_status_transition ON public.pharmacy_purchase_orders;
CREATE TRIGGER trg_purchase_order_status_transition
BEFORE UPDATE OF status ON public.pharmacy_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

DROP TRIGGER IF EXISTS trg_delivery_status_transition ON public.pharmacy_orders;
CREATE TRIGGER trg_delivery_status_transition
BEFORE UPDATE OF status ON public.pharmacy_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

DROP TRIGGER IF EXISTS trg_stock_count_status_transition ON public.pharmacy_stock_counts;
CREATE TRIGGER trg_stock_count_status_transition
BEFORE UPDATE OF status ON public.pharmacy_stock_counts
FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_status_transition();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ===== 20260621112000_atomic_purchase_order_receiving.sql =====
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
