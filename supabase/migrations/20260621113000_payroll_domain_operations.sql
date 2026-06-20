-- Professional payroll domain: durable runs, line calculations, workflow,
-- idempotent generation and atomic accounting payment.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  period TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  run_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  client_request_id TEXT NOT NULL,
  total_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_additions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, run_number),
  UNIQUE(pharmacy_id, client_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_payroll_active_period
  ON public.pharmacy_payroll_runs(pharmacy_id, period)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_runs_period
  ON public.pharmacy_payroll_runs(pharmacy_id, period DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_runs_status
  ON public.pharmacy_payroll_runs(pharmacy_id, status, period DESC);

ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_period_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_period_check
  CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_dates_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_dates_check
  CHECK (period_start <= period_end);
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_status_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_status_check
  CHECK (status IN ('draft','approved','paid','cancelled'));
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_payment_method_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','card','wallet','bank-transfer'));
ALTER TABLE public.pharmacy_payroll_runs DROP CONSTRAINT IF EXISTS pharmacy_payroll_runs_totals_check;
ALTER TABLE public.pharmacy_payroll_runs ADD CONSTRAINT pharmacy_payroll_runs_totals_check
  CHECK (
    total_base >= 0 AND total_additions >= 0 AND total_deductions >= 0
    AND total_gross >= 0 AND total_net >= 0
    AND total_net <= total_gross
  );

CREATE TABLE IF NOT EXISTS public.pharmacy_payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.pharmacy_payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.pharmacy_employees(id) ON DELETE RESTRICT,
  employee_name TEXT NOT NULL,
  position TEXT,
  salary_type TEXT NOT NULL,
  salary_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  payable_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  paid_leave_days INTEGER NOT NULL DEFAULT 0,
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
  worked_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  regular_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  additions NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  calculation_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_lines_employee
  ON public.pharmacy_payroll_lines(pharmacy_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payroll_lines_run
  ON public.pharmacy_payroll_lines(run_id, employee_name);

ALTER TABLE public.pharmacy_payroll_lines DROP CONSTRAINT IF EXISTS pharmacy_payroll_lines_salary_type_check;
ALTER TABLE public.pharmacy_payroll_lines ADD CONSTRAINT pharmacy_payroll_lines_salary_type_check
  CHECK (salary_type IN ('monthly','weekly','daily','hourly'));
ALTER TABLE public.pharmacy_payroll_lines DROP CONSTRAINT IF EXISTS pharmacy_payroll_lines_values_check;
ALTER TABLE public.pharmacy_payroll_lines ADD CONSTRAINT pharmacy_payroll_lines_values_check
  CHECK (
    salary_rate >= 0 AND scheduled_days >= 0 AND payable_days >= 0
    AND absent_days >= 0 AND paid_leave_days >= 0 AND unpaid_leave_days >= 0
    AND worked_hours >= 0 AND regular_pay >= 0 AND additions >= 0
    AND deductions >= 0 AND gross_salary >= 0 AND net_salary >= 0
    AND deductions <= gross_salary AND net_salary = round(gross_salary - deductions, 2)
  );

DROP TRIGGER IF EXISTS trg_pharmacy_payroll_runs_updated_at ON public.pharmacy_payroll_runs;
CREATE TRIGGER trg_pharmacy_payroll_runs_updated_at
BEFORE UPDATE ON public.pharmacy_payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_pharmacy_payroll_lines_updated_at ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_pharmacy_payroll_lines_updated_at
BEFORE UPDATE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_transition_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('approved','cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid','cancelled'))
  ) THEN
    RAISE EXCEPTION 'الانتقال من حالة كشف الرواتب % إلى % غير مسموح', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payroll_run_transition ON public.pharmacy_payroll_runs;
CREATE TRIGGER trg_enforce_payroll_run_transition
BEFORE UPDATE OF status ON public.pharmacy_payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_run_transition_v1();

CREATE OR REPLACE FUNCTION public.assert_payroll_line_editable_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_status TEXT;
BEGIN
  v_run_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  SELECT status INTO v_status FROM public.pharmacy_payroll_runs WHERE id = v_run_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل بنود كشف الرواتب بعد اعتماده';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_payroll_line_editable ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_assert_payroll_line_editable
BEFORE INSERT OR UPDATE OR DELETE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.assert_payroll_line_editable_v1();

CREATE OR REPLACE FUNCTION public.refresh_payroll_run_totals_v1(p_run_id UUID)
RETURNS public.pharmacy_payroll_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
BEGIN
  UPDATE public.pharmacy_payroll_runs AS runs
  SET total_base = totals.total_base,
      total_additions = totals.total_additions,
      total_deductions = totals.total_deductions,
      total_gross = totals.total_gross,
      total_net = totals.total_net,
      updated_at = now()
  FROM (
    SELECT
      COALESCE(sum(regular_pay),0)::NUMERIC(14,2) AS total_base,
      COALESCE(sum(additions),0)::NUMERIC(14,2) AS total_additions,
      COALESCE(sum(deductions),0)::NUMERIC(14,2) AS total_deductions,
      COALESCE(sum(gross_salary),0)::NUMERIC(14,2) AS total_gross,
      COALESCE(sum(net_salary),0)::NUMERIC(14,2) AS total_net
    FROM public.pharmacy_payroll_lines
    WHERE run_id = p_run_id
  ) totals
  WHERE runs.id = p_run_id
  RETURNING runs.* INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_payroll_totals_after_line_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  v_run_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  PERFORM public.refresh_payroll_run_totals_v1(v_run_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_payroll_totals_after_line ON public.pharmacy_payroll_lines;
CREATE TRIGGER trg_refresh_payroll_totals_after_line
AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.refresh_payroll_totals_after_line_v1();

CREATE OR REPLACE FUNCTION public.create_payroll_run_v1(
  p_pharmacy_id UUID,
  p_period TEXT,
  p_actor_id UUID,
  p_client_request_id TEXT,
  p_notes TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_start DATE;
  v_end DATE;
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_line JSONB;
  v_employee public.pharmacy_employees%ROWTYPE;
  v_count INTEGER := 0;
  v_regular NUMERIC(14,2);
  v_additions NUMERIC(14,2);
  v_deductions NUMERIC(14,2);
  v_gross NUMERIC(14,2);
  v_net NUMERIC(14,2);
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية إنشاء كشف الرواتب';
  END IF;
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'فترة الرواتب غير صالحة';
  END IF;
  IF COALESCE(NULLIF(btrim(p_client_request_id),''),'') = '' THEN
    RAISE EXCEPTION 'معرف طلب إنشاء كشف الرواتب مطلوب';
  END IF;
  IF jsonb_typeof(COALESCE(p_lines,'[]'::JSONB)) <> 'array' OR jsonb_array_length(COALESCE(p_lines,'[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'لا توجد بنود لإنشاء كشف الرواتب';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT || ':payroll:' || p_period, 0));

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE pharmacy_id = p_pharmacy_id AND client_request_id = p_client_request_id
  LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',true); END IF;

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE pharmacy_id = p_pharmacy_id AND period = p_period AND status <> 'cancelled'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',true); END IF;

  v_start := to_date(p_period || '-01','YYYY-MM-DD');
  v_end := (v_start + INTERVAL '1 month - 1 day')::DATE;

  INSERT INTO public.pharmacy_payroll_runs(
    pharmacy_id, period, period_start, period_end, run_number, status,
    client_request_id, notes, created_by
  ) VALUES (
    p_pharmacy_id, p_period, v_start, v_end,
    'PAY-' || replace(p_period,'-','') || '-' || upper(substr(md5(p_client_request_id),1,6)),
    'draft', p_client_request_id, NULLIF(btrim(p_notes),''), p_actor_id
  ) RETURNING * INTO v_run;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_employee FROM public.pharmacy_employees
    WHERE id = NULLIF(v_line->>'employee_id','')::UUID
      AND pharmacy_id = p_pharmacy_id
      AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط'; END IF;

    v_regular := round(GREATEST(COALESCE((v_line->>'regular_pay')::NUMERIC,0),0),2);
    v_additions := round(GREATEST(COALESCE((v_line->>'additions')::NUMERIC,0),0),2);
    v_gross := round(v_regular + v_additions,2);
    v_deductions := round(LEAST(GREATEST(COALESCE((v_line->>'deductions')::NUMERIC,0),0),v_gross),2);
    v_net := round(GREATEST(v_gross - v_deductions,0),2);

    INSERT INTO public.pharmacy_payroll_lines(
      pharmacy_id, run_id, employee_id, employee_name, position, salary_type, salary_rate,
      scheduled_days, payable_days, absent_days, paid_leave_days, unpaid_leave_days, worked_hours,
      regular_pay, additions, deductions, gross_salary, net_salary, calculation_details
    ) VALUES (
      p_pharmacy_id, v_run.id, v_employee.id,
      COALESCE(NULLIF(v_line->>'employee_name',''),v_employee.name),
      COALESCE(NULLIF(v_line->>'position',''),v_employee.position),
      CASE WHEN v_line->>'salary_type' IN ('monthly','weekly','daily','hourly') THEN v_line->>'salary_type' ELSE COALESCE(v_employee.salary_type,'monthly') END,
      round(GREATEST(COALESCE((v_line->>'salary_rate')::NUMERIC,v_employee.salary,0),0),2),
      GREATEST(COALESCE((v_line->>'scheduled_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'payable_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'absent_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'paid_leave_days')::INTEGER,0),0),
      GREATEST(COALESCE((v_line->>'unpaid_leave_days')::INTEGER,0),0),
      round(GREATEST(COALESCE((v_line->>'worked_hours')::NUMERIC,0),0),2),
      v_regular, v_additions, v_deductions, v_gross, v_net,
      COALESCE(v_line->'calculation_details','{}'::JSONB)
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'تعذر إنشاء بنود كشف الرواتب'; END IF;
  SELECT * INTO v_run FROM public.refresh_payroll_run_totals_v1(v_run.id);
  RETURN jsonb_build_object('run',to_jsonb(v_run),'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payroll_line_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_line_id UUID,
  p_additions NUMERIC,
  p_deductions NUMERIC,
  p_notes TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_line public.pharmacy_payroll_lines%ROWTYPE;
  v_additions NUMERIC(14,2);
  v_gross NUMERIC(14,2);
  v_deductions NUMERIC(14,2);
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية تعديل كشف الرواتب';
  END IF;
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'لا يمكن تعديل كشف رواتب بعد اعتماده'; END IF;

  SELECT * INTO v_line FROM public.pharmacy_payroll_lines
  WHERE id = p_line_id AND run_id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'بند الموظف غير موجود في كشف الرواتب'; END IF;

  v_additions := round(GREATEST(COALESCE(p_additions,0),0),2);
  v_gross := round(v_line.regular_pay + v_additions,2);
  v_deductions := round(LEAST(GREATEST(COALESCE(p_deductions,0),0),v_gross),2);

  UPDATE public.pharmacy_payroll_lines
  SET additions = v_additions,
      deductions = v_deductions,
      gross_salary = v_gross,
      net_salary = round(v_gross - v_deductions,2),
      notes = NULLIF(btrim(p_notes),''),
      updated_at = now()
  WHERE id = v_line.id
  RETURNING * INTO v_line;

  SELECT * INTO v_run FROM public.pharmacy_payroll_runs WHERE id = p_run_id;
  RETURN jsonb_build_object('line',to_jsonb(v_line),'run',to_jsonb(v_run));
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_payroll_run_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_status TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية اعتماد أو إلغاء كشف الرواتب';
  END IF;
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;

  IF p_status = v_run.status THEN RETURN jsonb_build_object('run',to_jsonb(v_run),'unchanged',true); END IF;
  IF p_status = 'approved' THEN
    IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'يمكن اعتماد مسودة كشف الرواتب فقط'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.pharmacy_payroll_lines WHERE run_id = v_run.id) THEN
      RAISE EXCEPTION 'لا يمكن اعتماد كشف رواتب بدون موظفين';
    END IF;
    UPDATE public.pharmacy_payroll_runs
    SET status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now()
    WHERE id=v_run.id RETURNING * INTO v_run;
  ELSIF p_status = 'cancelled' THEN
    IF v_run.status NOT IN ('draft','approved') THEN RAISE EXCEPTION 'لا يمكن إلغاء كشف الرواتب في حالته الحالية'; END IF;
    UPDATE public.pharmacy_payroll_runs
    SET status='cancelled',cancelled_by=p_actor_id,cancelled_at=now(),updated_at=now()
    WHERE id=v_run.id RETURNING * INTO v_run;
  ELSE
    RAISE EXCEPTION 'حالة كشف الرواتب المطلوبة غير صالحة';
  END IF;

  RETURN jsonb_build_object('run',to_jsonb(v_run),'unchanged',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_payroll_run_v1(
  p_pharmacy_id UUID,
  p_run_id UUID,
  p_branch_id UUID,
  p_payment_method TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_run public.pharmacy_payroll_runs%ROWTYPE;
  v_entry_id UUID;
  v_expense_account UUID;
  v_credit_account UUID;
  v_method TEXT;
BEGIN
  IF NOT public.user_has_permission(p_pharmacy_id, 'hr:write', p_actor_id)
     OR NOT public.user_has_permission(p_pharmacy_id, 'financials:write', p_actor_id) THEN
    RAISE EXCEPTION 'صرف الرواتب يحتاج صلاحيات الموارد البشرية والإدارة المالية';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_branches
    WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id
  ) THEN
    RAISE EXCEPTION 'الفرع المحدد غير تابع للصيدلية';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.has_branch_access(p_pharmacy_id,p_branch_id,p_actor_id) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية على الفرع المحدد';
  END IF;
  v_method := CASE WHEN p_payment_method IN ('cash','card','wallet','bank-transfer') THEN p_payment_method ELSE 'cash' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::TEXT || ':payroll-payment',0));
  SELECT * INTO v_run FROM public.pharmacy_payroll_runs
  WHERE id = p_run_id AND pharmacy_id = p_pharmacy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;
  IF v_run.status = 'paid' THEN
    SELECT id INTO v_entry_id FROM public.pharmacy_journal_entries
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs' AND source_id=v_run.id LIMIT 1;
    RETURN jsonb_build_object('run',to_jsonb(v_run),'journal_entry_id',v_entry_id,'duplicate',true);
  END IF;
  IF v_run.status <> 'approved' THEN RAISE EXCEPTION 'يجب اعتماد كشف الرواتب قبل صرفه'; END IF;

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  INSERT INTO public.pharmacy_chart_of_accounts(pharmacy_id,code,name,type,is_active,sort_order)
  VALUES(p_pharmacy_id,'5030','مصروف الرواتب والأجور','expense',true,110)
  ON CONFLICT(pharmacy_id,code) DO UPDATE SET name=EXCLUDED.name,type='expense',is_active=true,updated_at=now();

  SELECT id INTO v_expense_account FROM public.pharmacy_chart_of_accounts
  WHERE pharmacy_id=p_pharmacy_id AND code='5030';
  SELECT id INTO v_credit_account FROM public.pharmacy_chart_of_accounts
  WHERE pharmacy_id=p_pharmacy_id AND code=CASE WHEN v_method IN ('card','wallet','bank-transfer') THEN '1020' ELSE '1010' END;

  SELECT id INTO v_entry_id FROM public.pharmacy_journal_entries
  WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs' AND source_id=v_run.id LIMIT 1;
  IF v_entry_id IS NULL AND v_run.total_net > 0 THEN
    INSERT INTO public.pharmacy_journal_entries(
      pharmacy_id,branch_id,entry_number,entry_date,reference,description,
      source_table,source_id,total_debit,total_credit,created_by
    ) VALUES(
      p_pharmacy_id,p_branch_id,'PAY-'||replace(v_run.id::TEXT,'-',''),CURRENT_DATE,
      v_run.run_number,'صرف رواتب '||v_run.period,
      'pharmacy_payroll_runs',v_run.id,v_run.total_net,v_run.total_net,p_actor_id
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES
      (p_pharmacy_id,v_entry_id,v_expense_account,v_run.total_net,0,'مصروف رواتب '||v_run.period),
      (p_pharmacy_id,v_entry_id,v_credit_account,0,v_run.total_net,'صرف رواتب '||v_run.period);
  END IF;

  IF v_run.total_net > 0 AND NOT EXISTS(
    SELECT 1 FROM public.pharmacy_financial_movements
    WHERE pharmacy_id=p_pharmacy_id AND source_table='pharmacy_payroll_runs'
      AND source_id=v_run.id AND category='payroll_payment'
  ) THEN
    INSERT INTO public.pharmacy_financial_movements(
      pharmacy_id,branch_id,type,category,amount,direction,source_table,source_id,
      description,movement_date,created_by
    ) VALUES(
      p_pharmacy_id,p_branch_id,'payroll','payroll_payment',v_run.total_net,'out',
      'pharmacy_payroll_runs',v_run.id,'صرف رواتب '||v_run.period,now(),p_actor_id
    );
  END IF;

  UPDATE public.pharmacy_payroll_runs
  SET status='paid',branch_id=COALESCE(p_branch_id,branch_id),payment_method=v_method,
      paid_by=p_actor_id,paid_at=now(),updated_at=now()
  WHERE id=v_run.id RETURNING * INTO v_run;

  RETURN jsonb_build_object('run',to_jsonb(v_run),'journal_entry_id',v_entry_id,'duplicate',false);
END;
$$;

ALTER TABLE public.pharmacy_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_payroll_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_runs_select ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_insert ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_update ON public.pharmacy_payroll_runs;
DROP POLICY IF EXISTS payroll_runs_delete ON public.pharmacy_payroll_runs;
CREATE POLICY payroll_runs_select ON public.pharmacy_payroll_runs
FOR SELECT USING (public.user_has_permission(pharmacy_id,'hr:read'));
CREATE POLICY payroll_runs_insert ON public.pharmacy_payroll_runs
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_runs_update ON public.pharmacy_payroll_runs
FOR UPDATE USING (public.user_has_permission(pharmacy_id,'hr:write'))
WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_runs_delete ON public.pharmacy_payroll_runs
FOR DELETE USING (public.is_developer() OR public.user_pharmacy_role(pharmacy_id) IN ('owner','admin'));

DROP POLICY IF EXISTS payroll_lines_select ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_insert ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_update ON public.pharmacy_payroll_lines;
DROP POLICY IF EXISTS payroll_lines_delete ON public.pharmacy_payroll_lines;
CREATE POLICY payroll_lines_select ON public.pharmacy_payroll_lines
FOR SELECT USING (public.user_has_permission(pharmacy_id,'hr:read'));
CREATE POLICY payroll_lines_insert ON public.pharmacy_payroll_lines
FOR INSERT WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_lines_update ON public.pharmacy_payroll_lines
FOR UPDATE USING (public.user_has_permission(pharmacy_id,'hr:write'))
WITH CHECK (public.user_has_permission(pharmacy_id,'hr:write'));
CREATE POLICY payroll_lines_delete ON public.pharmacy_payroll_lines
FOR DELETE USING (public.user_has_permission(pharmacy_id,'hr:write'));

REVOKE ALL ON FUNCTION public.refresh_payroll_run_totals_v1(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payroll_run_v1(UUID,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payroll_line_v1(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_payroll_run_v1(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_payroll_run_v1(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_payroll_run_v1(UUID,TEXT,UUID,TEXT,TEXT,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_payroll_line_v1(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.transition_payroll_run_v1(UUID,UUID,TEXT,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pay_payroll_run_v1(UUID,UUID,UUID,TEXT,UUID) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
