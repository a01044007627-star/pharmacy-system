-- Replace broad tenant write policies on core operational tables with
-- permission-aware policies. Reads remain tenant/branch scoped.

DO $$
DECLARE
  tbl TEXT;
  has_branch BOOLEAN;
  branch_guard TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_sales',
    'pharmacy_sale_lines',
    'pharmacy_sales_returns',
    'pharmacy_sales_return_lines',
    'pharmacy_suspended_invoices',
    'pharmacy_invoice_drafts'
  ]
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE
      WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)'
      ELSE ''
    END;

    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id, ''sales:write'')%s)',
      tbl,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.user_has_permission(pharmacy_id, ''sales:write'')%s) WITH CHECK (public.user_has_permission(pharmacy_id, ''sales:write'')%s)',
      tbl,
      branch_guard,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''sales:void''))',
      tbl
    );
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY[
    'pharmacy_items',
    'pharmacy_item_barcodes',
    'pharmacy_item_units',
    'pharmacy_item_variants',
    'pharmacy_item_warranties',
    'pharmacy_item_alternatives',
    'pharmacy_item_batches',
    'pharmacy_stock_balances',
    'pharmacy_stock_movements',
    'pharmacy_stock_transfers',
    'pharmacy_damaged_stock',
    'pharmacy_stock_counts',
    'pharmacy_inventory_snapshots'
  ]
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'branch_id'
    ) INTO has_branch;

    branch_guard := CASE
      WHEN has_branch THEN ' AND public.has_branch_access(pharmacy_id, branch_id)'
      ELSE ''
    END;

    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:create''))%s)',
      tbl,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:update''))%s) WITH CHECK ((public.user_has_permission(pharmacy_id, ''inventory:write'') OR public.user_has_permission(pharmacy_id, ''inventory:update''))%s)',
      tbl,
      branch_guard,
      branch_guard
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.user_has_permission(pharmacy_id, ''inventory:delete''))',
      tbl
    );
  END LOOP;
END;
$$;
