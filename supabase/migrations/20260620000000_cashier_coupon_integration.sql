-- Add coupon tracking to sales
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.pharmacy_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- index for reporting
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_coupon
  ON public.pharmacy_sales(coupon_id)
  WHERE coupon_id IS NOT NULL;
