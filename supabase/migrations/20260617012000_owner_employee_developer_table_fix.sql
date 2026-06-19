-- ===================================================================
-- OWNER / EMPLOYEE / DEVELOPER SEPARATION FIX
-- يثبت أن المطور ليس مستخدم صيدلية، وصاحب الصيدلية ينشأ له كيان صيدلية وفرع رئيسي تلقائيًا
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) المطورين في جدول developer_users فقط، وليس كعضوية داخل pharmacy_profiles.
DELETE FROM public.pharmacy_profiles pp
USING public.developer_users du
WHERE pp.user_id = du.user_id
  AND pp.role = 'developer';

UPDATE public.pharmacy_profiles
SET role = 'no-access', updated_at = now()
WHERE role = 'developer';

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

-- 2) تأكيد وجود فرع رئيسي لكل صيدلية قديمة.
INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, is_default, status)
SELECT p.id, 'MAIN', 'الفرع الرئيسي', true, 'active'
FROM public.pharmacies p
WHERE NOT EXISTS (
  SELECT 1 FROM public.pharmacy_branches b WHERE b.pharmacy_id = p.id
)
ON CONFLICT (pharmacy_id, code) DO NOTHING;

-- 3) تأكيد وجود عضوية owner لصاحب كل صيدلية.
INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, role, is_active, permissions, denied_permissions)
SELECT
  p.id,
  COALESCE(b_default.id, b_any.id),
  p.owner_id,
  up.email,
  up.full_name,
  'owner',
  true,
  '[]'::jsonb,
  '[]'::jsonb
FROM public.pharmacies p
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT id FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id AND b.is_default = true
  ORDER BY b.created_at ASC LIMIT 1
) b_default ON true
LEFT JOIN LATERAL (
  SELECT id FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id
  ORDER BY b.created_at ASC LIMIT 1
) b_any ON true
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = 'owner',
  is_active = true,
  branch_id = COALESCE(EXCLUDED.branch_id, public.pharmacy_profiles.branch_id),
  email = COALESCE(public.pharmacy_profiles.email, EXCLUDED.email),
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  updated_at = now();

-- 4) فصل صلاحيات النظام العامة عن صلاحيات الصيدلية.
CREATE OR REPLACE FUNCTION public.permission_is_system_only(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_permission = 'system:all'
    OR p_permission LIKE 'developer:%'
    OR p_permission IN ('roles:manage','auth:sessions.manage','settings:system.read','settings:system.write','notifications:system.read'),
    false
  );
$$;

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
  IF public.is_developer(p_user_id) THEN
    RETURN true;
  END IF;

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
      'pharmacy:read','pharmacy:write','branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','notifications:templates.write','sync:read','deleted-records:read','deleted-records:restore'
    ) OR (p_permission LIKE 'settings:%' AND NOT public.permission_is_system_only(p_permission) AND p_permission <> 'settings:backup.write');
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','sync:read',
      'settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','purchases:read','inventory:read','items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','financials:read','financials:write','reports:read','reports:export','crm:read','settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read');
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','purchases:read','inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print','items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role = 'cashier' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read');
  END IF;

  IF v_role IN ('technician','worker','viewer') THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','inventory:read','sales:read','reports:read','settings:read','notifications:read');
  END IF;

  RETURN false;
END;
$$;

-- 5) صاحب الصيدلية يستطيع إدارة مستخدمي وفروع صيدليته، والمطور يستطيع كل شيء دون عضوية صيدلية.
CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

-- 6) Trigger آمن: أي owner جديد يتعمل له صيدلية + فرع رئيسي + عضوية owner تلقائيًا.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'no-access');
  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    v_role := 'developer';
  END IF;

  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'display_name', ''));
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.raw_user_meta_data->>'mobile', ''));
  v_project_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'project_name', ''), NULLIF(NEW.raw_user_meta_data->>'pharmacy_name', ''), v_full_name, NEW.email, 'صيدلية جديدة');
  v_currency := COALESCE(NULLIF(NEW.raw_user_meta_data->>'currency', ''), 'EGP');
  v_country := COALESCE(NULLIF(NEW.raw_user_meta_data->>'country', ''), 'EG');
  v_timezone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'timezone', ''), 'Africa/Cairo');
  v_city := NULLIF(NEW.raw_user_meta_data->>'city', '');

  INSERT INTO public.user_profiles (user_id, email, username, full_name, phone, avatar_url, global_role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    v_full_name,
    v_phone,
    NEW.raw_user_meta_data->>'avatar_url',
    v_role,
    true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(EXCLUDED.username, public.user_profiles.username),
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.user_profiles.phone),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    global_role = EXCLUDED.global_role,
    updated_at = now();

  IF v_role = 'developer' THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();

    RETURN NEW;
  END IF;

  IF v_role = 'owner' THEN
    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (NEW.id, v_project_name, v_project_name, v_currency, v_country, v_timezone, v_phone, NEW.email, v_city, 'active', 'trial')
    ON CONFLICT (owner_id) DO UPDATE SET
      updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', v_city, v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET
      is_default = true,
      status = 'active',
      updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, role, is_active, permissions, denied_permissions)
    VALUES (v_pharmacy_id, v_branch_id, NEW.id, NEW.email, v_full_name, v_phone, 'owner', true, '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
      branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
      email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
      full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
      phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
      role = 'owner',
      is_active = true,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 7) سياسات نهائية لعضويات الصيدلية: owner يتضاف فقط من سيرفر/تريجر، والمستخدمون لا يضيفون owner أو developer.
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_profiles_read_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update_final ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete_final ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_read_final ON public.pharmacy_profiles
FOR SELECT USING (
  public.is_developer()
  OR user_id = auth.uid()
  OR public.user_has_permission(pharmacy_id, 'users:read')
);

CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('developer', 'owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('developer', 'owner')
  )
);
