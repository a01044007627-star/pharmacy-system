BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','reopened')),
  closeout_entry_id UUID REFERENCES public.pharmacy_journal_entries(id) ON DELETE SET NULL,
  total_income NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id,period)
);

ALTER TABLE public.pharmacy_accounting_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_periods_select ON public.pharmacy_accounting_periods;
DROP POLICY IF EXISTS accounting_periods_write ON public.pharmacy_accounting_periods;
CREATE POLICY accounting_periods_select ON public.pharmacy_accounting_periods
  FOR SELECT USING (public.has_pharmacy_access(pharmacy_id));
CREATE POLICY accounting_periods_write ON public.pharmacy_accounting_periods
  FOR ALL USING (public.user_has_permission(pharmacy_id,'financials:write'))
  WITH CHECK (public.user_has_permission(pharmacy_id,'financials:write'));

CREATE OR REPLACE FUNCTION public.close_accounting_period_v1(
  p_pharmacy_id UUID,
  p_period TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(),p_actor_id);
  v_start DATE;
  v_end DATE;
  v_period public.pharmacy_accounting_periods%ROWTYPE;
  v_entry UUID;
  v_retained UUID;
  v_income NUMERIC := 0;
  v_expenses NUMERIC := 0;
  v_profit NUMERIC := 0;
  v_line RECORD;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT public.user_has_permission(p_pharmacy_id,'financials:write',v_actor) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية الإقفال الحسابي';
  END IF;
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'الفترة غير صالحة؛ استخدم YYYY-MM';
  END IF;
  v_start := to_date(p_period||'-01','YYYY-MM-DD');
  v_end := (v_start + INTERVAL '1 month - 1 day')::DATE;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::TEXT||':'||p_period||':closeout',0));
  SELECT * INTO v_period FROM public.pharmacy_accounting_periods
  WHERE pharmacy_id=p_pharmacy_id AND period=p_period FOR UPDATE;
  IF FOUND AND v_period.status='closed' AND v_period.closeout_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'duplicate',true,'entry_id',v_period.closeout_entry_id,'period',p_period,
      'total_income',v_period.total_income,'total_expenses',v_period.total_expenses,'net_profit',v_period.net_profit
    );
  END IF;

  PERFORM public.ensure_default_pharmacy_accounts(p_pharmacy_id);
  SELECT id INTO v_retained FROM public.pharmacy_chart_of_accounts
  WHERE pharmacy_id=p_pharmacy_id AND code='3010' AND is_active=true LIMIT 1;
  IF v_retained IS NULL THEN RAISE EXCEPTION 'حساب الأرباح المحتجزة غير موجود'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.type='income' THEN GREATEST(x.credit-x.debit,0) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN a.type='expense' THEN GREATEST(x.debit-x.credit,0) ELSE 0 END),0)
  INTO v_income,v_expenses
  FROM public.pharmacy_chart_of_accounts a
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(l.debit),0) AS debit,COALESCE(SUM(l.credit),0) AS credit
    FROM public.pharmacy_journal_lines l
    JOIN public.pharmacy_journal_entries e ON e.id=l.entry_id AND e.pharmacy_id=l.pharmacy_id
    WHERE l.pharmacy_id=p_pharmacy_id AND l.account_id=a.id
      AND e.entry_date BETWEEN v_start AND v_end
      AND COALESCE(e.source_table,'')<>'pharmacy_accounting_closeout'
  ) x ON true
  WHERE a.pharmacy_id=p_pharmacy_id AND a.is_active=true AND a.type IN ('income','expense');

  v_income:=round(v_income,2);
  v_expenses:=round(v_expenses,2);
  v_profit:=round(v_income-v_expenses,2);
  IF v_income=0 AND v_expenses=0 THEN RAISE EXCEPTION 'لا توجد حركات إيرادات أو مصروفات لإقفالها في هذه الفترة'; END IF;

  INSERT INTO public.pharmacy_journal_entries(
    pharmacy_id,entry_number,entry_date,reference,description,source_table,total_debit,total_credit,created_by
  ) VALUES(
    p_pharmacy_id,'CLS-'||replace(p_period,'-',''),v_end,p_period,'إقفال حسابي للفترة '||p_period,
    'pharmacy_accounting_closeout',0,0,v_actor
  ) RETURNING id INTO v_entry;
  UPDATE public.pharmacy_journal_entries SET source_id=v_entry WHERE id=v_entry;

  FOR v_line IN
    SELECT a.id,a.name,a.type,
      CASE WHEN a.type='income' THEN GREATEST(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit-l.debit ELSE 0 END),0),0)
           ELSE GREATEST(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0),0) END AS amount
    FROM public.pharmacy_chart_of_accounts a
    LEFT JOIN public.pharmacy_journal_lines l ON l.account_id=a.id AND l.pharmacy_id=a.pharmacy_id
    LEFT JOIN public.pharmacy_journal_entries e ON e.id=l.entry_id AND e.pharmacy_id=l.pharmacy_id
      AND e.entry_date BETWEEN v_start AND v_end AND COALESCE(e.source_table,'')<>'pharmacy_accounting_closeout'
    WHERE a.pharmacy_id=p_pharmacy_id AND a.is_active=true AND a.type IN ('income','expense')
    GROUP BY a.id,a.name,a.type
  LOOP
    IF round(COALESCE(v_line.amount,0),2)<=0 THEN CONTINUE; END IF;
    IF v_line.type='income' THEN
      INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
      VALUES(p_pharmacy_id,v_entry,v_line.id,round(v_line.amount,2),0,'إقفال إيراد: '||v_line.name);
      v_debit:=v_debit+round(v_line.amount,2);
    ELSE
      INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
      VALUES(p_pharmacy_id,v_entry,v_line.id,0,round(v_line.amount,2),'إقفال مصروف: '||v_line.name);
      v_credit:=v_credit+round(v_line.amount,2);
    END IF;
  END LOOP;

  IF v_profit>0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES(p_pharmacy_id,v_entry,v_retained,0,v_profit,'تحويل صافي الربح إلى حقوق الملكية');
    v_credit:=v_credit+v_profit;
  ELSIF v_profit<0 THEN
    INSERT INTO public.pharmacy_journal_lines(pharmacy_id,entry_id,account_id,debit,credit,description)
    VALUES(p_pharmacy_id,v_entry,v_retained,ABS(v_profit),0,'تحميل صافي الخسارة على حقوق الملكية');
    v_debit:=v_debit+ABS(v_profit);
  END IF;

  IF round(v_debit,2)<>round(v_credit,2) THEN
    RAISE EXCEPTION 'قيد الإقفال غير متوازن: المدين % والدائن %',v_debit,v_credit;
  END IF;
  UPDATE public.pharmacy_journal_entries SET total_debit=v_debit,total_credit=v_credit,updated_at=now() WHERE id=v_entry;

  INSERT INTO public.pharmacy_accounting_periods(
    pharmacy_id,period,start_date,end_date,status,closeout_entry_id,total_income,total_expenses,net_profit,closed_by,closed_at
  ) VALUES(
    p_pharmacy_id,p_period,v_start,v_end,'closed',v_entry,v_income,v_expenses,v_profit,v_actor,now()
  ) ON CONFLICT(pharmacy_id,period) DO UPDATE SET
    start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,status='closed',closeout_entry_id=EXCLUDED.closeout_entry_id,
    total_income=EXCLUDED.total_income,total_expenses=EXCLUDED.total_expenses,net_profit=EXCLUDED.net_profit,
    closed_by=EXCLUDED.closed_by,closed_at=EXCLUDED.closed_at,updated_at=now()
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'duplicate',false,'entry_id',v_entry,'entry_number','CLS-'||replace(p_period,'-',''),
    'period',p_period,'total_income',v_income,'total_expenses',v_expenses,'net_profit',v_profit,
    'total_debit',v_debit,'total_credit',v_credit,'lines_count',(SELECT COUNT(*) FROM public.pharmacy_journal_lines WHERE entry_id=v_entry)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_accounting_period_v1(UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_accounting_period_v1(UUID,TEXT,UUID) TO authenticated,service_role;

COMMIT;
