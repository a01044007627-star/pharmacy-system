-- Tasks table, items import, and stock count approval RPC

-- 0. Add approval columns to stock counts
ALTER TABLE public.pharmacy_stock_counts
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- 1. Pharmacy Tasks table
CREATE TABLE IF NOT EXISTS public.pharmacy_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tasks_pharmacy ON public.pharmacy_tasks(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON public.pharmacy_tasks(pharmacy_id, completed);

-- Use the same tenant-isolation pattern as other tables: has_pharmacy_access
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

-- 2. Items import logs reference
ALTER TABLE public.pharmacy_import_logs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '[]'::jsonb;

-- 3. Stock count approval RPC
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
  v_variance NUMERIC;
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

  v_variance := COALESCE(v_count.counted_qty, 0) - COALESCE(v_count.expected_qty, 0);

  SELECT * INTO v_item
  FROM public.pharmacy_items
  WHERE id = v_count.item_id AND pharmacy_id = p_pharmacy_id;

  IF FOUND AND v_item.manage_inventory AND v_variance != 0 THEN
    UPDATE public.pharmacy_stock_balances
    SET quantity = GREATEST(COALESCE(quantity, 0) + v_variance, 0),
        updated_at = now()
    WHERE pharmacy_id = p_pharmacy_id
      AND branch_id = v_count.branch_id
      AND item_id = v_count.item_id;

    INSERT INTO public.pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id, direction, quantity,
      unit_price, total_value, movement_type, source_table, source_id, created_by
    )
    VALUES (
      p_pharmacy_id, v_count.branch_id, v_count.item_id, NULL,
      CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END,
      ABS(v_variance), 0, 0,
      'stock_count_adjustment', 'pharmacy_stock_counts', v_count.id, v_actor_id
    );
  END IF;

  UPDATE public.pharmacy_stock_counts
  SET status = 'approved',
      approved_at = now(),
      approved_by = v_actor_id,
      approval_notes = NULLIF(BTRIM(p_notes), ''),
      variance = v_variance,
      updated_at = now()
  WHERE id = p_count_id;

  RETURN jsonb_build_object('ok', true, 'count_id', p_count_id, 'variance', v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count_variance(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;
