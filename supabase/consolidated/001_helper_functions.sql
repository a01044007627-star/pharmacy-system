-- ===================================================================
-- PHARMACY SYSTEM - CONSOLIDATED HELPER FUNCTIONS
-- Generated from all migration files (20260617-20260618)
-- Uses CREATE OR REPLACE FUNCTION with FINAL versions only
-- Order: auth helpers → permission helpers → setting helpers → trigger helpers → notifications → workspace
-- ===================================================================

-- ========================
-- AUTH HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.is_developer(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.developer_users AS du
      WHERE du.user_id = p_user_id AND du.is_active = true
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

-- ========================
-- PERMISSION HELPERS
-- ========================

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

-- ========================
-- SETTING HELPERS
-- ========================

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

CREATE OR REPLACE FUNCTION public.can_read_setting_row(p_pharmacy_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      p_pharmacy_id IS NULL
      OR public.has_pharmacy_access(p_pharmacy_id, auth.uid())
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_setting_row(p_pharmacy_id UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND (
      (
        p_pharmacy_id IS NULL
        AND public.is_core_system_setting_key(p_key)
        AND public.is_developer(auth.uid())
      )
      OR (
        p_pharmacy_id IS NOT NULL
        AND (
          public.is_developer(auth.uid())
          OR (
            NOT public.is_core_system_setting_key(p_key)
            AND public.user_pharmacy_role(p_pharmacy_id, auth.uid()) IN ('owner','admin','manager')
          )
        )
      )
    ),
    false
  );
$$;

-- ========================
-- TRIGGER HELPERS
-- ========================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ========================
-- NOTIFICATIONS
-- ========================

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

-- ========================
-- WORKSPACE / AUTH TRIGGER
-- ========================

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
    role = CASE WHEN public.pharmacy_profiles.role = 'developer' THEN 'developer' ELSE 'owner' END,
    is_active = true,
    disabled_reason = NULL,
    updated_at = now();

  RETURN QUERY SELECT v_pharmacy_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_owner_workspace(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ========================
-- DAILY SUMMARY DATE SYNC
-- ========================

CREATE OR REPLACE FUNCTION public.sync_pharmacy_daily_summary_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.summary_date IS NULL THEN
    NEW.summary_date := CASE
      WHEN NEW.date_key ~ '^\d{4}-\d{2}-\d{2}$' THEN NEW.date_key::date
      ELSE COALESCE(NEW.created_at, now())::date
    END;
  END IF;

  IF NEW.date_key IS NULL OR NEW.date_key = '' THEN
    NEW.date_key := NEW.summary_date::text;
  END IF;

  RETURN NEW;
END;
$$;

-- ===================================================================
-- REPORT PERFORMANCE AGGREGATIONS
-- ===================================================================

-- 1. Daily sales summary aggregation
CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  sale_date DATE,
  invoice_count BIGINT,
  total_sales NUMERIC,
  total_discounts NUMERIC,
  total_tax NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  credit_sales NUMERIC,
  item_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sale_date::DATE,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_sales,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    COALESCE(SUM(s.tax_total), 0) AS total_tax,
    COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
    COALESCE(SUM(s.total - (sl.purchase_price * sl.quantity)), 0) AS total_profit,
    COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.paid_amount ELSE 0 END), 0) AS cash_sales,
    COALESCE(SUM(CASE WHEN s.payment_method IN ('card', 'wallet', 'mixed') THEN s.paid_amount ELSE 0 END), 0) AS card_sales,
    COALESCE(SUM(CASE WHEN s.payment_method = 'credit' THEN s.total ELSE 0 END), 0) AS credit_sales,
    COALESCE(SUM(sl.quantity), 0)::BIGINT AS item_count
  FROM public.pharmacy_sales s
  LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.sale_date::DATE
  ORDER BY s.sale_date::DATE DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 2. Top selling items
CREATE OR REPLACE FUNCTION public.get_top_selling_items(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 20,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  total_quantity NUMERIC,
  total_sales NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sl.item_id,
    COALESCE(i.name_ar, sl.item_name, '') AS item_name,
    i.sku,
    SUM(sl.quantity) AS total_quantity,
    SUM(sl.net_total) AS total_sales,
    SUM(sl.purchase_price * sl.quantity) AS total_cost,
    SUM(sl.net_total - (sl.purchase_price * sl.quantity)) AS total_profit,
    COUNT(DISTINCT s.id)::BIGINT AS sale_count
  FROM public.pharmacy_sale_lines sl
  JOIN public.pharmacy_sales s ON s.id = sl.sale_id AND s.pharmacy_id = sl.pharmacy_id
  LEFT JOIN public.pharmacy_items i ON i.id = sl.item_id AND i.pharmacy_id = sl.pharmacy_id
  WHERE sl.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY sl.item_id, i.name_ar, i.sku
  ORDER BY total_sales DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) TO authenticated;

-- 3. Profit & loss summary
CREATE OR REPLACE FUNCTION public.get_profit_loss_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  period_label TEXT,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  gross_profit NUMERIC,
  gross_margin_percent NUMERIC,
  total_discounts NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
BEGIN
  v_period := to_char(p_from_date, 'YYYY-MM') || ' to ' || to_char(p_to_date, 'YYYY-MM');

  RETURN QUERY
  WITH sales_data AS (
    SELECT
      COALESCE(SUM(s.total), 0) AS total_revenue,
      COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
      COALESCE(SUM(s.discount_total), 0) AS total_discounts,
      COUNT(DISTINCT s.id)::BIGINT AS invoice_count
    FROM public.pharmacy_sales s
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status NOT IN ('void', 'cancelled')
      AND s.sale_date::DATE >= p_from_date
      AND s.sale_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  ),
  expense_data AS (
    SELECT COALESCE(SUM(amount), 0) AS total_expenses
    FROM public.pharmacy_financial_movements
    WHERE pharmacy_id = p_pharmacy_id
      AND direction = 'out'
      AND category = 'expense'
      AND movement_date::DATE >= p_from_date
      AND movement_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  )
  SELECT
    v_period AS period_label,
    sales_data.total_revenue,
    sales_data.total_cost,
    GREATEST(sales_data.total_revenue - sales_data.total_cost, 0) AS gross_profit,
    CASE WHEN sales_data.total_revenue > 0
      THEN ROUND((sales_data.total_revenue - sales_data.total_cost) / sales_data.total_revenue * 100, 2)
      ELSE 0
    END AS gross_margin_percent,
    sales_data.total_discounts,
    expense_data.total_expenses,
    GREATEST(sales_data.total_revenue - sales_data.total_cost - sales_data.total_discounts - expense_data.total_expenses, 0) AS net_profit,
    sales_data.invoice_count
  FROM sales_data, expense_data;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 4. Customer activity summary
CREATE OR REPLACE FUNCTION public.get_customer_activity_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  customer_name TEXT,
  invoice_count BIGINT,
  total_spent NUMERIC,
  total_discounts NUMERIC,
  last_visit_date TIMESTAMPTZ,
  average_invoice NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.customer_name,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_spent,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    MAX(s.sale_date) AS last_visit_date,
    ROUND(COALESCE(SUM(s.total), 0) / NULLIF(COUNT(DISTINCT s.id), 0), 2) AS average_invoice
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.customer_name IS NOT NULL
  GROUP BY s.customer_name
  ORDER BY total_spent DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 5. Tax summary
CREATE OR REPLACE FUNCTION public.get_tax_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tax_period TEXT,
  taxable_sales NUMERIC,
  tax_collected NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(s.sale_date::DATE, 'YYYY-MM') AS tax_period,
    COALESCE(SUM(s.subtotal - s.discount_total), 0) AS taxable_sales,
    COALESCE(SUM(s.tax_total), 0) AS tax_collected,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.tax_total > 0
  GROUP BY to_char(s.sale_date::DATE, 'YYYY-MM')
  ORDER BY tax_period DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- ===================================================================
-- get_user_active_pharmacy_id
-- Returns the user's active pharmacy_id based on pharmacy_profiles
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_user_active_pharmacy_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pharmacy_id
  FROM public.pharmacy_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY last_login_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_active_pharmacy_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_active_pharmacy_id() TO authenticated;
