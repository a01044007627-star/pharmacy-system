-- ===================================================================
-- PHARMACY SYSTEM - FINAL TABLES / AUTH / OWNER / DEVELOPER CLEAN FIX
-- يرفع بعد المايجريشن القديمة مباشرة لإصلاح الجداول والصلاحيات نهائياً
-- الهدف:
-- 1) المطور في developer_users فقط وليس مستخدم صيدلية.
-- 2) صاحب الصيدلية يتعمل له صيدلية + فرع رئيسي + عضوية owner تلقائياً.
-- 3) صاحب الصيدلية يدير فروعه وموظفيه وصلاحياتهم فقط.
-- 4) جدول كل الصلاحيات/صلاحيات النظام للمطور فقط.
-- 5) إصلاح تعارض جدول deleted notifications القديم مع in-app notifications.
-- ===================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===================================================================
-- 1) CORE AUTH TABLES SAFETY
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  global_role TEXT NOT NULL DEFAULT 'no-access',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_global_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_global_role_check
  CHECK (global_role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE TABLE IF NOT EXISTS public.developer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role TEXT NOT NULL DEFAULT 'developer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.developer_users DROP CONSTRAINT IF EXISTS developer_users_role_check;
ALTER TABLE public.developer_users
  ADD CONSTRAINT developer_users_role_check
  CHECK (role IN ('super_admin','developer','maintainer'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_developer_users_user_id ON public.developer_users(user_id);

-- seed main developer account by email when it exists in auth.users
INSERT INTO public.developer_users (user_id, role, is_active, permissions)
SELECT u.id, 'super_admin', true, ARRAY['system:all']::TEXT[]
FROM auth.users u
WHERE lower(u.email) = lower('mostafa0falcon@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  permissions = ARRAY['system:all']::TEXT[],
  updated_at = now();

-- ===================================================================
-- 2) PHARMACY MEMBERSHIP TABLE NORMALIZATION
-- ===================================================================

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS denied_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'linked',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

UPDATE public.pharmacy_profiles
SET
  permissions = COALESCE(permissions, '[]'::jsonb),
  denied_permissions = COALESCE(denied_permissions, '[]'::jsonb),
  invite_status = CASE
    WHEN invite_status IN ('created','invited','linked','pending','accepted','disabled') THEN invite_status
    ELSE 'linked'
  END,
  updated_at = now()
WHERE permissions IS NULL
   OR denied_permissions IS NULL
   OR invite_status IS NULL
   OR invite_status = ''
   OR invite_status NOT IN ('created','invited','linked','pending','accepted','disabled');

ALTER TABLE public.pharmacy_profiles
  ALTER COLUMN permissions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN permissions SET NOT NULL,
  ALTER COLUMN denied_permissions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN denied_permissions SET NOT NULL,
  ALTER COLUMN invite_status SET DEFAULT 'linked',
  ALTER COLUMN invite_status SET NOT NULL;

-- المطور لا يدخل pharmacy_profiles نهائياً.
DELETE FROM public.pharmacy_profiles pp
USING public.developer_users du
WHERE pp.user_id = du.user_id;

-- أي role قديم باسم developer يتقفل بدل ما يكسر constraint.
UPDATE public.pharmacy_profiles
SET role = 'no-access', updated_at = now()
WHERE role = 'developer';

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK (role IN ('owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_invite_status_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_invite_status_check
  CHECK (invite_status IN ('created','invited','linked','pending','accepted','disabled'));

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_profiles_pharmacy_id_user_id_key
  ON public.pharmacy_profiles(pharmacy_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_role ON public.pharmacy_profiles(pharmacy_id, role, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_branch ON public.pharmacy_profiles(pharmacy_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_permissions ON public.pharmacy_profiles USING GIN (permissions);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_denied_permissions ON public.pharmacy_profiles USING GIN (denied_permissions);

-- ===================================================================
-- 3) AUTH / TENANCY HELPER FUNCTIONS
-- ===================================================================

CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      EXISTS(
        SELECT 1
        FROM public.developer_users du
        WHERE du.user_id = p_user_id
          AND du.is_active = true
      )
      OR EXISTS(
        SELECT 1
        FROM auth.users u
        WHERE u.id = p_user_id
          AND lower(u.email) = lower('mostafa0falcon@gmail.com')
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pharmacy_owner(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacies p
      WHERE p.id = p_pharmacy_id
        AND p.owner_id = p_user_id
        AND p.status <> 'closed'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_pharmacy_role(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_developer(p_user_id) THEN
    RETURN 'developer';
  END IF;

  IF public.is_pharmacy_owner(p_pharmacy_id, p_user_id) THEN
    RETURN 'owner';
  END IF;

  SELECT pp.role
    INTO v_role
  FROM public.pharmacy_profiles pp
  WHERE pp.pharmacy_id = p_pharmacy_id
    AND pp.user_id = p_user_id
    AND pp.is_active = true
  ORDER BY pp.created_at ASC
  LIMIT 1;

  RETURN COALESCE(v_role, 'no-access');
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pharmacy_access(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_pharmacy_id UUID, p_branch_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND (
      p_branch_id IS NULL
      OR public.is_developer(p_user_id)
      OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
      OR EXISTS(
        SELECT 1
        FROM public.pharmacy_profiles pp
        WHERE pp.pharmacy_id = p_pharmacy_id
          AND pp.user_id = p_user_id
          AND pp.is_active = true
          AND pp.role <> 'no-access'
          AND (pp.branch_id IS NULL OR pp.branch_id = p_branch_id)
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_denied_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp,
      LATERAL jsonb_array_elements_text(COALESCE(pp.denied_permissions, '[]'::jsonb)) AS perm(value)
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND perm.value = p_permission
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.permission_is_system_only(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_permission = 'system:all'
    OR p_permission LIKE 'developer:%'
    OR p_permission IN (
      'roles:manage',
      'auth:sessions.manage',
      'settings:system.read',
      'settings:system.write',
      'notifications:system.read'
    ),
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
      'pharmacy:read','branches:read','sales:read','sales:write','purchases:read',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print',
      'items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read'
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

-- ===================================================================
-- 4) OWNER WORKSPACE CREATION
-- ===================================================================

CREATE OR REPLACE FUNCTION public.ensure_owner_workspace(
  p_user_id UUID DEFAULT auth.uid(),
  p_project_name TEXT DEFAULT NULL,
  p_owner_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'EG',
  p_city TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP',
  p_timezone TEXT DEFAULT 'Africa/Cairo'
)
RETURNS TABLE(pharmacy_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_claim_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), NULLIF(BTRIM(p_owner_name), ''), 'صيدلية جديدة');
  v_email TEXT := NULLIF(BTRIM(p_email), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  IF v_claim_role <> 'service_role'
    AND (
      v_actor_id IS NULL
      OR (
        v_actor_id <> p_user_id
        AND NOT public.is_developer(v_actor_id)
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن تجهيز صيدلية لمستخدم آخر';
  END IF;

  IF public.is_developer(p_user_id) THEN
    RAISE EXCEPTION 'حساب المطور عالمي ولا يتبع صيدلية';
  END IF;

  INSERT INTO public.pharmacies (
    owner_id, name, legal_name, status, plan, currency, country, timezone, phone, email, address
  )
  VALUES (
    p_user_id,
    v_project_name,
    v_project_name,
    'active',
    'trial',
    COALESCE(NULLIF(BTRIM(p_currency), ''), 'EGP'),
    COALESCE(NULLIF(BTRIM(p_country), ''), 'EG'),
    COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Africa/Cairo'),
    NULLIF(BTRIM(p_phone), ''),
    v_email,
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
  VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(BTRIM(p_city), ''), NULLIF(BTRIM(p_phone), ''), true, 'active')
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active, updated_at)
  VALUES (
    p_user_id,
    COALESCE(v_email, p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(v_email, public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = CASE WHEN public.user_profiles.global_role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status, updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    v_email,
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'صاحب الصيدلية',
    'owner',
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    'created',
    now()
  )
  ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
    branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
    email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
    title = 'صاحب الصيدلية',
    role = 'owner',
    is_active = true,
    disabled_reason = NULL,
    updated_at = now();

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

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
  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'display_name', ''), split_part(NEW.email, '@', 1));
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.raw_user_meta_data->>'mobile', ''));
  -- Never trust public signup metadata for developer access.
  -- Safe pharmacy roles may still be supplied by trusted admin invitations.
  v_role := CASE
    WHEN lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN 'developer'
    WHEN COALESCE(NEW.raw_user_meta_data->>'role', '') IN (
      'owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'
    ) THEN NEW.raw_user_meta_data->>'role'
    ELSE 'owner'
  END;

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
    is_active = true,
    updated_at = now();

  IF v_role = 'developer' THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();

    DELETE FROM public.pharmacy_profiles WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  IF v_role = 'owner' THEN
    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (NEW.id, v_project_name, v_project_name, v_currency, v_country, v_timezone, v_phone, NEW.email, v_city, 'active', 'trial')
    ON CONFLICT (owner_id) DO UPDATE SET
      status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
      updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', v_city, v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET
      is_default = true,
      status = 'active',
      updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
    VALUES (v_pharmacy_id, v_branch_id, NEW.id, NEW.email, v_full_name, v_phone, 'صاحب الصيدلية', 'owner', true, '[]'::jsonb, '[]'::jsonb, 'created')
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
      branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
      email = COALESCE(EXCLUDED.email, public.pharmacy_profiles.email),
      full_name = COALESCE(EXCLUDED.full_name, public.pharmacy_profiles.full_name),
      phone = COALESCE(EXCLUDED.phone, public.pharmacy_profiles.phone),
      title = 'صاحب الصيدلية',
      role = 'owner',
      is_active = true,
      disabled_reason = NULL,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ===================================================================
-- 5) BACKFILL OLD DATA
-- ===================================================================

-- default branch for old pharmacies
INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, is_default, status)
SELECT p.id, 'MAIN', 'الفرع الرئيسي', true, 'active'
FROM public.pharmacies p
WHERE NOT EXISTS (SELECT 1 FROM public.pharmacy_branches b WHERE b.pharmacy_id = p.id)
ON CONFLICT (pharmacy_id, code) DO UPDATE SET
  is_default = true,
  status = 'active',
  updated_at = now();

-- keep only one default branch per pharmacy before creating the partial unique index
WITH ranked_branches AS (
  SELECT id, row_number() OVER (PARTITION BY pharmacy_id ORDER BY is_default DESC, created_at ASC, id ASC) AS rn
  FROM public.pharmacy_branches
)
UPDATE public.pharmacy_branches b
SET is_default = (r.rn = 1), updated_at = now()
FROM ranked_branches r
WHERE b.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_branches_one_default
  ON public.pharmacy_branches(pharmacy_id)
  WHERE is_default = true;

-- owner membership for every pharmacy
INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
SELECT
  p.id,
  b.id,
  p.owner_id,
  COALESCE(up.email, u.email),
  COALESCE(up.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  COALESCE(up.phone, u.raw_user_meta_data->>'phone', u.raw_user_meta_data->>'mobile'),
  'صاحب الصيدلية',
  'owner',
  true,
  '[]'::jsonb,
  '[]'::jsonb,
  'created'
FROM public.pharmacies p
JOIN auth.users u ON u.id = p.owner_id
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT id
  FROM public.pharmacy_branches b
  WHERE b.pharmacy_id = p.id
  ORDER BY b.is_default DESC, b.created_at ASC
  LIMIT 1
) b ON true
WHERE NOT public.is_developer(p.owner_id)
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  branch_id = COALESCE(public.pharmacy_profiles.branch_id, EXCLUDED.branch_id),
  email = COALESCE(public.pharmacy_profiles.email, EXCLUDED.email),
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  phone = COALESCE(public.pharmacy_profiles.phone, EXCLUDED.phone),
  title = 'صاحب الصيدلية',
  role = 'owner',
  is_active = true,
  disabled_reason = NULL,
  updated_at = now();

-- old owner signups that were stuck with no pharmacy
DO $$
DECLARE
  r RECORD;
  v_pharmacy_id UUID;
  v_branch_id UUID;
  v_full_name TEXT;
  v_phone TEXT;
  v_project_name TEXT;
BEGIN
  FOR r IN
    SELECT u.*,
           up.global_role,
           up.full_name AS profile_full_name,
           up.phone AS profile_phone
    FROM auth.users u
    LEFT JOIN public.user_profiles up ON up.user_id = u.id
    WHERE NOT public.is_developer(u.id)
      AND NOT EXISTS (SELECT 1 FROM public.pharmacies p WHERE p.owner_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.pharmacy_profiles pp WHERE pp.user_id = u.id AND pp.role <> 'no-access')
      AND (
        COALESCE(u.raw_user_meta_data->>'role', '') = 'owner'
        OR NULLIF(u.raw_user_meta_data->>'project_name', '') IS NOT NULL
        OR NULLIF(u.raw_user_meta_data->>'pharmacy_name', '') IS NOT NULL
        OR up.global_role = 'owner'
      )
  LOOP
    v_full_name := COALESCE(NULLIF(r.profile_full_name, ''), NULLIF(r.raw_user_meta_data->>'full_name', ''), NULLIF(r.raw_user_meta_data->>'display_name', ''), split_part(r.email, '@', 1));
    v_phone := COALESCE(NULLIF(r.profile_phone, ''), NULLIF(r.raw_user_meta_data->>'phone', ''), NULLIF(r.raw_user_meta_data->>'mobile', ''));
    v_project_name := COALESCE(NULLIF(r.raw_user_meta_data->>'project_name', ''), NULLIF(r.raw_user_meta_data->>'pharmacy_name', ''), v_full_name, r.email, 'صيدلية جديدة');

    INSERT INTO public.pharmacies (owner_id, name, legal_name, currency, country, timezone, phone, email, address, status, plan)
    VALUES (
      r.id,
      v_project_name,
      v_project_name,
      COALESCE(NULLIF(r.raw_user_meta_data->>'currency', ''), 'EGP'),
      COALESCE(NULLIF(r.raw_user_meta_data->>'country', ''), 'EG'),
      COALESCE(NULLIF(r.raw_user_meta_data->>'timezone', ''), 'Africa/Cairo'),
      v_phone,
      r.email,
      NULLIF(r.raw_user_meta_data->>'city', ''),
      'active',
      'trial'
    )
    ON CONFLICT (owner_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_pharmacy_id;

    INSERT INTO public.pharmacy_branches (pharmacy_id, code, name, address, phone, is_default, status)
    VALUES (v_pharmacy_id, 'MAIN', 'الفرع الرئيسي', NULLIF(r.raw_user_meta_data->>'city', ''), v_phone, true, 'active')
    ON CONFLICT (pharmacy_id, code) DO UPDATE SET is_default = true, status = 'active', updated_at = now()
    RETURNING id INTO v_branch_id;

    INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active)
    VALUES (r.id, r.email, v_full_name, v_phone, 'owner', true)
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
      phone = COALESCE(public.user_profiles.phone, EXCLUDED.phone),
      global_role = 'owner',
      is_active = true,
      updated_at = now();

    INSERT INTO public.pharmacy_profiles (pharmacy_id, branch_id, user_id, email, full_name, phone, title, role, is_active, permissions, denied_permissions, invite_status)
    VALUES (v_pharmacy_id, v_branch_id, r.id, r.email, v_full_name, v_phone, 'صاحب الصيدلية', 'owner', true, '[]'::jsonb, '[]'::jsonb, 'created')
    ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET role = 'owner', is_active = true, disabled_reason = NULL, updated_at = now();
  END LOOP;
END;
$$;

-- final safety: no developer rows in pharmacy_profiles
DELETE FROM public.pharmacy_profiles pp
WHERE public.is_developer(pp.user_id);

-- ===================================================================
-- 6) RLS POLICIES - FINAL MODEL
-- ===================================================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON public.user_profiles;

CREATE POLICY user_profiles_select ON public.user_profiles
FOR SELECT USING (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_insert ON public.user_profiles
FOR INSERT WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_update ON public.user_profiles
FOR UPDATE USING (public.is_developer() OR user_id = auth.uid())
WITH CHECK (public.is_developer() OR user_id = auth.uid());

CREATE POLICY user_profiles_delete ON public.user_profiles
FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS pharmacies_select ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_insert ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_update ON public.pharmacies;
DROP POLICY IF EXISTS pharmacies_delete ON public.pharmacies;

CREATE POLICY pharmacies_select ON public.pharmacies
FOR SELECT USING (public.has_pharmacy_access(id) OR owner_id = auth.uid());

CREATE POLICY pharmacies_insert ON public.pharmacies
FOR INSERT WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_update ON public.pharmacies
FOR UPDATE USING (public.is_developer() OR owner_id = auth.uid())
WITH CHECK (public.is_developer() OR owner_id = auth.uid());

CREATE POLICY pharmacies_delete ON public.pharmacies
FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS pharmacy_branches_select ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_insert ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_update ON public.pharmacy_branches;
DROP POLICY IF EXISTS pharmacy_branches_delete ON public.pharmacy_branches;

CREATE POLICY pharmacy_branches_select ON public.pharmacy_branches
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'branches:read'));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'branches:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'branches:write'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'branches:delete'));

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;
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

-- owner/admin/manager can add employees only. owner rows are created by trusted server/trigger, not by normal UI insert.
CREATE POLICY pharmacy_profiles_insert_final ON public.pharmacy_profiles
FOR INSERT WITH CHECK (
  public.can_manage_pharmacy_users(pharmacy_id)
  AND role NOT IN ('owner')
);

CREATE POLICY pharmacy_profiles_update_final ON public.pharmacy_profiles
FOR UPDATE USING (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
)
WITH CHECK (
  public.is_developer()
  OR (
    public.can_manage_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);

CREATE POLICY pharmacy_profiles_delete_final ON public.pharmacy_profiles
FOR DELETE USING (
  public.is_developer()
  OR (
    public.can_delete_pharmacy_users(pharmacy_id)
    AND role NOT IN ('owner')
  )
);

-- developer_* tables are developer-only.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'developer_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS developer_only_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY developer_only_all ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', tbl);
  END LOOP;
END;
$$;

-- ===================================================================
-- 7) SETTINGS SAFETY - SYSTEM SETTINGS ARE GLOBAL/DEVELOPER ONLY
-- ===================================================================

CREATE OR REPLACE FUNCTION public.is_core_system_setting_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_key LIKE 'system.%'
    OR p_key IN (
      'appName','appVersion','companyName','supportPhone','supportEmail',
      'enableAutoBackup','backupFrequency','backupRetentionDays','backupLocation',
      'enableAuditLog','auditLogRetentionDays','enableMultiBranch','enableMultiCurrency','defaultBranchId',
      'enableDarkMode','enableNotifications','sessionTimeout','maxLoginAttempts','enableTwoFactor','maintenanceMode'
    ),
    false
  );
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pharmacy_settings'
  ) THEN
    ALTER TABLE public.pharmacy_settings ALTER COLUMN pharmacy_id DROP NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_settings_global_key
      ON public.pharmacy_settings(key)
      WHERE pharmacy_id IS NULL;

    ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
    DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_select ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_update ON public.pharmacy_settings;
    DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_settings;

    CREATE POLICY pharmacy_settings_select
    ON public.pharmacy_settings
    FOR SELECT
    USING (
      auth.uid() IS NOT NULL
      AND (
        pharmacy_id IS NULL
        OR public.has_pharmacy_access(pharmacy_id, auth.uid())
      )
    );

    CREATE POLICY pharmacy_settings_insert
    ON public.pharmacy_settings
    FOR INSERT
    WITH CHECK (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    );

    CREATE POLICY pharmacy_settings_update
    ON public.pharmacy_settings
    FOR UPDATE
    USING (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    )
    WITH CHECK (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    );

    CREATE POLICY pharmacy_settings_delete
    ON public.pharmacy_settings
    FOR DELETE
    USING (
      (
        pharmacy_id IS NULL
        AND public.is_developer(auth.uid())
      )
      OR (
        pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(key)
            AND public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
          )
        )
      )
    );
  END IF;
END;
$$;

-- ===================================================================
-- 8) FIX IN-APP DELETED NOTIFICATIONS TABLE CONFLICT
-- ===================================================================
-- The old schema already has pharmacy_deleted_notifications for pharmacy_notifications.
-- The in-app notifications audit must use a separate table to avoid missing columns/runtime errors.

CREATE TABLE IF NOT EXISTS public.pharmacy_inapp_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  was_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inapp_deleted_notif_user
  ON public.pharmacy_inapp_deleted_notifications(user_id, deleted_at DESC);

ALTER TABLE public.pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON public.pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
ON public.pharmacy_inapp_deleted_notifications FOR SELECT
USING (auth.uid() = user_id OR public.is_developer(auth.uid()));

CREATE OR REPLACE FUNCTION public.fn_archive_deleted_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.pharmacy_inapp_deleted_notifications (
      user_id,
      original_id,
      title,
      description,
      notif_type,
      href,
      was_read,
      created_at,
      deleted_by
    ) VALUES (
      NEW.user_id,
      NEW.id,
      NEW.title,
      NEW.description,
      NEW.notif_type,
      NEW.href,
      NEW.read,
      NEW.created_at,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_deleted_notification ON public.pharmacy_inapp_notifications;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pharmacy_inapp_notifications'
  ) THEN
    CREATE TRIGGER trg_archive_deleted_notification
      BEFORE UPDATE OF deleted_at ON public.pharmacy_inapp_notifications
      FOR EACH ROW
      WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
      EXECUTE FUNCTION public.fn_archive_deleted_notification();
  END IF;
END;
$$;

-- ===================================================================
-- 9) CASHIER TABLE INTEGRITY
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_open_user
  ON public.pharmacy_shifts(pharmacy_id, branch_id, user_id, status, opened_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_shift_id
  ON public.pharmacy_sales(shift_id)
  WHERE shift_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pharmacy_sales_shift_id_fkey'
      AND conrelid = 'public.pharmacy_sales'::regclass
  ) THEN
    ALTER TABLE public.pharmacy_sales
      ADD CONSTRAINT pharmacy_sales_shift_id_fkey
      FOREIGN KEY (shift_id)
      REFERENCES public.pharmacy_shifts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

-- ===================================================================
-- 10) UPDATED_AT TRIGGERS
-- ===================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER touch_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacy_profiles_updated_at ON public.pharmacy_profiles;
CREATE TRIGGER touch_pharmacy_profiles_updated_at
BEFORE UPDATE ON public.pharmacy_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacies_updated_at ON public.pharmacies;
CREATE TRIGGER touch_pharmacies_updated_at
BEFORE UPDATE ON public.pharmacies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_pharmacy_branches_updated_at ON public.pharmacy_branches;
CREATE TRIGGER touch_pharmacy_branches_updated_at
BEFORE UPDATE ON public.pharmacy_branches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
