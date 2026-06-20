BEGIN;

-- ============================================================================
-- P0: canonical columns required by purchases, returns, damaged stock and import
-- ============================================================================
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS import_request_id TEXT;

ALTER TABLE public.pharmacy_purchases
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_purchase_lines
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS batch_number TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.pharmacy_sales_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.pharmacy_sales_return_lines
  ADD COLUMN IF NOT EXISTS sale_line_id UUID REFERENCES public.pharmacy_sale_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.pharmacy_purchase_returns
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.pharmacy_purchase_return_lines
  ADD COLUMN IF NOT EXISTS purchase_line_id UUID REFERENCES public.pharmacy_purchase_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.pharmacy_item_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.pharmacy_damaged_stock
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS batch_allocations JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_import_request
  ON public.pharmacy_items(pharmacy_id, import_request_id)
  WHERE import_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_client_request
  ON public.pharmacy_purchases(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_client_request
  ON public.pharmacy_sales_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_returns_client_request
  ON public.pharmacy_purchase_returns(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_damaged_stock_client_request
  ON public.pharmacy_damaged_stock(pharmacy_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase_created
  ON public.pharmacy_purchase_lines(pharmacy_id, purchase_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_batch
  ON public.pharmacy_purchase_lines(pharmacy_id, batch_id)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_sale_line
  ON public.pharmacy_sales_return_lines(pharmacy_id, sale_line_id)
  WHERE sale_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_purchase_line
  ON public.pharmacy_purchase_return_lines(pharmacy_id, purchase_line_id)
  WHERE purchase_line_id IS NOT NULL;

-- ============================================================================
-- P0: one permission matrix on the database matching src/lib/auth/permissions.ts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_pharmacy_id UUID,
  p_permission TEXT,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL OR p_permission = '' THEN RETURN false; END IF;
  IF public.is_developer(p_user_id) THEN RETURN true; END IF;
  IF public.permission_is_system_only(p_permission) THEN RETURN false; END IF;
  IF public.permission_denied_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN RETURN false; END IF;

  v_role := public.user_pharmacy_role(p_pharmacy_id, p_user_id);
  IF v_role = 'owner' THEN RETURN true; END IF;
  IF public.permission_in_profile(p_pharmacy_id, p_permission, p_user_id) THEN RETURN true; END IF;

  IF v_role = 'admin' THEN
    RETURN p_permission IN (
      'pharmacy:read','pharmacy:write',
      'branches:read','branches:write','branches:delete',
      'users:read','users:write','users:delete','auth:audit.read',
      'sales:read','sales:write','sales:void','sales:discount','sales:price-override',
      'purchases:read','purchases:write','purchases:void',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:delete','inventory:restore','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','financials:write','reports:read','reports:export','hr:read','hr:write','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:project.write','settings:branches.read','settings:branches.write','settings:tax.read','settings:tax.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:payments.write','settings:contacts.read','settings:contacts.write','settings:invoice.read','settings:invoice.write','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:notification-templates.write','settings:email.read','settings:email.write','settings:sms.read','settings:sms.write','settings:backup.read','settings:shortcuts.read','settings:shortcuts.write','settings:rewards.read','settings:rewards.write','settings:extra-units.read','settings:extra-units.write','settings:custom-labels.read','settings:custom-labels.write',
      'notifications:read','notifications:manage','notifications:templates.write',
      'prescriptions:read','prescriptions:write','delivery:read','delivery:write','loyalty:read','loyalty:write','sync:read','deleted-records:read','deleted-records:restore'
    );
  ELSIF v_role = 'manager' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','branches:write','users:read',
      'sales:read','sales:write','sales:void','sales:discount','purchases:read','purchases:write',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:archive','inventory:stocktake','inventory:opening-stock.write','inventory:transfer.write','inventory:damaged.write','inventory:barcode.print',
      'items:view-cost','items:export','items:print','items:ledger.read','items:price-groups.write',
      'financials:read','reports:read','reports:export','hr:read','crm:read','crm:write',
      'settings:read','settings:write','settings:project.read','settings:branches.read','settings:branches.write','settings:items.read','settings:items.write','settings:sales.read','settings:sales.write','settings:cashier.read','settings:cashier.write','settings:purchases.read','settings:purchases.write','settings:payments.read','settings:contacts.read','settings:invoice.read','settings:barcode.read','settings:barcode.write','settings:printers.read','settings:printers.write','settings:stock-alerts.read','settings:stock-alerts.write','settings:notification-templates.read','settings:shortcuts.read','settings:shortcuts.write','settings:extra-units.read','settings:custom-labels.read',
      'notifications:read','notifications:manage','delivery:read','delivery:write','sync:read'
    );
  ELSIF v_role = 'accountant' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','purchases:read','inventory:read',
      'items:view-cost','items:view-profit','items:export','items:print','items:ledger.read',
      'financials:read','financials:write','reports:read','reports:export','crm:read',
      'settings:read','settings:project.read','settings:tax.read','settings:invoice.read','settings:payments.read','settings:contacts.read','notifications:read'
    );
  ELSIF v_role = 'pharmacist' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','sales:discount','purchases:read',
      'inventory:read','inventory:write','inventory:create','inventory:update','inventory:stocktake','inventory:opening-stock.write','inventory:barcode.print',
      'items:print','items:ledger.read','crm:read','settings:read','settings:items.read','settings:stock-alerts.read','settings:barcode.read','settings:printers.read','notifications:read','prescriptions:read','prescriptions:write'
    );
  ELSIF v_role = 'cashier' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','sales:read','sales:write','inventory:read','crm:read','settings:read','settings:cashier.read','settings:printers.read','notifications:read'
    );
  ELSIF v_role = 'technician' THEN
    RETURN p_permission IN (
      'pharmacy:read','branches:read','inventory:read','inventory:write','inventory:update','inventory:stocktake','inventory:barcode.print','sales:read','notifications:read'
    );
  ELSIF v_role = 'worker' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','inventory:read','sales:read','notifications:read');
  ELSIF v_role = 'viewer' THEN
    RETURN p_permission IN ('pharmacy:read','branches:read','sales:read','purchases:read','inventory:read','reports:read','settings:read','notifications:read');
  END IF;
  RETURN false;
END;
$$;

-- ============================================================================
-- P0: atomic damaged-stock posting with FEFO allocation and idempotency
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_damaged_stock_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_item_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_quantity NUMERIC,
  p_unit TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_item public.pharmacy_items%ROWTYPE;
  v_record public.pharmacy_damaged_stock%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_balance NUMERIC := 0;
  v_remaining NUMERIC := 0;
  v_take NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_allocations JSONB := '[]'::JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 8 THEN RAISE EXCEPTION 'معرف عملية التالف غير صالح'; END IF;
  IF COALESCE(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'كمية التالف يجب أن تكون أكبر من صفر'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:damaged.write', v_actor_id) THEN RAISE EXCEPTION 'ليست لديك صلاحية تسجيل التالف'; END IF;
  IF NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN RAISE EXCEPTION 'ليست لديك صلاحية على هذا الفرع'; END IF;

  -- Serialise retries of the same request before checking the idempotency row.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':' || p_client_request_id, 0));

  SELECT * INTO v_record
  FROM public.pharmacy_damaged_stock
  WHERE pharmacy_id = p_pharmacy_id AND client_request_id = p_client_request_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('record', to_jsonb(v_record), 'duplicate', true);
  END IF;

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = p_item_id AND pharmacy_id = p_pharmacy_id AND status = 'active'
    AND (branch_id IS NULL OR branch_id = p_branch_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود أو غير متاح لهذا الفرع'; END IF;
  IF NOT COALESCE(v_item.manage_inventory, true) THEN RAISE EXCEPTION 'هذا الصنف لا يخضع لإدارة المخزون'; END IF;

  SELECT quantity INTO v_balance
  FROM public.pharmacy_stock_balances
  WHERE pharmacy_id = p_pharmacy_id AND branch_id = p_branch_id AND item_id = p_item_id
  FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  IF v_balance < p_quantity THEN RAISE EXCEPTION 'الرصيد غير كافٍ؛ المتاح %', v_balance; END IF;

  INSERT INTO public.pharmacy_damaged_stock (
    pharmacy_id, branch_id, item_id, quantity, unit, reason, cost_value, notes,
    status, client_request_id, batch_allocations, created_by
  ) VALUES (
    p_pharmacy_id, p_branch_id, p_item_id, p_quantity,
    COALESCE(NULLIF(BTRIM(p_unit), ''), v_item.unit),
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'تالف'), 0,
    NULLIF(BTRIM(p_notes), ''), 'posted', p_client_request_id, '[]'::JSONB, v_actor_id
  ) RETURNING * INTO v_record;

  v_remaining := p_quantity;

  IF p_batch_id IS NOT NULL THEN
    SELECT * INTO v_batch
    FROM public.pharmacy_item_batches
    WHERE id = p_batch_id AND pharmacy_id = p_pharmacy_id AND item_id = p_item_id
      AND branch_id = p_branch_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'التشغيلة المحددة غير موجودة'; END IF;
    IF COALESCE(v_batch.remaining_quantity, 0) < p_quantity THEN RAISE EXCEPTION 'رصيد التشغيلة غير كافٍ'; END IF;

    v_take := p_quantity;
    v_cost := GREATEST(COALESCE(v_batch.cost_price, v_item.buy_price, 0), 0);
    UPDATE public.pharmacy_item_batches
      SET remaining_quantity = remaining_quantity - v_take, updated_at = now()
      WHERE id = v_batch.id;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.id, 'batch_number', v_batch.batch_number,
      'expiry_date', v_batch.expiry_date, 'quantity', v_take, 'unit_cost', v_cost
    ));
    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id,item_id,batch_id,branch_id,direction,quantity,unit_price,total_value,
      movement_type,source_table,source_id,created_by
    ) VALUES (
      p_pharmacy_id,p_item_id,v_batch.id,p_branch_id,'out',v_take,v_cost,round(v_take*v_cost,2),
      'damaged','pharmacy_damaged_stock',v_record.id,v_actor_id
    );
    v_total_cost := v_total_cost + round(v_take * v_cost, 2);
    v_remaining := 0;
  ELSE
    FOR v_batch IN
      SELECT * FROM public.pharmacy_item_batches b
      WHERE b.pharmacy_id = p_pharmacy_id AND b.item_id = p_item_id AND b.branch_id = p_branch_id
        AND b.remaining_quantity > 0
      ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC, b.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_batch.remaining_quantity);
      v_cost := GREATEST(COALESCE(v_batch.cost_price, v_item.buy_price, 0), 0);
      UPDATE public.pharmacy_item_batches
        SET remaining_quantity = remaining_quantity - v_take, updated_at = now()
        WHERE id = v_batch.id;
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch.id, 'batch_number', v_batch.batch_number,
        'expiry_date', v_batch.expiry_date, 'quantity', v_take, 'unit_cost', v_cost
      ));
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id,item_id,batch_id,branch_id,direction,quantity,unit_price,total_value,
        movement_type,source_table,source_id,created_by
      ) VALUES (
        p_pharmacy_id,p_item_id,v_batch.id,p_branch_id,'out',v_take,v_cost,round(v_take*v_cost,2),
        'damaged','pharmacy_damaged_stock',v_record.id,v_actor_id
      );
      v_total_cost := v_total_cost + round(v_take * v_cost, 2);
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 AND (COALESCE(v_item.track_batch, false) OR COALESCE(v_item.has_expiry, false)) THEN
      RAISE EXCEPTION 'أرصدة التشغيلات لا تكفي لتسجيل التالف';
    END IF;

    IF v_remaining > 0 THEN
      v_cost := GREATEST(COALESCE(v_item.buy_price, 0), 0);
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'batch_id', NULL, 'quantity', v_remaining, 'unit_cost', v_cost
      ));
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id,item_id,batch_id,branch_id,direction,quantity,unit_price,total_value,
        movement_type,source_table,source_id,created_by
      ) VALUES (
        p_pharmacy_id,p_item_id,NULL,p_branch_id,'out',v_remaining,v_cost,round(v_remaining*v_cost,2),
        'damaged','pharmacy_damaged_stock',v_record.id,v_actor_id
      );
      v_total_cost := v_total_cost + round(v_remaining * v_cost, 2);
      v_remaining := 0;
    END IF;
  END IF;

  UPDATE public.pharmacy_stock_balances
    SET quantity = quantity - p_quantity, updated_at = now()
    WHERE pharmacy_id = p_pharmacy_id AND branch_id = p_branch_id AND item_id = p_item_id;

  UPDATE public.pharmacy_damaged_stock
    SET cost_value = round(v_total_cost, 2), batch_allocations = v_allocations, updated_at = now()
    WHERE id = v_record.id
    RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'record', to_jsonb(v_record),
    'remaining_stock', v_balance - p_quantity,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_damaged_stock_v1(UUID,UUID,UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_damaged_stock_v1(UUID,UUID,UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT,UUID) TO authenticated, service_role;

-- ============================================================================
-- P1: atomic item import. Every row is a subtransaction; no half-created item.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.import_pharmacy_item_row_v1(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_item JSONB,
  p_barcodes JSONB DEFAULT '[]'::JSONB,
  p_units JSONB DEFAULT '[]'::JSONB,
  p_variants JSONB DEFAULT '[]'::JSONB,
  p_opening_stock JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_item public.pharmacy_items%ROWTYPE;
  v_batch public.pharmacy_item_batches%ROWTYPE;
  v_row JSONB;
  v_name TEXT := BTRIM(COALESCE(p_item->>'name_ar', ''));
  v_sku TEXT := NULLIF(BTRIM(p_item->>'sku'), '');
  v_quantity NUMERIC := GREATEST(COALESCE((p_opening_stock->>'quantity')::NUMERIC, 0), 0);
  v_buy_price NUMERIC := GREATEST(COALESCE((p_item->>'buy_price')::NUMERIC, 0), 0);
  v_manage_inventory BOOLEAN := COALESCE((p_item->>'manage_inventory')::BOOLEAN, true);
  v_track_batch BOOLEAN := COALESCE((p_item->>'track_batch')::BOOLEAN, false);
  v_has_expiry BOOLEAN := COALESCE((p_item->>'has_expiry')::BOOLEAN, false);
  v_expiry_date DATE := NULLIF(COALESCE(p_opening_stock->>'expiry_date', p_item->>'expiry_date'), '')::DATE;
  v_batch_number TEXT := NULLIF(BTRIM(p_opening_stock->>'batch_number'), '');
  v_existing public.pharmacy_items%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:create', v_actor_id) THEN RAISE EXCEPTION 'ليست لديك صلاحية استيراد الأصناف'; END IF;
  IF p_client_request_id IS NULL OR length(BTRIM(p_client_request_id)) < 12 THEN RAISE EXCEPTION 'معرف صف الاستيراد غير صالح'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'اسم الصنف مطلوب'; END IF;
  IF v_sku IS NULL THEN RAISE EXCEPTION 'كود الصنف مطلوب بعد التطبيع'; END IF;

  -- The same deterministic row request can safely be retried after a timeout.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':' || p_client_request_id, 0));

  SELECT * INTO v_existing
  FROM public.pharmacy_items
  WHERE pharmacy_id = p_pharmacy_id AND import_request_id = p_client_request_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('item', to_jsonb(v_existing), 'duplicate', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pharmacy_items
    WHERE pharmacy_id = p_pharmacy_id AND lower(BTRIM(name_ar)) = lower(v_name)
      AND status <> 'deleted'
  ) THEN RAISE EXCEPTION 'يوجد صنف بنفس الاسم'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_items
    WHERE pharmacy_id = p_pharmacy_id AND lower(BTRIM(sku)) = lower(v_sku)
      AND status <> 'deleted'
  ) THEN RAISE EXCEPTION 'كود الصنف مستخدم بالفعل'; END IF;

  IF p_branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id, p_branch_id, v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على فرع الصنف';
  END IF;
  IF v_quantity > 0 AND p_branch_id IS NULL THEN RAISE EXCEPTION 'يجب تحديد فرع للرصيد الافتتاحي'; END IF;

  INSERT INTO public.pharmacy_items (
    pharmacy_id,branch_id,group_id,brand_id,name_ar,name_en,sku,category,unit,item_type,
    manufacturer_name,manufacturer_country,pharmacy_type,generic_name,active_ingredient,
    therapeutic_class,dosage_form,strength,package_size,route_of_administration,
    registration_number,storage_condition,is_controlled,requires_prescription,buy_price,
    sell_price,old_sell_price,manage_inventory,not_for_sale,min_stock,max_stock,opening_stock,
    has_expiry,track_batch,expiry_date,image_url,notes,sub_category,barcode_type,
    expiry_period_value,expiry_period_unit,tax_name,tax_percent,selling_price_tax_type,
    product_type,variation_name,variation_values,variation_skus,purchase_price_including_tax,
    purchase_price_excluding_tax,profit_margin,opening_stock_location,serial_tracking_enabled,
    weight,rack,shelf_row,position,product_description,custom_field_1,custom_field_2,
    custom_field_3,custom_field_4,product_locations,import_metadata,import_request_id,status,created_by
  ) VALUES (
    p_pharmacy_id,p_branch_id,NULLIF(p_item->>'group_id','')::UUID,NULLIF(p_item->>'brand_id','')::UUID,
    v_name,NULLIF(BTRIM(p_item->>'name_en'),''),v_sku,NULLIF(BTRIM(p_item->>'category'),''),
    COALESCE(NULLIF(BTRIM(p_item->>'unit'),''),'وحدة'),COALESCE(NULLIF(p_item->>'item_type',''),'stocked'),
    NULLIF(BTRIM(p_item->>'manufacturer_name'),''),NULLIF(BTRIM(p_item->>'manufacturer_country'),''),
    COALESCE(NULLIF(p_item->>'pharmacy_type',''),'medicine'),NULLIF(BTRIM(p_item->>'generic_name'),''),
    NULLIF(BTRIM(p_item->>'active_ingredient'),''),NULLIF(BTRIM(p_item->>'therapeutic_class'),''),
    NULLIF(BTRIM(p_item->>'dosage_form'),''),NULLIF(BTRIM(p_item->>'strength'),''),
    NULLIF(BTRIM(p_item->>'package_size'),''),NULLIF(BTRIM(p_item->>'route_of_administration'),''),
    NULLIF(BTRIM(p_item->>'registration_number'),''),NULLIF(BTRIM(p_item->>'storage_condition'),''),
    COALESCE((p_item->>'is_controlled')::BOOLEAN,false),COALESCE((p_item->>'requires_prescription')::BOOLEAN,false),
    v_buy_price,GREATEST(COALESCE((p_item->>'sell_price')::NUMERIC,0),0),
    GREATEST(COALESCE((p_item->>'old_sell_price')::NUMERIC,0),0),v_manage_inventory,
    COALESCE((p_item->>'not_for_sale')::BOOLEAN,false),GREATEST(COALESCE((p_item->>'min_stock')::NUMERIC,0),0),
    GREATEST(COALESCE((p_item->>'max_stock')::NUMERIC,0),0),v_quantity,v_has_expiry,v_track_batch,
    NULLIF(p_item->>'expiry_date','')::DATE,NULLIF(BTRIM(p_item->>'image_url'),''),NULLIF(BTRIM(p_item->>'notes'),''),
    NULLIF(BTRIM(p_item->>'sub_category'),''),NULLIF(BTRIM(p_item->>'barcode_type'),''),
    GREATEST(COALESCE((p_item->>'expiry_period_value')::NUMERIC,0),0),NULLIF(p_item->>'expiry_period_unit',''),
    NULLIF(BTRIM(p_item->>'tax_name'),''),GREATEST(COALESCE((p_item->>'tax_percent')::NUMERIC,0),0),
    COALESCE(NULLIF(p_item->>'selling_price_tax_type',''),'exclusive'),COALESCE(NULLIF(p_item->>'product_type',''),'single'),
    NULLIF(BTRIM(p_item->>'variation_name'),''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_item->'variation_values','[]'::JSONB))),ARRAY[]::TEXT[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_item->'variation_skus','[]'::JSONB))),ARRAY[]::TEXT[]),
    GREATEST(COALESCE((p_item->>'purchase_price_including_tax')::NUMERIC,0),0),
    GREATEST(COALESCE((p_item->>'purchase_price_excluding_tax')::NUMERIC,0),0),
    GREATEST(COALESCE((p_item->>'profit_margin')::NUMERIC,0),0),NULLIF(BTRIM(p_item->>'opening_stock_location'),''),
    COALESCE((p_item->>'serial_tracking_enabled')::BOOLEAN,false),GREATEST(COALESCE((p_item->>'weight')::NUMERIC,0),0),
    NULLIF(BTRIM(p_item->>'rack'),''),NULLIF(BTRIM(p_item->>'shelf_row'),''),NULLIF(BTRIM(p_item->>'position'),''),
    NULLIF(BTRIM(p_item->>'product_description'),''),NULLIF(BTRIM(p_item->>'custom_field_1'),''),
    NULLIF(BTRIM(p_item->>'custom_field_2'),''),NULLIF(BTRIM(p_item->>'custom_field_3'),''),
    NULLIF(BTRIM(p_item->>'custom_field_4'),''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_item->'product_locations','[]'::JSONB))),ARRAY[]::TEXT[]),
    COALESCE(p_item->'import_metadata','{}'::JSONB),p_client_request_id,COALESCE(NULLIF(p_item->>'status',''),'active'),v_actor_id
  ) RETURNING * INTO v_item;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_barcodes, '[]'::JSONB)) LOOP
    IF NULLIF(BTRIM(v_row->>'barcode'),'') IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.pharmacy_item_barcodes WHERE pharmacy_id=p_pharmacy_id AND barcode=BTRIM(v_row->>'barcode')) THEN
      RAISE EXCEPTION 'الباركود % مستخدم بالفعل', BTRIM(v_row->>'barcode');
    END IF;
    INSERT INTO public.pharmacy_item_barcodes(pharmacy_id,item_id,barcode,is_primary)
    VALUES(p_pharmacy_id,v_item.id,BTRIM(v_row->>'barcode'),COALESCE((v_row->>'is_primary')::BOOLEAN,false));
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_units, '[]'::JSONB)) LOOP
    IF NULLIF(BTRIM(v_row->>'unit_name'),'') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.pharmacy_item_units(
      pharmacy_id,item_id,unit_name,factor,barcode,sell_price,is_base,main_unit,sub_unit,qty_per_main_unit,unit_raw
    ) VALUES (
      p_pharmacy_id,v_item.id,BTRIM(v_row->>'unit_name'),GREATEST(COALESCE((v_row->>'factor')::NUMERIC,1),0.001),
      NULLIF(BTRIM(v_row->>'barcode'),''),NULLIF(v_row->>'sell_price','')::NUMERIC,
      COALESCE((v_row->>'is_base')::BOOLEAN,false),NULLIF(BTRIM(v_row->>'main_unit'),''),
      NULLIF(BTRIM(v_row->>'sub_unit'),''),NULLIF(v_row->>'qty_per_main_unit','')::NUMERIC,NULLIF(BTRIM(v_row->>'unit_raw'),'')
    );
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_variants, '[]'::JSONB)) LOOP
    IF NULLIF(BTRIM(v_row->>'value'),'') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.pharmacy_item_variants(
      pharmacy_id,item_id,name,value,sku,purchase_price,sell_price,metadata
    ) VALUES (
      p_pharmacy_id,v_item.id,COALESCE(NULLIF(BTRIM(v_row->>'name'),''),'متغير'),BTRIM(v_row->>'value'),
      NULLIF(BTRIM(v_row->>'sku'),''),GREATEST(COALESCE((v_row->>'purchase_price')::NUMERIC,0),0),
      GREATEST(COALESCE((v_row->>'sell_price')::NUMERIC,0),0),COALESCE(v_row->'metadata','{}'::JSONB)
    );
  END LOOP;

  IF v_quantity > 0 AND v_manage_inventory THEN
    IF v_has_expiry AND v_expiry_date IS NULL THEN RAISE EXCEPTION 'تاريخ الصلاحية مطلوب للصنف %', v_name; END IF;
    IF v_track_batch OR v_has_expiry OR v_expiry_date IS NOT NULL OR v_batch_number IS NOT NULL THEN
      INSERT INTO public.pharmacy_item_batches(
        pharmacy_id,item_id,branch_id,batch_number,expiry_date,quantity,remaining_quantity,unit,cost_price,source_type,source_id
      ) VALUES (
        p_pharmacy_id,v_item.id,p_branch_id,COALESCE(v_batch_number,'OPENING-'||substr(v_item.id::TEXT,1,8)),v_expiry_date,
        v_quantity,v_quantity,v_item.unit,v_buy_price,'opening_stock',v_item.id::TEXT
      ) RETURNING * INTO v_batch;
    END IF;

    INSERT INTO public.pharmacy_stock_balances(pharmacy_id,item_id,branch_id,quantity,updated_at)
    VALUES(p_pharmacy_id,v_item.id,p_branch_id,v_quantity,now())
    ON CONFLICT(pharmacy_id,item_id,branch_id)
    DO UPDATE SET quantity=public.pharmacy_stock_balances.quantity+EXCLUDED.quantity,updated_at=now();

    INSERT INTO public.pharmacy_stock_movements(
      pharmacy_id,item_id,batch_id,branch_id,direction,quantity,unit_price,total_value,
      movement_type,source_table,source_id,created_by
    ) VALUES (
      p_pharmacy_id,v_item.id,v_batch.id,p_branch_id,'in',v_quantity,v_buy_price,round(v_quantity*v_buy_price,2),
      'opening_stock','pharmacy_items',v_item.id,v_actor_id
    );
  END IF;

  RETURN jsonb_build_object('item', to_jsonb(v_item), 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_pharmacy_items_batch_v1(
  p_pharmacy_id UUID,
  p_actor_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_row JSONB;
  v_result JSONB;
  v_results JSONB := '[]'::JSONB;
  v_status TEXT;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:create', v_actor_id) THEN RAISE EXCEPTION 'ليست لديك صلاحية استيراد الأصناف'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'بيانات الاستيراد غير صحيحة'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_result := public.import_pharmacy_item_row_v1(
        p_pharmacy_id,
        NULLIF(v_row->>'branch_id','')::UUID,
        v_actor_id,
        v_row->>'client_request_id',
        COALESCE(v_row->'item','{}'::JSONB),
        COALESCE(v_row->'barcodes','[]'::JSONB),
        COALESCE(v_row->'units','[]'::JSONB),
        COALESCE(v_row->'variants','[]'::JSONB),
        COALESCE(v_row->'opening_stock','{}'::JSONB)
      );
      v_status := CASE WHEN COALESCE((v_result->>'duplicate')::BOOLEAN,false) THEN 'skipped' ELSE 'imported' END;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row_num', COALESCE((v_row->>'row_num')::INT,0),
        'sku', v_row->>'sku',
        'name', v_row->>'name',
        'status', v_status,
        'duplicate', COALESCE((v_result->>'duplicate')::BOOLEAN,false),
        'item', v_result->'item'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row_num', COALESCE((v_row->>'row_num')::INT,0),
        'sku', v_row->>'sku',
        'name', v_row->>'name',
        'status', 'error',
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.import_pharmacy_item_row_v1(UUID,UUID,UUID,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_pharmacy_items_batch_v1(UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_pharmacy_items_batch_v1(UUID,UUID,JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
