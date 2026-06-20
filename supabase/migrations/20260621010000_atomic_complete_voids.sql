BEGIN;

CREATE OR REPLACE FUNCTION public.void_sale_complete_v1(
  p_pharmacy_id UUID,p_sale_id UUID,p_actor_id UUID DEFAULT NULL,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_operation JSONB;
  v_finalization JSONB;
BEGIN
  v_operation:=public.void_cashier_sale(p_pharmacy_id,p_sale_id,p_actor_id,p_reason);
  v_finalization:=public.finalize_sale_void_v1(p_pharmacy_id,p_sale_id,p_actor_id,p_reason);
  RETURN jsonb_build_object('operation',COALESCE(v_operation,'{}'::JSONB),'finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.void_purchase_complete_v1(
  p_pharmacy_id UUID,p_purchase_id UUID,p_actor_id UUID DEFAULT NULL,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_operation JSONB;
  v_finalization JSONB;
BEGIN
  v_operation:=public.void_received_purchase(p_pharmacy_id,p_purchase_id,p_actor_id,p_reason);
  v_finalization:=public.finalize_purchase_void_v1(p_pharmacy_id,p_purchase_id,p_actor_id,p_reason);
  RETURN jsonb_build_object('operation',COALESCE(v_operation,'{}'::JSONB),'finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.void_purchase_return_complete_v1(
  p_pharmacy_id UUID,p_return_id UUID,p_actor_id UUID DEFAULT NULL,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_operation JSONB;
  v_finalization JSONB;
BEGIN
  v_operation:=public.void_purchase_return(p_pharmacy_id,p_return_id,p_actor_id,p_reason);
  v_finalization:=public.finalize_purchase_return_void_v1(p_pharmacy_id,p_return_id,p_actor_id);
  RETURN jsonb_build_object('operation',COALESCE(v_operation,'{}'::JSONB),'finalization',COALESCE(v_finalization,'{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale_complete_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_purchase_complete_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_purchase_return_complete_v1(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_sale_complete_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase_complete_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_complete_v1(UUID,UUID,UUID,TEXT) TO authenticated,service_role;

COMMIT;
