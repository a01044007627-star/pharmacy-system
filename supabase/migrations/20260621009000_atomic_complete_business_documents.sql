BEGIN;

CREATE OR REPLACE FUNCTION public.create_cashier_sale_complete_v1(
  p_pharmacy_id UUID,p_branch_id UUID,p_shift_id UUID,p_actor_id UUID,p_client_request_id TEXT,
  p_customer_name TEXT,p_payment_method TEXT,p_paid_amount NUMERIC,p_invoice_discount NUMERIC,
  p_tax_total NUMERIC,p_shipping_fee NUMERIC,p_rounding_adj NUMERIC,p_notes TEXT,
  p_coupon_code TEXT DEFAULT NULL,p_patient_name TEXT DEFAULT NULL,p_doctor_name TEXT DEFAULT NULL,
  p_prescription_number TEXT DEFAULT NULL,p_lines JSONB DEFAULT NULL,p_patient_id UUID DEFAULT NULL,p_partner_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_ledger JSONB;
  v_sale_id UUID;
  v_due NUMERIC:=0;
  v_invoice TEXT;
BEGIN
  v_result:=public.create_cashier_sale_v2(
    p_pharmacy_id,p_branch_id,p_shift_id,p_actor_id,p_client_request_id,p_customer_name,p_payment_method,
    p_paid_amount,p_invoice_discount,p_tax_total,p_shipping_fee,p_rounding_adj,p_notes,p_coupon_code,
    p_patient_name,p_doctor_name,p_prescription_number,p_lines
  );
  v_sale_id:=NULLIF(v_result->'sale'->>'id','')::UUID;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء فاتورة البيع'; END IF;
  v_finalization:=public.finalize_sale_operations_v1(p_pharmacy_id,v_sale_id,p_patient_id,p_partner_id,p_actor_id);
  v_due:=GREATEST(COALESCE((v_result->'sale'->>'due_amount')::NUMERIC,0),0);
  v_invoice:=COALESCE(v_result->'sale'->>'invoice_number','');
  IF p_partner_id IS NOT NULL AND v_due>0 THEN
    v_ledger:=public.record_partner_balance_entry_v1(
      p_pharmacy_id,p_branch_id,p_partner_id,'pharmacy_sales',v_sale_id,'charge',v_due,
      'مديونية فاتورة البيع '||v_invoice,p_actor_id,true
    );
    v_finalization:=COALESCE(v_finalization,'{}'::JSONB)||jsonb_build_object('partner_ledger',v_ledger);
  END IF;
  RETURN v_result||jsonb_build_object('finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_received_purchase_complete_v1(
  p_pharmacy_id UUID,p_branch_id UUID,p_actor_id UUID,p_client_request_id TEXT,p_supplier_id UUID,
  p_supplier_name TEXT,p_payment_method TEXT,p_paid_amount NUMERIC,p_header_discount NUMERIC,p_tax_total NUMERIC,
  p_shipping_fee NUMERIC,p_notes TEXT,p_purchase_date TIMESTAMPTZ,p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_ledger JSONB;
  v_purchase_id UUID;
  v_journal UUID;
  v_due NUMERIC:=0;
  v_number TEXT;
BEGIN
  v_result:=public.create_received_purchase(
    p_pharmacy_id,p_branch_id,p_actor_id,p_client_request_id,p_supplier_id,p_supplier_name,p_payment_method,
    p_paid_amount,p_header_discount,p_tax_total,p_shipping_fee,p_notes,p_purchase_date,p_lines
  );
  v_purchase_id:=NULLIF(v_result->'purchase'->>'id','')::UUID;
  IF v_purchase_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء فاتورة الشراء'; END IF;
  v_journal:=public.post_purchase_accounting_v1(p_pharmacy_id,v_purchase_id,p_actor_id);
  v_due:=GREATEST(COALESCE((v_result->'purchase'->>'due_amount')::NUMERIC,0),0);
  v_number:=COALESCE(v_result->'purchase'->>'purchase_number','');
  IF p_supplier_id IS NOT NULL AND v_due>0 THEN
    -- The purchase RPC already updates the supplier balance, therefore this
    -- records the immutable ledger row without applying the balance twice.
    v_ledger:=public.record_partner_balance_entry_v1(
      p_pharmacy_id,p_branch_id,p_supplier_id,'pharmacy_purchases',v_purchase_id,'charge',v_due,
      'مديونية فاتورة الشراء '||v_number,p_actor_id,false
    );
  END IF;
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'partner_ledger',v_ledger);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sales_return_complete_v1(
  p_pharmacy_id UUID,p_sale_id UUID,p_actor_id UUID,p_client_request_id TEXT,p_reason TEXT,p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_return_id UUID;
  v_journal UUID;
BEGIN
  v_result:=public.create_sales_return(p_pharmacy_id,p_sale_id,p_actor_id,p_client_request_id,p_reason,p_lines);
  v_return_id:=NULLIF(v_result->'return'->>'id','')::UUID;
  IF v_return_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء مرتجع المبيعات'; END IF;
  v_journal:=public.post_sales_return_accounting_v1(p_pharmacy_id,v_return_id,p_actor_id);
  v_finalization:=public.finalize_sales_return_partner_v1(p_pharmacy_id,v_return_id,p_actor_id);
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'operational_finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_return_complete_v1(
  p_pharmacy_id UUID,p_purchase_id UUID,p_actor_id UUID,p_client_request_id TEXT,
  p_stock_mode TEXT DEFAULT 'restock',p_reason TEXT DEFAULT NULL,p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_result JSONB;
  v_finalization JSONB;
  v_return_id UUID;
  v_journal UUID;
BEGIN
  v_result:=public.create_purchase_return(p_pharmacy_id,p_purchase_id,p_actor_id,p_client_request_id,p_stock_mode,p_reason,p_lines);
  v_return_id:=NULLIF(v_result->'return'->>'id','')::UUID;
  IF v_return_id IS NULL THEN RAISE EXCEPTION 'لم يتم إنشاء مرتجع المشتريات'; END IF;
  v_finalization:=public.finalize_purchase_return_partner_v1(p_pharmacy_id,v_return_id,p_actor_id);
  v_journal:=public.post_purchase_return_accounting_v1(p_pharmacy_id,v_return_id,p_actor_id);
  RETURN v_result||jsonb_build_object('journal_entry_id',v_journal,'operational_finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashier_sale_complete_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_received_purchase_complete_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_sales_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_purchase_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cashier_sale_complete_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,UUID,UUID) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_received_purchase_complete_v1(UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TIMESTAMPTZ,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,JSONB) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_complete_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB) TO authenticated,service_role;

COMMIT;
