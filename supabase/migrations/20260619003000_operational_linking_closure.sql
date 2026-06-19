-- Close remaining operational links without rewriting or dropping previous data.

CREATE TABLE IF NOT EXISTS public.pharmacy_partner_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.pharmacy_branches(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  partner_name TEXT,
  channel TEXT NOT NULL DEFAULT 'note' CHECK (channel IN ('email','whatsapp','phone','sms','note')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft','sent','read','completed','failed')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_communications_scope
  ON public.pharmacy_partner_communications(pharmacy_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_communications_partner
  ON public.pharmacy_partner_communications(pharmacy_id, partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_communications_status
  ON public.pharmacy_partner_communications(pharmacy_id, status, channel, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_pharmacy_partner_communications_updated_at ON public.pharmacy_partner_communications;
CREATE TRIGGER trg_pharmacy_partner_communications_updated_at
BEFORE UPDATE ON public.pharmacy_partner_communications
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pharmacy_partner_communications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_communications_select ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_insert ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_update ON public.pharmacy_partner_communications;
DROP POLICY IF EXISTS partner_communications_delete ON public.pharmacy_partner_communications;
CREATE POLICY partner_communications_select ON public.pharmacy_partner_communications
  FOR SELECT TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:read', auth.uid()));
CREATE POLICY partner_communications_insert ON public.pharmacy_partner_communications
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));
CREATE POLICY partner_communications_update ON public.pharmacy_partner_communications
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()))
  WITH CHECK (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));
CREATE POLICY partner_communications_delete ON public.pharmacy_partner_communications
  FOR DELETE TO authenticated
  USING (public.user_has_permission(pharmacy_id, 'crm:write', auth.uid()));

-- Separate read and write permissions at the application layer while preserving
-- compatibility with existing installations and custom role data.
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
