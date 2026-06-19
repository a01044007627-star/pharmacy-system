-- P2 operational hardening: stock transfers, stock count approval, and sync/audit indexes.

-- 1) Keep transfer status compatible with existing UI/API flows.
ALTER TABLE public.pharmacy_stock_transfers
  DROP CONSTRAINT IF EXISTS pharmacy_stock_transfers_status_check;
ALTER TABLE public.pharmacy_stock_transfers
  ADD CONSTRAINT pharmacy_stock_transfers_status_check
  CHECK (status IN ('draft','pending','completed','cancelled','void','posted'));

CREATE INDEX IF NOT EXISTS idx_stock_transfers_scope_status
  ON public.pharmacy_stock_transfers(pharmacy_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_counts_scope_status
  ON public.pharmacy_stock_counts(pharmacy_id, branch_id, status, created_at DESC);

-- 2) Atomic branch transfer: validates stock in source, moves quantity, writes movements.
CREATE OR REPLACE FUNCTION public.complete_stock_transfer(
  p_pharmacy_id UUID,
  p_transfer_id UUID,
  p_actor_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.pharmacy_stock_transfers%ROWTYPE;
  v_line JSONB;
  v_item public.pharmacy_items%ROWTYPE;
  v_item_id UUID;
  v_qty NUMERIC;
  v_unit TEXT;
  v_remaining NUMERIC;
  v_moved_count INT := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:transfer.write', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد التحويل المخزني';
  END IF;

  SELECT * INTO v_transfer
  FROM public.pharmacy_stock_transfers
  WHERE id = p_transfer_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود';
  END IF;

  IF v_transfer.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'duplicate', true);
  END IF;

  IF v_transfer.status IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ تحويل ملغي';
  END IF;

  IF v_transfer.from_branch_id = v_transfer.to_branch_id THEN
    RAISE EXCEPTION 'فرع المصدر والوجهة متطابقان';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pharmacy_branches b
    WHERE b.pharmacy_id = p_pharmacy_id
      AND b.id IN (v_transfer.from_branch_id, v_transfer.to_branch_id)
    GROUP BY b.pharmacy_id
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'فروع التحويل لا تتبع نفس الصيدلية';
  END IF;

  IF jsonb_typeof(COALESCE(v_transfer.lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_transfer.lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'التحويل لا يحتوي على أصناف';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_transfer.lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::NUMERIC, 0);
    v_unit := NULLIF(BTRIM(COALESCE(v_line->>'unit', '')), '');

    IF v_item_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات أحد أصناف التحويل غير صحيحة';
    END IF;

    SELECT * INTO v_item
    FROM public.pharmacy_items
    WHERE id = v_item_id AND pharmacy_id = p_pharmacy_id AND status <> 'deleted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود داخل التحويل';
    END IF;

    IF COALESCE(v_item.manage_inventory, true) THEN
      UPDATE public.pharmacy_stock_balances
      SET quantity = quantity - v_qty,
          updated_at = now()
      WHERE pharmacy_id = p_pharmacy_id
        AND item_id = v_item_id
        AND branch_id = v_transfer.from_branch_id
        AND quantity >= v_qty
      RETURNING quantity INTO v_remaining;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'كمية غير كافية للصنف: %', v_item.name_ar;
      END IF;

      INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
      VALUES (p_pharmacy_id, v_item_id, v_transfer.to_branch_id, v_qty, now())
      ON CONFLICT (pharmacy_id, item_id, branch_id)
      DO UPDATE SET quantity = public.pharmacy_stock_balances.quantity + EXCLUDED.quantity,
                    updated_at = now();

      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, item_id, batch_id, branch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      ) VALUES
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.from_branch_id, 'out', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_out', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      ),
      (
        p_pharmacy_id, v_item_id, NULL, v_transfer.to_branch_id, 'in', v_qty,
        COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * v_qty,
        'stock_transfer_in', 'pharmacy_stock_transfers', v_transfer.id, v_actor_id
      );

      v_moved_count := v_moved_count + 1;
    END IF;
  END LOOP;

  UPDATE public.pharmacy_stock_transfers
  SET status = 'completed',
      notes = CASE
        WHEN NULLIF(BTRIM(COALESCE(p_notes, '')), '') IS NULL THEN notes
        WHEN NULLIF(BTRIM(COALESCE(notes, '')), '') IS NULL THEN BTRIM(p_notes)
        ELSE notes || E'\n' || BTRIM(p_notes)
      END,
      updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'completed', 'moved_lines', v_moved_count);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_stock_transfer(UUID, UUID, UUID, TEXT) TO authenticated, service_role;

-- 3) Safer stock-count approval: creates balance row when missing and always targets counted quantity logically.
CREATE OR REPLACE FUNCTION public.approve_stock_count_variance(
  p_pharmacy_id UUID,
  p_count_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_actor_id);
  v_count public.pharmacy_stock_counts%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_current_qty NUMERIC := 0;
  v_variance NUMERIC := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.user_has_permission(p_pharmacy_id, 'inventory:stocktake', v_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد الجرد';
  END IF;

  SELECT * INTO v_count
  FROM public.pharmacy_stock_counts
  WHERE id = p_count_id AND pharmacy_id = p_pharmacy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الجرد غير موجود';
  END IF;

  IF v_count.status IN ('approved', 'void') THEN
    RAISE EXCEPTION 'سجل الجرد معتمد أو ملغي مسبقاً';
  END IF;

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND COALESCE(v_item.manage_inventory, true) THEN
    SELECT COALESCE(quantity, 0) INTO v_current_qty
    FROM public.pharmacy_stock_balances
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id
    FOR UPDATE;

    v_current_qty := COALESCE(v_current_qty, 0);
    v_variance := COALESCE(v_count.counted_qty, 0) - v_current_qty;

    INSERT INTO public.pharmacy_stock_balances (pharmacy_id, item_id, branch_id, quantity, updated_at)
    VALUES (p_pharmacy_id, v_count.item_id, v_count.branch_id, GREATEST(COALESCE(v_count.counted_qty, 0), 0), now())
    ON CONFLICT (pharmacy_id, item_id, branch_id)
    DO UPDATE SET quantity = GREATEST(COALESCE(v_count.counted_qty, 0), 0), updated_at = now();

    IF v_variance != 0 THEN
      INSERT INTO public.pharmacy_stock_movements (
        pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
        unit_price, total_value, movement_type, source_table, source_id, created_by
      )
      VALUES (
        p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
        CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
        ABS(v_variance), COALESCE(v_item.buy_price, 0), COALESCE(v_item.buy_price, 0) * ABS(v_variance),
        'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
      );
    END IF;
  ELSE
    v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      expected_qty = COALESCE(v_current_qty, expected_qty),
      variance = v_variance,
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) TO authenticated, service_role;
