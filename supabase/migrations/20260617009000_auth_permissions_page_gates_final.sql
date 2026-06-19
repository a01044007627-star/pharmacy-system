-- Final permissions hardening for page/section/action gates.
-- This migration keeps RLS aligned with the frontend permission model:
-- page access, section access, action buttons, and sensitive field access.

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

CREATE OR REPLACE FUNCTION public.permission_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    EXISTS(
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

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN p_permission NOT LIKE 'developer:%' AND p_permission <> 'system:all' AND p_permission <> 'settings:system.write';
  END IF;

  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write','branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','roles:manage','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','notifications:templates.write','sync:read','deleted-records:read','deleted-records:restore'
    ) OR (p_permission LIKE 'settings:%' AND p_permission NOT IN ('settings:system.write','settings:system.read','settings:backup.write'));
  END IF;

  IF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount',
      'purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','notifications:read','notifications:manage','sync:read'
    ) OR p_permission IN (
      'settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read'
    );
  END IF;

  IF v_role = 'accountant' THEN
    RETURN p_permission IN ('sales:read','purchases:read','inventory:read','items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','financials:read','financials:write','reports:read','reports:export','crm:read','settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read');
  END IF;

  IF v_role = 'pharmacist' THEN
    RETURN p_permission IN ('sales:read','sales:write','purchases:read','inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print','items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read');
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

CREATE OR REPLACE FUNCTION public.can_manage_pharmacy_users(p_pharmacy_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(public.user_has_permission(p_pharmacy_id, 'users:write', p_user_id), false);
$$;

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

CREATE POLICY pharmacy_profiles_select ON public.pharmacy_profiles
FOR SELECT USING (public.user_has_permission(pharmacy_id, 'users:read') OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_insert ON public.pharmacy_profiles
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'users:write'));

CREATE POLICY pharmacy_profiles_update ON public.pharmacy_profiles
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'users:write') OR user_id = auth.uid())
WITH CHECK (public.user_has_permission(pharmacy_id, 'users:write') OR user_id = auth.uid());

CREATE POLICY pharmacy_profiles_delete ON public.pharmacy_profiles
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'users:delete'));
