BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES public.pharmacy_partners(id) ON DELETE SET NULL,
  code TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  gender TEXT CHECK(gender IN ('male','female')),
  date_of_birth DATE,
  age INTEGER,
  id_number TEXT,
  blood_type TEXT CHECK(blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  allergies JSONB DEFAULT '[]'::jsonb,
  chronic_diseases JSONB DEFAULT '[]'::jsonb,
  current_medications JSONB DEFAULT '[]'::jsonb,
  medical_history TEXT,
  surgical_history TEXT,
  family_history TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  insurance_company TEXT,
  insurance_policy_number TEXT,
  insurance_expiry_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
  visit_count INTEGER NOT NULL DEFAULT 0,
  total_purchases NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_visit_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(pharmacy_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_patients_pharmacy_id ON public.pharmacy_patients(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_patients_pharmacy_id_name ON public.pharmacy_patients(pharmacy_id, name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_patients_pharmacy_id_phone ON public.pharmacy_patients(pharmacy_id, phone);
CREATE INDEX IF NOT EXISTS idx_pharmacy_patients_pharmacy_id_status ON public.pharmacy_patients(pharmacy_id, status);

CREATE TRIGGER trg_pharmacy_patients_updated_at
  BEFORE UPDATE ON public.pharmacy_patients
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
