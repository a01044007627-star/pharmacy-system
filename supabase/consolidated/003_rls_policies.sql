-- ===================================================================
-- RLS POLICIES — Consolidated
-- Organized by table alphabetically, using FINAL/LATEST version of each policy.
-- Dynamic DO blocks from migrations are converted to explicit CREATE POLICY statements.
-- ===================================================================

-- ===================================================================
-- developer_% tables (all 18 developer tables)
-- Source: 20260618004000 (final) — converted from dynamic DO block
-- ===================================================================

DO $$DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'developer\_%'
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS developer_only_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY developer_only_all ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', tbl);
  END LOOP;
END$$;


-- ===================================================================
-- pharmacies
-- Source: 20260618004000 (final — identical to 20260617001000)
-- ===================================================================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

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


-- ===================================================================
-- pharmacy_audit_events
-- Source: 20260617011000 (final)
-- ===================================================================
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


-- ===================================================================
-- pharmacy_backups
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_backups;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_backups;

CREATE POLICY tenant_select ON public.pharmacy_backups
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_backups
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_backups
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_backups
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_barcode_paper_settings
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_barcode_paper_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_barcode_paper_settings;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_barcode_paper_settings;

CREATE POLICY tenant_select ON public.pharmacy_barcode_paper_settings
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_barcode_paper_settings
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_barcode_paper_settings
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_barcode_paper_settings
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_branches
-- Source: 20260618004000 (final — uses user_has_permission with granular permissions)
-- ===================================================================
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;

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


-- ===================================================================
-- pharmacy_cash_registers
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_cash_registers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_cash_registers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_cash_registers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_cash_registers;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_cash_registers
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_cash_registers
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_cash_registers
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_damaged_stock
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_damaged_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_damaged_stock;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_damaged_stock;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_damaged_stock;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_damaged_stock
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_damaged_stock
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_damaged_stock
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_deleted_items_audit
-- Source: 20260617003000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_deleted_items_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deleted_items_audit_select ON public.pharmacy_deleted_items_audit;
CREATE POLICY deleted_items_audit_select
ON public.pharmacy_deleted_items_audit FOR SELECT
USING (
  public.is_developer(auth.uid())
  OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin')
);


-- ===================================================================
-- pharmacy_expenses
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_expenses;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_expenses;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_expenses;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_expenses
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_expenses
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_expenses
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_financial_movements
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_financial_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_financial_movements;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_financial_movements;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_financial_movements;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_financial_movements
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_financial_movements
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_financial_movements
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_inapp_deleted_notifications
-- Source: 20260618004000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON public.pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
ON public.pharmacy_inapp_deleted_notifications FOR SELECT
USING (auth.uid() = user_id OR public.is_developer(auth.uid()));


-- ===================================================================
-- pharmacy_inapp_notifications
-- Source: 20260617002000 (final — not redefined in 20260618004000)
-- ===================================================================
ALTER TABLE public.pharmacy_inapp_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_owner_select ON pharmacy_inapp_notifications;
DROP POLICY IF EXISTS notif_owner_insert ON pharmacy_inapp_notifications;
DROP POLICY IF EXISTS notif_owner_update ON pharmacy_inapp_notifications;

CREATE POLICY notif_owner_select
ON pharmacy_inapp_notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY notif_owner_insert
ON pharmacy_inapp_notifications FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY notif_owner_update
ON pharmacy_inapp_notifications FOR UPDATE
USING (auth.uid() = user_id);


-- ===================================================================
-- pharmacy_inventory_snapshots
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_inventory_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_inventory_snapshots;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_inventory_snapshots;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_inventory_snapshots;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_inventory_snapshots
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_inventory_snapshots
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_inventory_snapshots
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_invoice_designs
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_invoice_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_invoice_designs;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_invoice_designs;

CREATE POLICY tenant_select ON public.pharmacy_invoice_designs
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_invoice_designs
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_invoice_designs
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_invoice_designs
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_invoice_drafts
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_invoice_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_invoice_drafts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_invoice_drafts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_invoice_drafts;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_invoice_drafts
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_invoice_drafts
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_invoice_drafts
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_item_alternatives
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_alternatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_alternatives;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_alternatives;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_alternatives;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_alternatives
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_alternatives
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_alternatives
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_barcodes
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_barcodes;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_barcodes;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_barcodes;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_barcodes
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_barcodes
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_barcodes
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_batches
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_batches;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_batches;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_batches;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_item_batches
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_item_batches
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_item_batches
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_units
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_units;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_units;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_units;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_units
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_units
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_units
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_variants
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_variants;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_variants;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_variants;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_variants
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_variants
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_variants
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_item_warranties
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_item_warranties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_item_warranties;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_item_warranties;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_item_warranties;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_item_warranties
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_item_warranties
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_item_warranties
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_items
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_items;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_items;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_items;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_items
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_items
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_items
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_notification_templates
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_notification_templates;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_notification_templates;

CREATE POLICY tenant_select ON public.pharmacy_notification_templates
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_notification_templates
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_notification_templates
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_notification_templates
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_partners
-- Source: 20260617001000 (original DO block — not refined in later migrations)
-- ===================================================================
ALTER TABLE public.pharmacy_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_partners;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_partners;

CREATE POLICY tenant_select ON public.pharmacy_partners
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_partners
FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_update ON public.pharmacy_partners
FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id))
WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_delete ON public.pharmacy_partners
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_payment_allocations
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_payment_allocations;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_payment_allocations;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_payment_allocations;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_payment_allocations
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_update ON public.pharmacy_payment_allocations
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_delete ON public.pharmacy_payment_allocations
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_payments
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_payments;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_payments;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_payments;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_payments
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_payments
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_payments
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_prescriptions
-- Source: 20260618011000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_prescriptions_read ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_read ON public.pharmacy_prescriptions
  FOR SELECT TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.user_has_permission(pharmacy_id, 'prescriptions:read', auth.uid())
  );

DROP POLICY IF EXISTS pharmacy_prescriptions_write ON public.pharmacy_prescriptions;
CREATE POLICY pharmacy_prescriptions_write ON public.pharmacy_prescriptions
  FOR ALL TO authenticated
  USING (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  )
  WITH CHECK (
    public.is_developer(auth.uid())
    OR public.user_pharmacy_role(pharmacy_id, auth.uid()) IN ('owner','admin','pharmacist')
    OR public.permission_in_profile(pharmacy_id, 'prescriptions:write', auth.uid())
  );


-- ===================================================================
-- pharmacy_price_groups
-- Source: 20260618011000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_price_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_price_groups_read ON public.pharmacy_price_groups;
DROP POLICY IF EXISTS pharmacy_price_groups_write ON public.pharmacy_price_groups;

CREATE POLICY pharmacy_price_groups_read ON public.pharmacy_price_groups
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:read', auth.uid()));

CREATE POLICY pharmacy_price_groups_write ON public.pharmacy_price_groups
  FOR ALL TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'inventory:create', auth.uid()));


-- ===================================================================
-- pharmacy_profiles
-- Source: 20260618004000 (final — _final policies)
-- ===================================================================
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


-- ===================================================================
-- pharmacy_purchase_lines
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_update ON public.pharmacy_purchase_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_orders
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_orders;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_orders;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_orders;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_orders
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchase_orders
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_orders
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_return_lines
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_return_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_return_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_return_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_return_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_update ON public.pharmacy_purchase_return_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write'));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_return_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchase_returns
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchase_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchase_returns;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchase_returns;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchase_returns;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchase_returns
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchase_returns
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchase_returns
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_purchases
-- Source: 20260618008000 (final — purchases tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_purchases;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_purchases;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_purchases;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_purchases
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_purchases
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'purchases:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_purchases
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'purchases:void'));


-- ===================================================================
-- pharmacy_receipt_printers
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_receipt_printers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_receipt_printers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_receipt_printers;

CREATE POLICY tenant_select ON public.pharmacy_receipt_printers
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_receipt_printers
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_receipt_printers
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_receipt_printers
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_register_transactions
-- Source: 20260618008000 (final — financials tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_register_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_register_transactions;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_register_transactions;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_register_transactions;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_register_transactions
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_update ON public.pharmacy_register_transactions
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'financials:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'financials:write'));

CREATE POLICY tenant_delete ON public.pharmacy_register_transactions
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'financials:write'));


-- ===================================================================
-- pharmacy_sale_lines
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sale_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sale_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sale_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sale_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_sale_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_sale_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_sale_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_sales
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_sales
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_sales
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales_return_lines
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales_return_lines;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales_return_lines;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales_return_lines;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_sales_return_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_sales_return_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_sales_return_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_sales_returns
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_sales_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_sales_returns;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_sales_returns;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_sales_returns;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_sales_returns
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_sales_returns
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write') AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_sales_returns
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_settings
-- Source: 20260618004000 (final — inline settings policies)
-- ===================================================================
ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_settings_select ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_insert ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_update ON public.pharmacy_settings;
DROP POLICY IF EXISTS pharmacy_settings_delete ON public.pharmacy_settings;

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


-- ===================================================================
-- pharmacy_shifts
-- Source: 20260617001000 (original DO block — not refined in later migrations)
-- ===================================================================
ALTER TABLE public.pharmacy_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_shifts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_shifts;

CREATE POLICY tenant_select ON public.pharmacy_shifts
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_insert ON public.pharmacy_shifts
FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_shifts
FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK (public.has_pharmacy_access(pharmacy_id) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_shifts
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_stock_balances
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_balances;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_balances;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_balances;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_balances
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_balances
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_balances
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_counts
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_counts;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_counts;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_counts;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_counts
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_counts
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_counts
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_movements
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_movements;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_movements;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_movements;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_movements
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_update ON public.pharmacy_stock_movements
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')) AND public.has_branch_access(pharmacy_id, branch_id));

CREATE POLICY tenant_delete ON public.pharmacy_stock_movements
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_stock_transfers
-- Source: 20260618002000 (final — inventory tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_stock_transfers;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_stock_transfers;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_stock_transfers;

-- tenant_select remains from original DO block (has_pharmacy_access + branch_guard)

CREATE POLICY tenant_insert ON public.pharmacy_stock_transfers
FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:create')));

CREATE POLICY tenant_update ON public.pharmacy_stock_transfers
FOR UPDATE USING ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')))
WITH CHECK ((public.user_has_permission(pharmacy_id, 'inventory:write') OR public.user_has_permission(pharmacy_id, 'inventory:update')));

CREATE POLICY tenant_delete ON public.pharmacy_stock_transfers
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'inventory:delete'));


-- ===================================================================
-- pharmacy_suspended_invoices
-- Source: 20260618002000 (final — sales tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_suspended_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_suspended_invoices;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_suspended_invoices;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_suspended_invoices;

-- tenant_select remains from original DO block (has_pharmacy_access)

CREATE POLICY tenant_insert ON public.pharmacy_suspended_invoices
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_update ON public.pharmacy_suspended_invoices
FOR UPDATE USING (public.user_has_permission(pharmacy_id, 'sales:write'))
WITH CHECK (public.user_has_permission(pharmacy_id, 'sales:write'));

CREATE POLICY tenant_delete ON public.pharmacy_suspended_invoices
FOR DELETE USING (public.user_has_permission(pharmacy_id, 'sales:void'));


-- ===================================================================
-- pharmacy_tasks
-- Source: 20260618010000 (final)
-- ===================================================================
ALTER TABLE public.pharmacy_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_tenant_select ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_insert ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_update ON public.pharmacy_tasks;
DROP POLICY IF EXISTS task_tenant_delete ON public.pharmacy_tasks;

CREATE POLICY task_tenant_select ON public.pharmacy_tasks
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_insert ON public.pharmacy_tasks
  FOR INSERT WITH CHECK (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_update ON public.pharmacy_tasks
  FOR UPDATE USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY task_tenant_delete ON public.pharmacy_tasks
  FOR DELETE USING (public.has_pharmacy_access(pharmacy_id));


-- ===================================================================
-- pharmacy_tax_group_members
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_group_members;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_group_members;

CREATE POLICY tenant_select ON public.pharmacy_tax_group_members
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_group_members
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_group_members
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_group_members
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_tax_groups
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_groups;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_groups;

CREATE POLICY tenant_select ON public.pharmacy_tax_groups
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_groups
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_groups
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_groups
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- pharmacy_tax_rates
-- Source: 20260617008000 (settings module tenant_* policies)
-- ===================================================================
ALTER TABLE public.pharmacy_tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_insert ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_update ON public.pharmacy_tax_rates;
DROP POLICY IF EXISTS tenant_delete ON public.pharmacy_tax_rates;

CREATE POLICY tenant_select ON public.pharmacy_tax_rates
FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));

CREATE POLICY tenant_insert ON public.pharmacy_tax_rates
FOR INSERT WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_update ON public.pharmacy_tax_rates
FOR UPDATE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'))
WITH CHECK (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin','manager'));

CREATE POLICY tenant_delete ON public.pharmacy_tax_rates
FOR DELETE USING (public.user_pharmacy_role(pharmacy_id) IN ('developer','owner','admin'));


-- ===================================================================
-- user_profiles
-- Source: 20260618004000 (final — identical to 20260617001000)
-- ===================================================================
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
