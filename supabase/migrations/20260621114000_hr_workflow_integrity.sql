BEGIN;

ALTER TABLE public.pharmacy_employees
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.pharmacy_employees
SET deactivated_at = COALESCE(updated_at, created_at, now())
WHERE is_active = false AND deactivated_at IS NULL;

INSERT INTO public.pharmacy_settings(pharmacy_id, key, value, description, created_at, updated_at)
SELECT p.id, 'hr.attendanceGraceMinutes', '15', 'فترة السماح الافتراضية لتسجيل الحضور بالدقائق', now(), now()
FROM public.pharmacies p
ON CONFLICT (pharmacy_id, key) DO NOTHING;

-- Normalize legacy values before installing stricter operational rules.
UPDATE public.pharmacy_employees
SET salary = GREATEST(COALESCE(salary, 0), 0),
    salary_type = CASE WHEN salary_type IN ('monthly','weekly','daily','hourly') THEN salary_type ELSE 'monthly' END,
    updated_at = now()
WHERE salary IS NULL OR salary < 0 OR salary_type IS NULL OR salary_type NOT IN ('monthly','weekly','daily','hourly');

UPDATE public.pharmacy_attendance
SET hours_worked = GREATEST(COALESCE(hours_worked, 0), 0),
    updated_at = now()
WHERE hours_worked < 0;

UPDATE public.pharmacy_leave
SET end_date = GREATEST(end_date, start_date),
    days_used = (GREATEST(end_date, start_date) - start_date) + 1,
    updated_at = now()
WHERE end_date < start_date
   OR days_used IS DISTINCT FROM ((end_date - start_date) + 1)
   OR days_used <= 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_employees_salary_nonnegative') THEN
    ALTER TABLE public.pharmacy_employees
      ADD CONSTRAINT pharmacy_employees_salary_nonnegative CHECK (salary >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_attendance_hours_nonnegative') THEN
    ALTER TABLE public.pharmacy_attendance
      ADD CONSTRAINT pharmacy_attendance_hours_nonnegative CHECK (hours_worked IS NULL OR hours_worked >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_leave_valid_period') THEN
    ALTER TABLE public.pharmacy_leave
      ADD CONSTRAINT pharmacy_leave_valid_period CHECK (end_date >= start_date AND days_used = ((end_date - start_date) + 1));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_employee_integrity_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email_changed BOOLEAN;
  v_national_id_changed BOOLEAN;
  v_user_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_email_changed := true;
    v_national_id_changed := true;
    v_user_changed := true;
  ELSE
    v_email_changed := NEW.email IS DISTINCT FROM OLD.email;
    v_national_id_changed := NEW.national_id IS DISTINCT FROM OLD.national_id;
    v_user_changed := NEW.user_id IS DISTINCT FROM OLD.user_id;
  END IF;
  NEW.name := btrim(regexp_replace(COALESCE(NEW.name, ''), '\s+', ' ', 'g'));
  NEW.position := btrim(regexp_replace(COALESCE(NEW.position, ''), '\s+', ' ', 'g'));
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  NEW.national_id := NULLIF(btrim(COALESCE(NEW.national_id, '')), '');
  NEW.salary := GREATEST(COALESCE(NEW.salary, 0), 0);
  NEW.salary_type := CASE WHEN NEW.salary_type IN ('monthly','weekly','daily','hourly') THEN NEW.salary_type ELSE 'monthly' END;
  IF NEW.is_active THEN
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
  ELSIF OLD.is_active THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
  END IF;
  NEW.updated_at := now();

  IF NEW.name = '' THEN RAISE EXCEPTION 'اسم الموظف مطلوب' USING ERRCODE = '23514'; END IF;
  IF NEW.position = '' THEN RAISE EXCEPTION 'الوظيفة مطلوبة' USING ERRCODE = '23514'; END IF;

  IF v_email_changed AND NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND lower(e.email) = NEW.email AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'البريد الإلكتروني مسجل لموظف آخر' USING ERRCODE = '23505';
  END IF;

  IF v_national_id_changed AND NEW.national_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND e.national_id = NEW.national_id AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'الرقم القومي مسجل لموظف آخر' USING ERRCODE = '23505';
  END IF;

  IF v_user_changed AND NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pharmacy_employees e
    WHERE e.pharmacy_id = NEW.pharmacy_id AND e.user_id = NEW.user_id AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'حساب المستخدم مرتبط بموظف آخر' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_integrity_v1 ON public.pharmacy_employees;
CREATE TRIGGER trg_employee_integrity_v1
BEFORE INSERT OR UPDATE ON public.pharmacy_employees
FOR EACH ROW EXECUTE FUNCTION public.enforce_employee_integrity_v1();

CREATE OR REPLACE FUNCTION public.prevent_employee_hard_delete_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Cascading deletion of the parent pharmacy remains possible; direct employee deletion does not.
  IF pg_trigger_depth() <= 1 AND EXISTS (SELECT 1 FROM public.pharmacies p WHERE p.id = OLD.pharmacy_id) THEN
    RAISE EXCEPTION 'لا يمكن حذف الموظف نهائياً؛ استخدم التعطيل للحفاظ على السجل التاريخي' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_employee_hard_delete_v1 ON public.pharmacy_employees;
CREATE TRIGGER trg_prevent_employee_hard_delete_v1
BEFORE DELETE ON public.pharmacy_employees
FOR EACH ROW EXECUTE FUNCTION public.prevent_employee_hard_delete_v1();

CREATE OR REPLACE FUNCTION public.enforce_leave_transition_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved','rejected','cancelled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'انتقال حالة الإجازة غير مسموح: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_transition_v1 ON public.pharmacy_leave;
CREATE TRIGGER trg_leave_transition_v1
BEFORE UPDATE OF status ON public.pharmacy_leave
FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_transition_v1();

CREATE INDEX IF NOT EXISTS idx_pharmacy_employees_active_name
  ON public.pharmacy_employees(pharmacy_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_employees_deactivated_at
  ON public.pharmacy_employees(pharmacy_id, deactivated_at)
  WHERE deactivated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_leave_status_start
  ON public.pharmacy_leave(pharmacy_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_attendance_date_employee
  ON public.pharmacy_attendance(pharmacy_id, date_key DESC, employee_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
