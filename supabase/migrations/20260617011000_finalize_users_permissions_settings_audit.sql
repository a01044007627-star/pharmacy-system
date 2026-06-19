-- ===================================================================
-- FINALIZE USERS / PERMISSIONS / SETTINGS / AUDIT
-- ===================================================================

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS denied_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'linked',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pharmacy_profiles_denied_permissions
  ON public.pharmacy_profiles USING GIN (denied_permissions);

CREATE TABLE IF NOT EXISTS public.pharmacy_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  source TEXT NOT NULL DEFAULT 'system',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_scope
  ON public.pharmacy_audit_events(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_audit_events_actor
  ON public.pharmacy_audit_events(actor_id, created_at DESC);

ALTER TABLE public.pharmacy_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_audit_events_select ON public.pharmacy_audit_events;
DROP POLICY IF EXISTS pharmacy_audit_events_insert ON public.pharmacy_audit_events;

CREATE POLICY pharmacy_audit_events_select ON public.pharmacy_audit_events
FOR SELECT USING (
  public.is_developer()
  OR public.user_pharmacy_role(pharmacy_id) = 'owner'
  OR public.user_has_permission(pharmacy_id, 'auth:audit.read')
);

CREATE POLICY pharmacy_audit_events_insert ON public.pharmacy_audit_events
FOR INSERT WITH CHECK (
  public.is_developer()
  OR public.has_pharmacy_access(pharmacy_id)
);

CREATE OR REPLACE FUNCTION public.permission_denied_in_profile(p_pharmacy_id UUID, p_permission TEXT, p_user_id UUID DEFAULT auth.uid())
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
      LATERAL jsonb_array_elements_text(COALESCE(pp.denied_permissions, '[]'::jsonb)) AS perm(value)
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

  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN
    RETURN false;
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
