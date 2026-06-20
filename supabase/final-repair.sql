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

-- ===== 20260621113000_payroll_domain_operations.sql =====
-- Professional payroll domain: durable runs, line calculations, workflow,
-- idempotent generation and atomic accounting payment.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  period TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  run_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  client_request_id TEXT NOT NULL,
  total_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_additions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, run_number),
  UNIQUE(pharmacy_id, client_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_payroll_active_period
  ON public.pharmacy_payroll_runs(pharmacy_id, period)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_runs_period
  ON public.pharmacy_payroll_runs(pharmacy_id, period DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_runs_status
  ON public.pharmacy_payroll_runs(pharmacy_id, status, period DESC);

ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_period_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_period_check
  CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_dates_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_dates_check
  CHECK (period_start <= period_end);
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_status_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_status_check
  CHECK (status IN ('draft','approved','paid','cancelled'));
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_payment_method_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','card','wallet','bank-transfer'));
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_totals_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_totals_check
  CHECK (
    total_base >= 0 AND total_additions >= 0 AND total_deductions >= 0
    AND total_gross >= 0 AND total_net >= 0
    AND total_net <= total_gross
  );

CREATE TABLE IF NOT EXISTS public.pharmacy_payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.pharmacy_payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.pharmacy_employees(id) ON DELETE RESTRICT,
  employee_name TEXT NOT NULL,
  position TEXT,
  salary_type TEXT NOT NULL,
  salary_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  payable_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  paid_leave_days INTEGER NOT NULL DEFAULT 0,
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
  worked_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  regular_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  additions NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  calculation_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_lines_employee
  ON public.pharmacy_payroll_lines(pharmacy_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_lines_run
  ON public.pharmacy_payroll_lines(run_id, employee_name);

ALTER TABLE public.pharmacy_payroll_lines DROP CONSTRAINT IF EXISTS pharmacy_payroll_lines_salary_type_check;
ALTER TABLE public.pharmacy_payroll_lines ADD CONSTRAINT pharmacy_payroll_lines_salary_type_check
  CHECK (salary_type IN ('monthly','weekly','daily','hourly'));
ALTER TABLE public.pharmacy_payroll_lines DROP CONSTRAINT IF EXISTS pharmacy_payroll_lines_values_check;
ALTER TABLE public.pharmacy_payroll_lines ADD CONSTRAINT pharmacy_payroll_lines_values_check
  CHECK (
    salary_rate >= 0 AND scheduled_days >= 0 AND payable_days >= 0
    AND absent_days >= 0 AND paid_leave_days >= 0 AND unpaid_leave_days >= 0
    AND worked_hours >= 0 AND regular_pay >= 0 AND additions >= 0
    AND deductions >= 0 AND gross_salary >= 0 AND net_salary >= 0
    AND deductions <= gross_salary AND net_salary = round(gross_salary - deductions, 2)
  );

DROP TRIGGER IF EXISTS trg_pharmacy_payroll_runs_updated_at ON public.pharmacy_payroll_runs;
CREATE TRIGGER trg_pharmacy_payroll_runs_updated_at
BEFORE UPDATE ON public.pharmacy_payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_payroll_lines_updated_at ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_pharmacy_payroll_lines_updated_at
BEFORE UPDATE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_transition_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('approved','cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid','cancelled'))
  ) THEN
    RAISE EXCEPTION 'الانتقال من حالة كشف الرواتب % إلى % غير مسموح', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payroll_run_transition ON public.pharmacy_payroll_runs;
CREATE TRIGGER trg_enforce_payroll_run_transition
BEFORE UPDATE OF status ON public.pharmacy_payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_run_transition_v1();

CREATE OR REPLACE FUNCTION public.assert_payroll_line_editable_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_status TEXT;
BEGIN
  v_run_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  SELECT status INTO v_status FROM public.pharmacy_payroll_runs WHERE id = v_run_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل بنود كشف الرواتب بعد اعتماده';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_payroll_line_editable ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_assert_payroll_line_editable
BEFORE INSERT OR UPDATE OR DELETE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.assert_payroll_line_editable_v1();

CREATE OR REPLACE FUNCTION public.refresh_payroll_run_totals_v1(p_run_id UUID)
RETURNS public.pharmacy_payroll_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
BEGIN
  UPDATE public.pharmacy_payroll_runs AS runs
  SET total_base = totals.total_base,
      total_additions = totals.total_additions,
      total_deductions = totals.total_deductions,
      total_gross = totals.total_gross,
      total_net = totals.total_net,
      updated_at = now()
  FROM (
    SELECT
      COALESCE(sum(regular_pay),0)::NUMERIC(14,2) AS total_base,
      COALESCE(sum(additions),0)::NUMERIC(14,2) AS total_additions,
      COALESCE(sum(deductions),0)::NUMERIC(14,2) AS total_deductions,
      COALESCE(sum(gross_salary),0)::NUMERIC(14,2) AS total_gross,
      COALESCE(sum(net_salary),0)::NUMERIC(14,2) AS total_net
    FROM public.pharmacy_payroll_lines
    WHERE run_id = p_run_id
  ) totals
  WHERE runs.id = p_run_id
  RETURNING runs.* INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_payroll_totals_after_line_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  v_run_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  PERFORM public.refresh_payroll_run_totals_v1(v_run_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_payroll_totals_after_line ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_refresh_payroll_totals_after_line
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.refresh_payroll_totals_after_line_v1();

CREATE OR REPLACE FUNCTION public.create_payroll_run_v1(
  p_pharmacy_id UUID,
  p_period TEXT,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_notes TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_start DATE;
  v_end DATE;
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_line JSONB;
  v_employee public.pharmacy_employees%ROWTYPE;
  v_count INTEGER := 0;
  v_regular NUMERIC(14,2);
  v_additions NUMERIC(14,2);
  v_deductions NUMERIC(14,2);
  v_gross NUMERIC(14,2);
  v_net NUMERIC(14,2);
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إنشاء كشف الرواتب';
  END IF;
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'فترة الرواتب غير صالحة';
  END IF;
  IF COALESCE(NULLIF(btrim(p_client_request_id),''),'') = '' THEN
    RAISE EXCEPTION 'معرف طلب إنشاء كشف الرواتب مطلوب';
  END IF;
  IF jsonb_typeof(COALESCE(p_lines,'[]'::JSONB)) <> 'array' OR jsonb_array_length(COALESCE(p_lines,'[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'لا توجد بنود لإنشاء كشف الرواتب';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':payroll:' || p_period, 0));

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE pharmacy_id = p_pharmacy_id AND client_request_id = p_client_request_id
  LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',true); END IF;

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE pharmacy_id = p_pharmacy_id AND period = p_period AND status <> 'cancelled'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',true); END IF;

  v_start := to_date(p_period || '-01','YYYY-MM-DD');
  v_end := (v_start + INTERVAL '1 month - 1 day')::DATE;

  INSERT INTO public.pharmacy_payroll_runs(
    pharmacy_id, period, period_start, period_end, run_number, status,
    client_request_id, notes, created_by
  ) VALUES (
    p_pharmacy_id, p_period, v_start, v_end,
    'PAY-' || replace(p_period,'-','') || '-' || upper(substr(md5(p_client_request_id),1,6)),
    'draft', p_client_request_id, NULLIF(btrim(p_notes),''), p_actor_id
  ) RETURNING * INTO v_run;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_employee FROM public.pharmacy_employees
    WHERE id = NULLIF(v_line->>'employee_id','')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط'; END IF;

    v_regular := round(GREATEST(COALESCE((v_line->>'regular_pay')::NUMERIC,0),0),2);
    v_additions := round(GREATEST(COALESCE((v_line->>'additions')::NUMERIC,0),0),2);
    v_gross := round(v_regular + v_additions,2);
    v_deductions := round(LEAST(GREATEST(COALESCE((v_line->>'deductions')::NUMERIC,0),0),v_gross),2);
    v_net := round(GREATEST(v_gross - v_deductions,0),2);

    INSERT INTO public.pharmacy_payroll_lines(
      pharmacy_id, run_id, employee_id, employee_name, position, salary_type, salary_rate,
      scheduled_days, payable_days, absent_days, paid_leave_days, unpaid_leave_days, worked_hours,
      regular_pay, additions, deductions, gross_salary, net_salary, calculation_details
    ) VALUES (
      p_pharmacy_id, v_run.id, v_employee.id,
      COALESCE(NULLIF(v_line->>'employee_name',''),v_employee.name),
      COALESCE(NULLIF(v_line->>'position',''),v_employee.position),
      CASE WHEN v_line->>'salary_type' IN ('monthly','weekly','daily','hourly') THEN v_line->>'salary_type' ELSE COALESCE(v_employee.salary_type,'monthly') END,
      round(GREATEST(COALESCE((v_line->>'salary_rate')::NUMERIC,v_employee.salary,0),0),2),
      GREATEST(COALESCE((v_line->>'scheduled_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'payable_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'absent_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'paid_leave_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'unpaid_leave_days')::INTEGER,0),0),
      round(GREATEST(COALESCE((v_line->>'worked_hours')::NUMERIC,0),0),2),
      v_regular, v_additions, v_deductions, v_gross, v_net,
      COALESCE(v_line->'calculation_details','{}'::JSONB)
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'تعذر إنشاء بنود كشف الرواتب'; END IF;
  SELECT * INTO v_run FROM public.refresh_payroll_run_totals_v1(v_run.id);
  RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payroll_line_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_line_id UUID,
  p_additions NUMERIC,
  p_deductions NUMERIC,
  p_notes TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_line public.pharmacy_payroll_lines%ROWTYPE;
  v_additions NUMERIC(14,2);
  v_gross NUMERIC(14,2);
  v_deductions NUMERIC(14,2);
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تعديل كشف الرواتب';
  END IF;
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'لا يمكن تعديل كشف رواتب بعد اعتماده'; END IF;

  SELECT * INTO v_line FROM public.pharmacy_payroll_lines
  WHERE id = p_line_id AND run_id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'بند الموظف غير موجود في كشف الرواتب'; END IF;

  v_additions := round(GREATEST(COALESCE(p_additions,0),0),2);
  v_gross := round(v_line.regular_pay + v_additions,2);
  v_deductions := round(LEAST(GREATEST(COALESCE(p_deductions,0),0),v_gross),2);

  UPDATE public.pharmacy_payroll_lines
  SET additions = v_additions,
      deductions = v_deductions,
      gross_salary = v_gross,
      net_salary = round(v_gross - v_deductions,2),
      notes = NULLIF(btrim(p_notes),''),
      updated_at = now()
  WHERE id = v_line.id
  RETURNING * INTO v_line;

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs WHERE id = p_run_id;
  RETURN jsonb_build_object('line',to_jsonb(v_line),'run',to_jsonb(v_run));
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_payroll_run_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_status TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد أو إلغاء كشف الرواتب';
  END IF;
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;

  IF p_status = v_run.status THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'unchanged',true); END IF;
  IF p_status = 'approved' THEN
    IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'يمكن اعتماد مسودة كشف الرواتب فقط'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.pharmacy_payroll_lines WHERE run_id = v_run.id) THEN
      RAISE EXCEPTION 'لا يمكن اعتماد كشف رواتب بدون موظفين';
    END IF;
    UPDATE public.pharmacy_payroll_runs
    SET status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now()
    WHERE id=v_run.id RETURNING * INTO v_run;
  ELSIF p_status = 'cancelled' THEN
    IF v_run.status NOT IN ('draft','approved') THEN RAISE EXCEPTION 'لا يمكن إلغاء كشف الرواتب في حالته الحالية'; END IF;
    UPDATE public.pharmacy_payroll_runs
    SET status='cancelled',cancelled_by=p_actor_id,cancelled_at=now(),updated_at=now()
    WHERE id=v_run.id RETURNING * INTO v_run;
  ELSE
    RAISE EXCEPTION 'حالة كشف الرواتب المطلوبة غير صالحة';
  END IF;

  RETURN jsonb_build_object('run',to_jsonb(v_run),'unchanged',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_payroll_run_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_branch_id UUID,
  p_payment_method TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_entry_id UUID;
  v_expense_account UUID;
  v_credit_account UUID;
  v_method TEXT;
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id)
     OR NOT public.user_has_permission(p_pharmacy_id, 'financials:write', p_actor_id) THEN
    RAISE EXCEPTION 'صرف الرواتب يحتاج صلاحيات الموارد البشرية والإدارة المالية';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_branches
    WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير تابع للصيدلية';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,p_branch_id,p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على الفرع المحدد';
  END IF;
  v_method := CASE WHEN p_payment_method IN ('cash','card','wallet','bank-transfer') THEN p_payment_method ELSE 'cash' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::TEXT || ':payroll-payment',0));
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;
  IF v_run.status = 'paid' THEN
    SELECT id INTO v_entry_id FROM public.pharmacy_journal_entries
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs' AND source_id=v_run.id LIMIT 1;
    RETURN jsonb_build_object('run',to_jsonb(v_run),'journal_entry_id',v_entry_id,'duplicate',true);
  END IF;
  IF v_run.status <> 'approved' THEN RAISE EXCEPTION 'يجب اعتماد كشف الرواتب قبل صرفه'; END IF;

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  INSERT INTO public.pharmacy_chart_of_accounts(pharmacy_id,code,name,type,is_active,sort_order)
  VALUES(p_pharmacy_id,'5030','مصروف الرواتب والأجور','expense',true,110)
  ON CONFLICT(pharmacy_id,code) DO UPDATE SET name=EXCLUDED.name,type='expense',is_active=true,updated_at=now();

  SELECT id INTO v_expense_account FROM public.pharmacy_chart_of_accounts
  WHERE pharmacy_id=p_pharmacy_id AND code='5030';
  SELECT id INTO v_credit_account FROM public.pharmacy_chart_of_accounts
  WHERE pharmacy_id=p_pharmacy_id AND code=CASE WHEN v_method IN ('card','wallet','bank-transfer') THEN '1020' ELSE '1010' END;

  SELECT id INTO v_entry_id FROM public.pharmacy_journal_entries
  WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs' AND source_id=v_run.id LIMIT 1;
  IF v_entry_id IS NULL AND v_run.total_net > 0 THEN
    INSERT INTO public.pharmacy_journal_entries(
      pharmacy_id,branch_id,entry_number,entry_date,reference,description,
      source_table,source_id,total_debit,total_credit,created_by
    ) VALUES(
      p_pharmacy_id,p_branch_id,'PAY-'||replace(v_run.id::TEXT,'-',''),CURRENT_DATE,
      v_run.run_number,'صرف رواتب '||v_run.period,
      'pharmacy_payroll_runs',v_run.id,v_run.total_net,v_run.total_net,p_actor_id
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES
      (p_pharmacy_id,v_entry_id,v_expense_account,v_run.total_net,0,'مصروف رواتب '||v_run.period),
      (p_pharmacy_id,v_entry_id,v_credit_account,0,v_run.total_net,'صرف رواتب '||v_run.period);
  END IF;

  IF v_run.total_net > 0 AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs'
      AND source_id=v_run.id AND category='payroll_payment'
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,
      description,movement_date,created_by
    ) VALUES(
      p_pharmacy_id,p_branch_id,'payroll','payroll_payment',v_run.total_net,'out',
      'pharmacy_payroll_runs',v_run.id,'صرف رواتب '||v_run.period,now(),p_actor_id
    );
  END IF;

  UPDATE public.pharmacy_payroll_runs
  SET status='paid',branch_id=COALESCE(p_branch_id,branch_id),payment_method=v_method,
      paid_by=p_actor_id,paid_at=now(),updated_at=now()
  WHERE id=v_run.id RETURNING * INTO v_run;

  RETURN jsonb_build_object('run',to_jsonb(v_run),'journal_entry_id',v_entry_id,'duplicate',false);
END;
$$;

ALTER TABLE public.pharmacy_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_payroll_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_runs_select ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_insert ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_update ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_delete ON public.pharmacy_payroll_runs;
CREATE POLICY payroll_runs_select ON public.pharmacy_payroll_runs
FOR SELECT USING (public.user_has_permission(pharmacy_id,'hr:read'));
CREATE POLICY payroll_runs_insert ON public.pharmacy_payroll_runs
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_runs_update ON public.pharmacy_payroll_runs
FOR UPDATE USING (public.user_has_permission(pharmacy_id,'hr:write'))
WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_runs_delete ON public.pharmacy_payroll_runs
FOR DELETE USING (public.is_developer() OR public.user_pharmacy_role(pharmacy_id) IN ('owner','admin'));

DROP POLICY IF EXISTS payroll_lines_select ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_insert ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_update ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_delete ON public.pharmacy_payroll_lines;
CREATE POLICY payroll_lines_select ON public.pharmacy_payroll_lines
FOR SELECT USING (public.user_has_permission(pharmacy_id,'hr:read'));
CREATE POLICY payroll_lines_insert ON public.pharmacy_payroll_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_lines_update ON public.pharmacy_payroll_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id,'hr:write'))
WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_lines_delete ON public.pharmacy_payroll_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id,'hr:write'));

REVOKE ALL ON FUNCTION public.refresh_payroll_run_totals_v1(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payroll_run_v1(UUID,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payroll_line_v1(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_payroll_run_v1(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_payroll_run_v1(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_payroll_run_v1(UUID,TEXT,UUID,TEXT,TEXT,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_payroll_line_v1(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.transition_payroll_run_v1(UUID,UUID,TEXT,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pay_payroll_run_v1(UUID,UUID,UUID,TEXT,UUID) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ===== 20260621114000_hr_workflow_integrity.sql =====
BEGIN;

ALTER TABLE public.pharmacy_employees
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.pharmacy_employees
SET deactivated_at = COALESCE(updated_at, created_at, now())
WHERE is_active = false AND deactivated_at IS NULL;

INSERT INTO public.pharmacy_settings(pharmacy_id, key, value, description, created_at, updated_at)
SELECT p.id, 'hr.attendanceGraceMinutes', '15', 'فترة السماح الافتراضية لتسجيل الحضور بالدقائق', now(), now()
FROM public.pharmacies p
ON CONFLICT (pharmacy_id, key) DO NOTHING;

-- Normalize legacy values before installing stricter operational rules.
UPDATE public.pharmacy_employees
SET salary = GREATEST(COALESCE(salary, 0), 0),
    salary_type = CASE WHEN salary_type IN ('monthly','weekly','daily','hourly') THEN salary_type ELSE 'monthly' END,
    updated_at = now()
WHERE salary IS NULL OR salary < 0 OR salary_type IS NULL OR salary_type NOT IN ('monthly','weekly','daily','hourly');

UPDATE public.pharmacy_attendance
SET hours_worked = GREATEST(COALESCE(hours_worked, 0), 0),
    updated_at = now()
WHERE hours_worked < 0;

UPDATE public.pharmacy_leave
SET end_date = GREATEST(end_date, start_date),
    days_used = (GREATEST(end_date, start_date) - start_date) + 1,
    updated_at = now()
WHERE end_date < start_date
   OR days_used IS DISTINCT FROM ((end_date - start_date) + 1)
   OR days_used <= 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_employees_salary_nonnegative') THEN
    ALTER TABLE public.pharmacy_employees
      ADD CONSTRAINT pharmacy_employees_salary_nonnegative CHECK (salary >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_attendance_hours_nonnegative') THEN
    ALTER TABLE public.pharmacy_attendance
      ADD CONSTRAINT pharmacy_attendance_hours_nonnegative CHECK (hours_worked IS NULL OR hours_worked >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_leave_valid_period') THEN
    ALTER TABLE public.pharmacy_leave
      ADD CONSTRAINT pharmacy_leave_valid_period CHECK (end_date >= start_date AND days_used = ((end_date - start_date) + 1));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_employee_integrity_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email_changed BOOLEAN;
  v_national_id_changed BOOLEAN;
  v_user_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_email_changed := true;
    v_national_id_changed := true;
    v_user_changed := true;
  ELSE
    v_email_changed := NEW.email IS DISTINCT FROM OLD.email;
    v_national_id_changed := NEW.national_id IS DISTINCT FROM OLD.national_id;
    v_user_changed := NEW.user_id IS DISTINCT FROM OLD.user_id;
  END IF;
  NEW.name := btrim(regexp_replace(COALESCE(NEW.name, ''), '\s+', ' ', 'g'));
  NEW.position := btrim(regexp_replace(COALESCE(NEW.position, ''), '\s+', ' ', 'g'));
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  NEW.national_id := NULLIF(btrim(COALESCE(NEW.national_id, '')), '');
  NEW.salary := GREATEST(COALESCE(NEW.salary, 0), 0);
  NEW.salary_type := CASE WHEN NEW.salary_type IN ('monthly','weekly','daily','hourly') THEN NEW.salary_type ELSE 'monthly' END;
  IF NEW.is_active THEN
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
  ELSIF OLD.is_active THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
  END IF;
  NEW.updated_at := now();

  IF NEW.name = '' THEN RAISE EXCEPTION 'اسم الموظف مطلوب' USING ERRCODE = '23514'; END IF;
  IF NEW.position = '' THEN RAISE EXCEPTION 'الوظيفة مطلوبة' USING ERRCODE = '23514'; END IF;

  IF v_email_changed AND NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND lower(e.email) = NEW.email AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'البريد الإلكتروني مسجل لموظف آخر' USING ERRCODE = '23505';
  END IF;

  IF v_national_id_changed AND NEW.national_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND e.national_id = NEW.national_id AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'الرقم القومي مسجل لموظف آخر' USING ERRCODE = '23505';
  END IF;

  IF v_user_changed AND NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND e.user_id = NEW.user_id AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'حساب المستخدم مرتبط بموظف آخر' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_integrity_v1 ON public.pharmacy_employees;
CREATE TRIGGER trg_employee_integrity_v1
BEFORE INSERT OR UPDATE ON public.pharmacy_employees
FOR EACH ROW EXECUTE FUNCTION public.enforce_employee_integrity_v1();

CREATE OR REPLACE FUNCTION public.prevent_employee_hard_delete_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Cascading deletion of the parent pharmacy remains possible; direct employee deletion does not.
  IF pg_trigger_depth() <= 1 AND EXISTS (SELECT 1 FROM public.pharmacies p WHERE p.id = OLD.pharmacy_id) THEN
    RAISE EXCEPTION 'لا يمكن حذف الموظف نهائياً؛ استخدم التعطيل للحفاظ على السجل التاريخي' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_employee_hard_delete_v1 ON public.pharmacy_employees;
CREATE TRIGGER trg_prevent_employee_hard_delete_v1
BEFORE DELETE ON public.pharmacy_employees
FOR EACH ROW EXECUTE FUNCTION public.prevent_employee_hard_delete_v1();

CREATE OR REPLACE FUNCTION public.enforce_leave_transition_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved','rejected','cancelled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'انتقال حالة الإجازة غير مسموح: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_transition_v1 ON public.pharmacy_leave;
CREATE TRIGGER trg_leave_transition_v1
BEFORE UPDATE OF status ON public.pharmacy_leave
FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_transition_v1();

CREATE INDEX IF NOT EXISTS idx_pharmacy_employees_active_name
  ON public.pharmacy_employees(pharmacy_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_employees_deactivated_at
  ON public.pharmacy_employees(pharmacy_id, deactivated_at)
  WHERE deactivated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_leave_status_start
  ON public.pharmacy_leave(pharmacy_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_attendance_date_employee
  ON public.pharmacy_attendance(pharmacy_id, date_key DESC, employee_id);

NOTIFY pgrst, 'reload schema';
COMMIT;


-- ===== CASHIER REPAIR SOURCE: 20260618005000_cashier_atomic_fefo_security.sql =====
-- Atomic cashier sale v2:
-- - validates the open shift
-- - applies permissions server-side
-- - deducts stock safely under row locks
-- - consumes the nearest valid expiry batches first (FEFO)
-- - updates the cashier shift in the same transaction

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_client_request
  ON public.pharmacy_sales(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_cashier_sale_v2(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_paid_amount NUMERIC,
  p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,
  p_rounding_adj NUMERIC,
  p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,
  p_patient_name TEXT DEFAULT NULL,
  p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_shift public.pharmacy_shifts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_coupon public.pharmacy_coupons%ROWTYPE;
  v_line JSONB;
  v_quantity NUMERIC;
  v_remaining_quantity NUMERIC;
  v_alloc_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_discount NUMERIC;
  v_remaining_discount NUMERIC;
  v_alloc_discount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_line_discounts NUMERIC := 0;
  v_invoice_discount NUMERIC := 0;
  v_coupon_discount NUMERIC := 0;
  v_tax_total NUMERIC := GREATEST(COALESCE(p_tax_total, 0), 0);
  v_shipping_fee NUMERIC := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rounding_adj NUMERIC := COALESCE(p_rounding_adj, 0);
  v_total NUMERIC;
  v_paid NUMERIC;
  v_due NUMERIC;
  v_invoice_number TEXT;
  v_can_discount BOOLEAN;
  v_can_override_price BOOLEAN;
  v_has_batches BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash');
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تنفيذ البيع';
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع';
  END IF;

  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN
    RAISE EXCEPTION 'معرف عملية البيع غير صالح';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE pharmacy_id = p_pharmacy_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
        FROM public.pharmacy_sale_lines sale_line
        WHERE sale_line.sale_id = v_sale.id
      ), '[]'::jsonb),
      'duplicate', true
    );
  END IF;

  SELECT *
    INTO v_shift
  FROM public.pharmacy_shifts
  WHERE id = p_shift_id
    AND pharmacy_id = p_pharmacy_id
    AND branch_id = p_branch_id
    AND user_id = v_actor_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'جلسة الكاشير غير مفتوحة أو انتهت';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل';
  END IF;

  v_can_discount := public.user_has_permission(p_pharmacy_id, 'sales:discount', v_actor_id);
  v_can_override_price := public.user_has_permission(p_pharmacy_id, 'sales:price-override', v_actor_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND status = 'active'
      AND COALESCE(not_for_sale, false) = false
      AND (branch_id IS NULL OR branch_id = p_branch_id)
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير صالح للبيع';
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية البيع غير صحيحة للصنف %', v_item.name_ar;
    END IF;

    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_line_discounts := v_line_discounts + v_line_discount;
  END LOOP;

  IF v_can_discount THEN
    v_invoice_discount := GREATEST(COALESCE(p_invoice_discount, 0), 0);
  END IF;
  v_invoice_discount := LEAST(v_invoice_discount, GREATEST(v_subtotal - v_line_discounts, 0));

  -- Coupon validation
  IF p_coupon_code IS NOT NULL AND length(BTRIM(p_coupon_code)) > 0 THEN
    SELECT * INTO v_coupon
    FROM public.pharmacy_coupons
    WHERE pharmacy_id = p_pharmacy_id
      AND code = UPPER(BTRIM(p_coupon_code))
      AND is_active = true
      AND (max_uses = 0 OR used_count < max_uses)
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      IF v_subtotal - v_line_discounts < v_coupon.min_purchase THEN
        RAISE EXCEPTION 'الطلب لا يستوفي الحد الأدنى للشراء للكوبون (%)', v_coupon.code;
      END IF;

      v_coupon_discount := CASE
        WHEN v_coupon.discount_type = 'percentage'
          THEN round((v_subtotal - v_line_discounts) * v_coupon.discount_value / 100, 2)
        ELSE v_coupon.discount_value
      END;
      v_coupon_discount := LEAST(v_coupon_discount, GREATEST(v_subtotal - v_line_discounts - v_invoice_discount, 0));
    ELSE
      RAISE EXCEPTION 'الكوبون غير صالح أو منتهي الصلاحية';
    END IF;
  END IF;

  v_total := GREATEST(v_subtotal - v_line_discounts - v_invoice_discount - v_coupon_discount + v_tax_total + v_shipping_fee + v_rounding_adj, 0);
  v_paid := LEAST(v_total, GREATEST(COALESCE(p_paid_amount, v_total), 0));
  v_due := GREATEST(v_total - v_paid, 0);
  v_invoice_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS')
    || '-' || upper(substr(replace(p_client_request_id, '-', ''), 1, 6));

  INSERT INTO public.pharmacy_sales (
    pharmacy_id, branch_id, shift_id, invoice_number, client_request_id,
    customer_name, patient_name, doctor_name, prescription_number,
    status, payment_status, payment_method,
    subtotal, discount_total, tax_total, total, paid_amount, due_amount,
    shipping_fee, rounding_adj, notes, coupon_id, coupon_discount, coupon_code, created_by
  )
  VALUES (
    p_pharmacy_id, p_branch_id, p_shift_id, v_invoice_number, p_client_request_id,
    COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'),
    NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''), NULLIF(BTRIM(p_prescription_number), ''),
    'invoice',
    CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    v_method,
    round(v_subtotal, 2),
    round(v_line_discounts + v_invoice_discount + v_coupon_discount, 2),
    round(v_tax_total, 2),
    round(v_total, 2),
    round(v_paid, 2),
    round(v_due, 2),
    round(v_shipping_fee, 2),
    round(v_rounding_adj, 2),
    NULLIF(BTRIM(p_notes), ''),
    CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.id ELSE NULL END,
    round(v_coupon_discount, 2),
    CASE WHEN v_coupon.id IS NOT NULL THEN UPPER(BTRIM(p_coupon_code)) ELSE NULL END,
    v_actor_id
  )
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = (v_line->>'item_id')::UUID
      AND pharmacy_id = p_pharmacy_id;

    v_quantity := (v_line->>'quantity')::NUMERIC;
    v_unit_price := CASE
      WHEN v_can_override_price
        THEN GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_item.sell_price), 0)
      ELSE v_item.sell_price
    END;
    v_line_discount := CASE
      WHEN v_can_discount
        THEN GREATEST(COALESCE((v_line->>'discount')::NUMERIC, 0), 0)
      ELSE 0
    END;
    v_line_discount := LEAST(v_line_discount, v_quantity * v_unit_price);

    IF v_item.manage_inventory THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_quantity,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND branch_id = p_branch_id
        AND item_id = v_item.id
        AND quantity >= v_quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'الكمية غير كافية للصنف: %', v_item.name_ar;
      END IF;
    END IF;

    v_remaining_quantity := v_quantity;
    v_remaining_discount := v_line_discount;
    SELECT EXISTS (
      SELECT 1
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
    ) INTO v_has_batches;

    FOR v_batch IN
      SELECT batch_row.*
      FROM public.pharmacy_item_batches batch_row
      WHERE batch_row.pharmacy_id = p_pharmacy_id
        AND (batch_row.branch_id = p_branch_id OR batch_row.branch_id IS NULL)
        AND batch_row.item_id = v_item.id
        AND batch_row.remaining_quantity > 0
        AND (batch_row.expiry_date IS NULL OR batch_row.expiry_date >= CURRENT_DATE)
      ORDER BY batch_row.expiry_date ASC NULLS LAST, batch_row.created_at ASC, batch_row.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_quantity <= 0;
      v_alloc_quantity := LEAST(v_remaining_quantity, v_batch.remaining_quantity);
      v_alloc_discount := CASE
        WHEN v_alloc_quantity = v_remaining_quantity THEN v_remaining_discount
        ELSE LEAST(v_remaining_discount, round(v_line_discount * (v_alloc_quantity / v_quantity), 2))
      END;
      v_line_total := GREATEST(v_alloc_quantity * v_unit_price - v_alloc_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, batch_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_batch.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_alloc_quantity, v_unit_price, v_item.buy_price, v_alloc_discount, round(v_line_total, 2)
      );

      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_alloc_quantity,
          updated_at = now()
      WHERE id = v_batch.id;

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, v_batch.id, 'out', v_alloc_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );

      v_remaining_quantity := v_remaining_quantity - v_alloc_quantity;
      v_remaining_discount := GREATEST(v_remaining_discount - v_alloc_discount, 0);
    END LOOP;

    IF v_remaining_quantity > 0 AND v_has_batches AND (v_item.track_batch OR v_item.has_expiry) THEN
      RAISE EXCEPTION 'لا توجد تشغيلة صالحة بكمية كافية للصنف: %', v_item.name_ar;
    END IF;

    IF v_remaining_quantity > 0 THEN
      v_line_total := GREATEST(v_remaining_quantity * v_unit_price - v_remaining_discount, 0);

      INSERT INTO public.pharmacy_sale_lines (
        pharmacy_id, sale_id, item_id, item_name, barcode, unit,
        quantity, unit_price, purchase_price, discount, net_total
      )
      VALUES (
        p_pharmacy_id, v_sale.id, v_item.id, v_item.name_ar,
        NULLIF(BTRIM(v_line->>'barcode'), ''),
        COALESCE(NULLIF(BTRIM(v_line->>'unit'), ''), v_item.unit, 'unit'),
        v_remaining_quantity, v_unit_price, v_item.buy_price, v_remaining_discount, round(v_line_total, 2)
      );

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, p_branch_id, v_item.id, 'out', v_remaining_quantity,
        v_unit_price, round(v_line_total, 2), 'sale', 'pharmacy_sales', v_sale.id, v_actor_id
      );
    END IF;

    -- Auto-log controlled drug dispense
    IF v_item.is_controlled THEN
      INSERT INTO public.pharmacy_controlled_drugs_log (
        pharmacy_id, item_id, branch_id, action, quantity,
        patient_name, doctor_name, prescription_number, notes,
        created_by, created_at
      ) VALUES (
        p_pharmacy_id, v_item.id, p_branch_id, 'dispensed',
        (v_line->>'quantity')::NUMERIC,
        NULLIF(BTRIM(p_patient_name), ''), NULLIF(BTRIM(p_doctor_name), ''),
        NULLIF(BTRIM(p_prescription_number), ''),
        'صرف: ' || v_sale.invoice_number,
        v_actor_id, now()
      );
    END IF;
  END LOOP;

  -- Auto-create/link prescription
  IF NULLIF(BTRIM(p_prescription_number), '') IS NOT NULL OR NULLIF(BTRIM(p_patient_name), '') IS NOT NULL THEN
    DECLARE
      v_prescription_id UUID;
    BEGIN
      SELECT id INTO v_prescription_id
      FROM public.pharmacy_prescriptions
      WHERE pharmacy_id = p_pharmacy_id
        AND patient_name = COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي'))
        AND status = 'open'
        AND sale_id IS NULL
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.pharmacy_prescriptions (
          pharmacy_id, branch_id, sale_id,
          patient_name, doctor_name, diagnosis,
          status, notes, created_by,
          dispensed_by, dispensed_at
        ) VALUES (
          p_pharmacy_id, p_branch_id, v_sale.id,
          COALESCE(NULLIF(BTRIM(p_patient_name), ''), COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي')),
          NULLIF(BTRIM(p_doctor_name), ''),
          NULLIF(BTRIM(p_prescription_number), ''),
          'dispensed', v_sale.invoice_number,
          v_actor_id, v_actor_id, now()
        );
      ELSE
        UPDATE public.pharmacy_prescriptions
        SET status = 'dispensed',
            sale_id = v_sale.id,
            doctor_name = COALESCE(NULLIF(BTRIM(p_doctor_name), ''), doctor_name),
            dispensed_by = v_actor_id,
            dispensed_at = now(),
            updated_at = now()
        WHERE id = v_prescription_id;
      END IF;
    END;
  END IF;

  v_cash_paid := CASE WHEN v_method = 'cash' THEN v_paid ELSE 0 END;
  v_card_paid := CASE WHEN v_method IN ('card', 'wallet', 'mixed') THEN v_paid ELSE 0 END;

  UPDATE public.pharmacy_shifts
  SET cash_sales = COALESCE(cash_sales, 0) + v_cash_paid,
      card_sales = COALESCE(card_sales, 0) + v_card_paid,
      credit_sales = COALESCE(credit_sales, 0) + v_due,
      total_collected = COALESCE(total_collected, 0) + v_paid,
      expected_balance = COALESCE(opening_balance, 0) + COALESCE(cash_sales, 0) + v_cash_paid - COALESCE(total_expenses, 0),
      updated_at = now()
  WHERE id = p_shift_id;

  IF v_coupon.id IS NOT NULL THEN
    UPDATE public.pharmacy_coupons
    SET used_count = used_count + 1,
        updated_at = now()
    WHERE id = v_coupon.id;
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(sale_line) ORDER BY sale_line.created_at, sale_line.id)
      FROM public.pharmacy_sale_lines sale_line
      WHERE sale_line.sale_id = v_sale.id
    ), '[]'::jsonb),
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_cashier_sale_v2(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_cashier_sale(
  p_pharmacy_id UUID,
  p_sale_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_sale public.pharmacy_sales%ROWTYPE;
  v_line public.pharmacy_sale_lines%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_cash_paid NUMERIC := 0;
  v_card_paid NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'sales:void', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إلغاء المبيعات';
  END IF;

  SELECT *
    INTO v_sale
  FROM public.pharmacy_sales
  WHERE id = p_sale_id
    AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة البيع غير موجودة';
  END IF;

  IF v_sale.voided_at IS NOT NULL OR v_sale.status IN ('void', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'sale', to_jsonb(v_sale));
  END IF;

  IF NOT public.has_branch_access(p_pharmacy_id, v_sale.branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الفاتورة';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.pharmacy_sale_lines
    WHERE sale_id = p_sale_id
      AND pharmacy_id = p_pharmacy_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT *
      INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_line.item_id
      AND pharmacy_id = p_pharmacy_id;

    IF FOUND AND v_item.manage_inventory THEN
      INSERT INTO public.pharmacy_stock_balances (
        pharmacy_id, branch_id, item_id, quantity, updated_at
      )
      VALUES (
        p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.quantity, now()
      )
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET
        quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
        updated_at = now();
    END IF;

    IF v_line.batch_id IS NOT NULL THEN
      UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity + v_line.quantity,
          updated_at = now()
      WHERE id = v_line.batch_id
        AND pharmacy_id = p_pharmacy_id;
    END IF;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_sale.branch_id, v_line.item_id, v_line.batch_id,
      'in', v_line.quantity, v_line.unit_price, v_line.net_total,
      'sale_void', 'pharmacy_sales', v_sale.id, v_actor_id
    );
  END LOOP;

  UPDATE public.pharmacy_sales
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor_id,
      void_reason = COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء فاتورة بيع'),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  v_cash_paid := CASE WHEN v_sale.payment_method = 'cash' THEN v_sale.paid_amount ELSE 0 END;
  v_card_paid := CASE WHEN v_sale.payment_method IN ('card', 'wallet', 'mixed') THEN v_sale.paid_amount ELSE 0 END;

  IF v_sale.shift_id IS NOT NULL THEN
    UPDATE public.pharmacy_shifts
    SET cash_sales = GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0),
        card_sales = GREATEST(COALESCE(card_sales, 0) - v_card_paid, 0),
        credit_sales = GREATEST(COALESCE(credit_sales, 0) - COALESCE(v_sale.due_amount, 0), 0),
        total_collected = GREATEST(COALESCE(total_collected, 0) - COALESCE(v_sale.paid_amount, 0), 0),
        expected_balance = COALESCE(opening_balance, 0)
          + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
          - COALESCE(total_expenses, 0),
        difference = CASE
          WHEN status = 'closed' AND closing_balance IS NOT NULL THEN
            closing_balance - (
              COALESCE(opening_balance, 0)
              + GREATEST(COALESCE(cash_sales, 0) - v_cash_paid, 0)
              - COALESCE(total_expenses, 0)
            )
          ELSE difference
        END,
        updated_at = now()
    WHERE id = v_sale.shift_id
      AND pharmacy_id = p_pharmacy_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'sale', to_jsonb(v_sale));
END;
$$;

REVOKE ALL ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_cashier_sale(UUID, UUID, UUID, TEXT) TO authenticated, service_role;


-- ===== CASHIER REPAIR SOURCE: 20260621001000_full_operational_closure.sql =====
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


-- ===== CASHIER REPAIR SOURCE: 20260621008000_atomic_shifts_and_expenses.sql =====
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


-- ===== CASHIER REPAIR SOURCE: 20260621009000_atomic_complete_business_documents.sql =====
BEGIN;

CREATE OR REPLACE FUNCTION public.create_cashier_sale_complete_v1(
  p_pharmacy_id UUID,p_branch_id UUID,p_shift_id UUID,p_actor_id UUID,p_client_request_id TEXT,
  p_customer_name TEXT,p_payment_method TEXT,p_paid_amount NUMERIC,p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,p_shipping_fee NUMERIC,p_rounding_adj NUMERIC,p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,p_patient_name TEXT DEFAULT NULL,p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,p_lines JSONB DEFAULT NULL,p_patient_id UUID DEFAULT NULL,p_partner_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_ledger JSONB;
  v_sale_id UUID;
  v_due NUMERIC:=0;
  v_invoice TEXT;
BEGIN
  v_result:=public.create_cashier_sale_v2(
    p_pharmacy_id,p_branch_id,p_shift_id,p_actor_id,p_client_request_id,p_customer_name,p_payment_method,
    p_paid_amount,p_invoice_discount,p_tax_total,p_shipping_fee,p_rounding_adj,p_notes,p_coupon_code,
    p_patient_name,p_doctor_name,p_prescription_number,p_lines
  );
  v_sale_id:=NULLIF(v_result->'sale'->>'id','')::UUID;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء فاتورة البيع'; END IF;
  v_finalization:=public.finalize_sale_operations_v1(p_pharmacy_id,v_sale_id,p_patient_id,p_partner_id,p_actor_id);
  v_due:=GREATEST(COALESCE((v_result->'sale'->>'due_amount')::NUMERIC,0),0);
  v_invoice:=COALESCE(v_result->'sale'->>'invoice_number','');
  IF p_partner_id IS NOT NULL AND v_due>0 THEN
    v_ledger:=public.record_partner_balance_entry_v1(
      p_pharmacy_id,p_branch_id,p_partner_id,'pharmacy_sales',v_sale_id,'charge',v_due,
      'مديونية فاتورة البيع '||v_invoice,p_actor_id,true
    );
    v_finalization:=COALESCE(v_finalization,'{}'::JSONB)||jsonb_build_object('partner_ledger',v_ledger);
  END IF;
  RETURN v_result||jsonb_build_object('finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_received_purchase_complete_v1(
  p_pharmacy_id UUID,p_branch_id UUID,p_actor_id UUID,p_client_request_id TEXT,p_supplier_id UUID,
  p_supplier_name TEXT,p_payment_method TEXT,p_paid_amount NUMERIC,p_header_discount NUMERIC,p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,p_notes TEXT,p_purchase_date TIMESTAMPTZ,p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_ledger JSONB;
  v_purchase_id UUID;
  v_journal UUID;
  v_due NUMERIC:=0;
  v_number TEXT;
BEGIN
  v_result:=public.create_received_purchase(
    p_pharmacy_id,p_branch_id,p_actor_id,p_client_request_id,p_supplier_id,p_supplier_name,p_payment_method,
    p_paid_amount,p_header_discount,p_tax_total,p_shipping_fee,p_notes,p_purchase_date,p_lines
  );
  v_purchase_id:=NULLIF(v_result->'purchase'->>'id','')::UUID;
  IF v_purchase_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء فاتورة الشراء'; END IF;
  v_journal:=public.post_purchase_accounting_v1(p_pharmacy_id,v_purchase_id,p_actor_id);
  v_due:=GREATEST(COALESCE((v_result->'purchase'->>'due_amount')::NUMERIC,0),0);
  v_number:=COALESCE(v_result->'purchase'->>'purchase_number','');
  IF p_supplier_id IS NOT NULL AND v_due>0 THEN
    -- The purchase RPC already updates the supplier balance, therefore this
    -- records the immutable ledger row without applying the balance twice.
    v_ledger:=public.record_partner_balance_entry_v1(
      p_pharmacy_id,p_branch_id,p_supplier_id,'pharmacy_purchases',v_purchase_id,'charge',v_due,
      'مديونية فاتورة الشراء '||v_number,p_actor_id,false
    );
  END IF;
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'partner_ledger',v_ledger);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sales_return_complete_v1(
  p_pharmacy_id UUID,p_sale_id UUID,p_actor_id UUID,p_client_request_id TEXT,p_reason TEXT,p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_return_id UUID;
  v_journal UUID;
BEGIN
  v_result:=public.create_sales_return(p_pharmacy_id,p_sale_id,p_actor_id,p_client_request_id,p_reason,p_lines);
  v_return_id:=NULLIF(v_result->'return'->>'id','')::UUID;
  IF v_return_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء مرتجع المبيعات'; END IF;
  v_journal:=public.post_sales_return_accounting_v1(p_pharmacy_id,v_return_id,p_actor_id);
  v_finalization:=public.finalize_sales_return_partner_v1(p_pharmacy_id,v_return_id,p_actor_id);
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'operational_finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_return_complete_v1(
  p_pharmacy_id UUID,p_purchase_id UUID,p_actor_id UUID,p_client_request_id TEXT,
  p_stock_mode TEXT DEFAULT 'restock',p_reason TEXT DEFAULT NULL,p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_return_id UUID;
  v_journal UUID;
BEGIN
  v_result:=public.create_purchase_return(p_pharmacy_id,p_purchase_id,p_actor_id,p_client_request_id,p_stock_mode,p_reason,p_lines);
  v_return_id:=NULLIF(v_result->'return'->>'id','')::UUID;
  IF v_return_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء مرتجع المشتريات'; END IF;
  v_finalization:=public.finalize_purchase_return_partner_v1(p_pharmacy_id,v_return_id,p_actor_id);
  v_journal:=public.post_purchase_return_accounting_v1(p_pharmacy_id,v_return_id,p_actor_id);
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'operational_finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_complete_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_received_purchase_complete_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_sales_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_purchase_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cashier_sale_complete_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_received_purchase_complete_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB) TO authenticated,service_role;

COMMIT;


-- ===== CASHIER REPAIR SOURCE: 20260621115000_cashier_experience_operational_repair.sql =====
BEGIN;

-- Cashier UX and operational compatibility repair.
-- Additive and safe for an existing tenant database.
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.pharmacy_shifts(id) ON DELETE SET NULL;
ALTER TABLE public.pharmacy_shifts
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE public.pharmacy_expenses
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.pharmacy_shifts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request
  ON public.pharmacy_sales(pharmacy_id,client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_shift_date
  ON public.pharmacy_sales(pharmacy_id,branch_id,shift_id,sale_date DESC)
  WHERE shift_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_shift_live
  ON public.pharmacy_expenses(pharmacy_id,branch_id,shift_id,expense_date DESC)
  WHERE shift_id IS NOT NULL AND voided_at IS NULL;

-- Pharmacists may apply a controlled sale discount. Explicit profile denies
-- still take precedence inside user_has_permission.
CREATE OR REPLACE FUNCTION public.user_has_permission(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL OR p_permission = '' THEN
    RETURN false;
  END IF;

  -- المطور يرى ويدير كل شيء من جدول developer_users فقط.
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

  -- صلاحيات النظام ليست قابلة للإسناد لأصحاب الصيدليات أو الموظفين.
  IF public.permission_is_system_only(p_permission) THEN
    RETURN false;
  END IF;

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
  END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','pharmacy:delete',
      'branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:project.write','settings:branches.read','settings:branches.write','settings:tax.read','settings:tax.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:payments.write','settings:contacts.read','settings:contacts.write','settings:invoice.read','settings:invoice.write','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:notification-templates.write','settings:email.read','settings:email.write','settings:sms.read','settings:sms.write','settings:backup.read','settings:shortcuts.read','settings:shortcuts.write','settings:rewards.read','settings:rewards.write','settings:extra-units.read','settings:extra-units.write','settings:custom-labels.read','settings:custom-labels.write',
      'notifications:read','notifications:manage','notifications:templates.write',
      'prescriptions:read','delivery:read','loyalty:read','sync:read','deleted-records:read','deleted-records:restore'
    );
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read',
      'notifications:read','notifications:manage','sync:read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','purchases:read','inventory:read',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read',
      'financials:read','financials:write','reports:read','reports:export','crm:read',
      'settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read'
    );
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','sales:discount','purchases:read',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print',
      'items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read',
      'prescriptions:read','prescriptions:write'
    );
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read'
    );
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read'
    );
  END IF;

  RETURN false;
END;
$$;

-- Stable versioned entry point used by the cashier service. The v1 document
-- RPC remains the single transactional implementation to avoid duplicated
-- accounting/inventory logic.
CREATE OR REPLACE FUNCTION public.create_cashier_sale_complete_v2(
  p_pharmacy_id UUID,p_branch_id UUID,p_shift_id UUID,p_actor_id UUID,p_client_request_id TEXT,
  p_customer_name TEXT,p_payment_method TEXT,p_paid_amount NUMERIC,p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,p_shipping_fee NUMERIC,p_rounding_adj NUMERIC,p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,p_patient_name TEXT DEFAULT NULL,p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,p_lines JSONB DEFAULT NULL,p_patient_id UUID DEFAULT NULL,p_partner_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
BEGIN
  RETURN public.create_cashier_sale_complete_v1(
    p_pharmacy_id,p_branch_id,p_shift_id,p_actor_id,p_client_request_id,
    p_customer_name,p_payment_method,p_paid_amount,p_invoice_discount,
    p_tax_total,p_shipping_fee,p_rounding_adj,p_notes,p_coupon_code,
    p_patient_name,p_doctor_name,p_prescription_number,p_lines,p_patient_id,p_partner_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_complete_v2(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cashier_sale_complete_v2(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
