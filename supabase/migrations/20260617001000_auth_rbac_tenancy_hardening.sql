-- ===================================================================
-- AUTH / RBAC / TENANCY HARDENING
-- Developer > Owner > Pharmacy Employees
-- يمنع اختلاط بيانات الصيدليات ويثبت صلاحيات المستخدمين على مستوى الداتا بيز
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========================
-- 1. USER PROFILE DATA
-- ========================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  global_role TEXT NOT NULL DEFAULT 'no-access'
    CHECK(global_role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(lower(email));

-- ========================
-- 2. NORMALIZE PHARMACY MEMBERSHIPS
-- ========================
ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_branch_id ON public.pharmacy_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_role ON public.pharmacy_profiles(role);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_active ON public.pharmacy_profiles(pharmacy_id, user_id, is_active);

-- ========================
-- 3. DEVELOPER SEED BY OWNER EMAIL
-- ========================
INSERT INTO public.developer_users (user_id, role, is_active, permissions)
SELECT u.id, 'super_admin', true, ARRAY['system:all']::TEXT[]
FROM auth.users u
WHERE lower(u.email) = lower('mostafa0falcon@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  permissions = ARRAY['system:all']::TEXT[],
  updated_at = now();

-- ========================
-- 4. AUTH HELPER FUNCTIONS
-- ========================
CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
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
    EXISTS(
      SELECT 1
      FROM public.pharmacies p
      WHERE p.id = p_pharmacy_id
        AND p.owner_id = p_user_id
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
    public.is_developer(p_user_id)
    OR public.is_pharmacy_owner(p_pharmacy_id, p_user_id)
    OR EXISTS(
      SELECT 1
      FROM public.pharmacy_profiles pp
      WHERE pp.pharmacy_id = p_pharmacy_id
        AND pp.user_id = p_user_id
        AND pp.is_active = true
        AND pp.role <> 'no-access'
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
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.user_pharmacy_role(p_pharmacy_id, p_user_id) IN ('developer','owner','admin');
$$;

-- ========================
-- 5. AUTH USER TRIGGER
-- ========================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'no-access');
  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    v_role := 'developer';
  END IF;

  INSERT INTO public.user_profiles (user_id, email, username, full_name, phone, avatar_url, global_role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'display_name'),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'mobile'),
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

  IF lower(NEW.email) = lower('mostafa0falcon@gmail.com') THEN
    INSERT INTO public.developer_users (user_id, role, is_active, permissions)
    VALUES (NEW.id, 'super_admin', true, ARRAY['system:all']::TEXT[])
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'super_admin',
      is_active = true,
      permissions = ARRAY['system:all']::TEXT[],
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_logixa_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_logixa_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ========================
-- 6. RLS: USER PROFILES
-- ========================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

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

-- ========================
-- 7. RLS: CORE TENANCY TABLES
-- ========================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

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
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY pharmacy_branches_insert ON public.pharmacy_branches
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));

CREATE POLICY pharmacy_branches_update ON public.pharmacy_branches
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));

CREATE POLICY pharmacy_branches_delete ON public.pharmacy_branches
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner'));

DROP POLICY IF EXISTS pharmacy_profiles_select ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_insert ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_update ON public.pharmacy_profiles;
DROP POLICY IF EXISTS pharmacy_profiles_delete ON public.pharmacy_profiles;

CREATE POLICY pharmacy_profiles_select ON public.pharmacy_profiles
FOR SELECT USING (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_insert ON public.pharmacy_profiles
FOR INSERT WITH CHECK (public.can_manage_pharmacy_users(pharmacy_id));

CREATE POLICY pharmacy_profiles_update ON public.pharmacy_profiles
FOR UPDATE USING (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid())
WITH CHECK (public.can_manage_pharmacy_users(pharmacy_id) OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_delete ON public.pharmacy_profiles
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner'));

-- ========================
-- 8. RLS: ALL PHARMACY TABLES WITH pharmacy_id
-- ========================
DO $$
DECLARE
  tbl TEXT;
  has_branch BOOLEAN;
  branch_guard TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'pharmacy_id'
      AND c.table_name NOT IN ('pharmacies', 'pharmacy_branches', 'pharmacy_profiles')
      AND c.table_name NOT LIKE 'developer_%'
    GROUP BY c.table_name
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns bc
      WHERE bc.table_schema = 'public'
        AND bc.table_name = tbl
        AND bc.column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)' ELSE '' END;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT USING (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id)%s) WITH CHECK (public.has_pharmacy_access(pharmacy_id)%s)',
      tbl,
      branch_guard,
      branch_guard
    );

    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN (''developer'',''owner'',''admin''))',
      tbl
    );
  END LOOP;
END;
$$;

-- ========================
-- 9. RLS: DEVELOPER TABLES
-- ========================
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

-- ========================
-- 10. AUDIT HELPERS / UPDATED_AT TRIGGERS
-- ========================
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

-- ========================
-- 11. BACKFILL PROFILES FROM AUTH USERS / OWNERS
-- ========================
INSERT INTO public.user_profiles (user_id, email, full_name, phone, global_role, is_active)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name'),
  COALESCE(u.raw_user_meta_data->>'phone', u.raw_user_meta_data->>'mobile'),
  CASE WHEN lower(u.email) = lower('mostafa0falcon@gmail.com') THEN 'developer' ELSE COALESCE(u.raw_user_meta_data->>'role', 'no-access') END,
  true
FROM auth.users u
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
  phone = COALESCE(public.user_profiles.phone, EXCLUDED.phone),
  global_role = CASE WHEN public.user_profiles.global_role = 'no-access' THEN EXCLUDED.global_role ELSE public.user_profiles.global_role END,
  updated_at = now();

INSERT INTO public.pharmacy_profiles (pharmacy_id, user_id, role, is_active, permissions, email, full_name)
SELECT
  p.id,
  p.owner_id,
  'owner',
  true,
  '[]'::jsonb,
  u.email,
  COALESCE(up.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'display_name')
FROM public.pharmacies p
JOIN auth.users u ON u.id = p.owner_id
LEFT JOIN public.user_profiles up ON up.user_id = u.id
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = 'owner',
  is_active = true,
  email = EXCLUDED.email,
  full_name = COALESCE(public.pharmacy_profiles.full_name, EXCLUDED.full_name),
  updated_at = now();

INSERT INTO public.developer_table_registry (table_name, display_name, category, sync_enabled, audit_enabled)
VALUES
  ('user_profiles', 'User Profiles', 'auth', true, true),
  ('pharmacy_profiles', 'Pharmacy User Memberships', 'auth', true, true),
  ('pharmacies', 'Pharmacies', 'tenant', true, true),
  ('pharmacy_branches', 'Pharmacy Branches', 'tenant', true, true)
ON CONFLICT (table_name) DO UPDATE SET
  category = EXCLUDED.category,
  sync_enabled = EXCLUDED.sync_enabled,
  audit_enabled = EXCLUDED.audit_enabled,
  updated_at = now();
