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
