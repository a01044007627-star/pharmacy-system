-- ===================================================================
-- OWNER WORKSPACE BOOTSTRAP
-- صاحب الحساب ينشئ صيدليته ويصبح مالكها تلقائيا، بينما المطور يظل عالميا.
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
  v_project_name TEXT := COALESCE(NULLIF(BTRIM(p_project_name), ''), 'صيدلية جديدة');
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
    owner_id,
    name,
    legal_name,
    status,
    plan,
    currency,
    country,
    timezone,
    phone,
    email,
    address
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
    NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(p_city), '')
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    status = CASE WHEN public.pharmacies.status = 'closed' THEN 'active' ELSE public.pharmacies.status END,
    updated_at = now()
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_branches (
    pharmacy_id,
    code,
    name,
    address,
    phone,
    is_default,
    status
  )
  VALUES (
    v_pharmacy_id,
    'MAIN',
    'الفرع الرئيسي',
    NULLIF(BTRIM(p_city), ''),
    NULLIF(BTRIM(p_phone), ''),
    true,
    'active'
  )
  ON CONFLICT ON CONSTRAINT pharmacy_branches_pharmacy_id_code_key DO UPDATE SET
    is_default = true,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_branch_id;

  INSERT INTO public.user_profiles (
    user_id,
    email,
    full_name,
    phone,
    global_role,
    is_active,
    updated_at
  )
  VALUES (
    p_user_id,
    COALESCE(NULLIF(BTRIM(p_email), ''), p_user_id::TEXT || '@owner.local'),
    NULLIF(BTRIM(p_owner_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    'owner',
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(NULLIF(BTRIM(p_email), ''), public.user_profiles.email),
    full_name = COALESCE(NULLIF(BTRIM(p_owner_name), ''), public.user_profiles.full_name),
    phone = COALESCE(NULLIF(BTRIM(p_phone), ''), public.user_profiles.phone),
    global_role = 'owner',
    is_active = true,
    updated_at = now();

  INSERT INTO public.pharmacy_profiles (
    pharmacy_id,
    branch_id,
    user_id,
    email,
    full_name,
    phone,
    title,
    role,
    is_active,
    permissions,
    denied_permissions,
    invite_status,
    updated_at
  )
  VALUES (
    v_pharmacy_id,
    v_branch_id,
    p_user_id,
    NULLIF(BTRIM(p_email), ''),
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
