-- ===================================================================
-- USERS / ROLES / PERMISSIONS FINALIZATION
-- إغلاق نظام المستخدمين: إضافة/تعديل/إيقاف/صلاحيات/فرع
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.pharmacy_profiles DROP CONSTRAINT IF EXISTS pharmacy_profiles_role_check;
ALTER TABLE public.pharmacy_profiles
  ADD CONSTRAINT pharmacy_profiles_role_check
  CHECK(role IN ('developer','owner','admin','manager','accountant','pharmacist','cashier','technician','worker','viewer','no-access'));

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_role ON public.pharmacy_profiles(pharmacy_id, role, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_scope_branch ON public.pharmacy_profiles(pharmacy_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_user_id ON public.pharmacy_profiles(user_id);

-- Ensure every pharmacy owner has an explicit membership row so the users module
-- can display/protect the owner consistently.
INSERT INTO public.pharmacy_profiles (
  pharmacy_id,
  user_id,
  role,
  is_active,
  email,
  full_name,
  phone,
  title,
  permissions,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.owner_id,
  'owner',
  true,
  up.email,
  COALESCE(up.full_name, split_part(up.email, '@', 1)),
  up.phone,
  'صاحب الصيدلية',
  '[]'::jsonb,
  now(),
  now()
FROM public.pharmacies p
LEFT JOIN public.user_profiles up ON up.user_id = p.owner_id
ON CONFLICT ON CONSTRAINT pharmacy_profiles_pharmacy_id_user_id_key DO UPDATE SET
  role = CASE WHEN public.pharmacy_profiles.role IN ('developer','owner') THEN public.pharmacy_profiles.role ELSE 'owner' END,
  is_active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    public.is_developer(p_user_id)
    OR public.user_pharmacy_role(p_pharmacy_id, p_user_id) = 'owner'
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
    OR public.user_pharmacy_role(p_pharmacy_id, p_user_id) = 'owner'
    OR public.user_has_permission(p_pharmacy_id, 'users:delete', p_user_id),
    false
  );
$$;

ALTER TABLE public.pharmacy_profiles ENABLE ROW LEVEL SECURITY;

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
