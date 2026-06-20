BEGIN;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS developer_notes TEXT;

ALTER TABLE public.pharmacies
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

UPDATE public.pharmacies
SET trial_ends_at = created_at + interval '14 days'
WHERE plan = 'trial' AND trial_ends_at IS NULL;

ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_plan_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_plan_check
  CHECK (plan IN ('trial', 'starter', 'professional', 'enterprise'));

ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_limits_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_limits_check
  CHECK (max_branches > 0 AND max_users > 0);

CREATE INDEX IF NOT EXISTS idx_pharmacies_platform_lifecycle
  ON public.pharmacies(status, plan, subscription_ends_at, trial_ends_at);

COMMIT;
