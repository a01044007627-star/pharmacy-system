BEGIN;

-- Pharmacy-only catalogue data. All columns are additive to preserve existing client data.
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS pharmacy_type TEXT,
  ADD COLUMN IF NOT EXISTS generic_name TEXT,
  ADD COLUMN IF NOT EXISTS active_ingredient TEXT,
  ADD COLUMN IF NOT EXISTS therapeutic_class TEXT,
  ADD COLUMN IF NOT EXISTS dosage_form TEXT,
  ADD COLUMN IF NOT EXISTS strength TEXT,
  ADD COLUMN IF NOT EXISTS package_size TEXT,
  ADD COLUMN IF NOT EXISTS route_of_administration TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_country TEXT,
  ADD COLUMN IF NOT EXISTS storage_condition TEXT;

UPDATE public.pharmacy_items
SET pharmacy_type = CASE
  WHEN NULLIF(trim(pharmacy_type), '') IS NOT NULL THEN pharmacy_type
  WHEN COALESCE(item_type, '') = 'service' THEN 'other'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مستلزم|شاش|قطن|سرنج|قسطرة|medical[[:space:]]*supply)' THEN 'medical_supply'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(مكمل|فيتامين|vitamin|supplement)' THEN 'supplement'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(تجميل|بشرة|ميك[[:space:]]*اب|cosmetic|makeup)' THEN 'cosmetic'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(شامبو|معجون|غسول|عناية[[:space:]]*شخصية|personal[[:space:]]*care)' THEN 'personal_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(طفل|بيبي|حفاض|baby)' THEN 'baby_care'
  WHEN concat_ws(' ', name_ar, name_en, category, sub_category) ~* '(جهاز|ترمومتر|ميزان|نيبولايزر|device)' THEN 'device'
  ELSE 'medicine'
END
WHERE NULLIF(trim(pharmacy_type), '') IS NULL;

UPDATE public.pharmacy_items
SET pharmacy_type = 'other'
WHERE pharmacy_type NOT IN (
  'medicine', 'medical_supply', 'supplement', 'cosmetic',
  'personal_care', 'baby_care', 'device', 'other'
);

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET DEFAULT 'medicine';

ALTER TABLE public.pharmacy_items
  ALTER COLUMN pharmacy_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_items_pharmacy_type_check'
  ) THEN
    ALTER TABLE public.pharmacy_items
      ADD CONSTRAINT pharmacy_items_pharmacy_type_check
      CHECK (pharmacy_type IN (
        'medicine', 'medical_supply', 'supplement', 'cosmetic',
        'personal_care', 'baby_care', 'device', 'other'
      )) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_pharmacy_type
  ON public.pharmacy_items(pharmacy_id, pharmacy_type, status, name_ar, id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_active_ingredient_trgm
  ON public.pharmacy_items USING gin(active_ingredient gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_generic_name_trgm
  ON public.pharmacy_items USING gin(generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_dosage_form
  ON public.pharmacy_items(pharmacy_id, dosage_form)
  WHERE dosage_form IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_registration_number
  ON public.pharmacy_items(pharmacy_id, registration_number)
  WHERE NULLIF(trim(registration_number), '') IS NOT NULL;

-- Keep the full pharmaceutical identity searchable, including relation barcodes and units.
CREATE OR REPLACE FUNCTION public.rebuild_item_search_text(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pharmacy_items i
  SET search_text = lower(concat_ws(' ',
        i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
        i.category, i.sub_category, i.pharmacy_type, i.generic_name,
        i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
        i.package_size, i.route_of_administration, i.registration_number,
        (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
        (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
      )),
      updated_at = CASE WHEN i.updated_at IS NULL THEN now() ELSE i.updated_at END
  WHERE i.id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_item_search_from_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_text := lower(concat_ws(' ',
    NEW.name_ar, NEW.name_en, NEW.sku, NEW.manufacturer_name, NEW.manufacturer_country,
    NEW.category, NEW.sub_category, NEW.pharmacy_type, NEW.generic_name,
    NEW.active_ingredient, NEW.therapeutic_class, NEW.dosage_form, NEW.strength,
    NEW.package_size, NEW.route_of_administration, NEW.registration_number
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_search_from_item ON public.pharmacy_items;
CREATE TRIGGER trg_sync_item_search_from_item
BEFORE INSERT OR UPDATE OF
  name_ar, name_en, sku, manufacturer_name, manufacturer_country,
  category, sub_category, pharmacy_type, generic_name, active_ingredient,
  therapeutic_class, dosage_form, strength, package_size,
  route_of_administration, registration_number
ON public.pharmacy_items
FOR EACH ROW EXECUTE FUNCTION public.sync_item_search_from_item();

UPDATE public.pharmacy_items i
SET search_text = lower(concat_ws(' ',
  i.name_ar, i.name_en, i.sku, i.manufacturer_name, i.manufacturer_country,
  i.category, i.sub_category, i.pharmacy_type, i.generic_name,
  i.active_ingredient, i.therapeutic_class, i.dosage_form, i.strength,
  i.package_size, i.route_of_administration, i.registration_number,
  (SELECT string_agg(b.barcode, ' ') FROM public.pharmacy_item_barcodes b WHERE b.item_id = i.id),
  (SELECT string_agg(concat_ws(' ', u.unit_name, u.barcode), ' ') FROM public.pharmacy_item_units u WHERE u.item_id = i.id)
));

CREATE OR REPLACE FUNCTION public.pharmacy_item_filter_options(
  p_pharmacy_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_mode TEXT DEFAULT 'active'
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'manufacturers', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.manufacturer_name) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.manufacturer_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'activeIngredients', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.active_ingredient) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.active_ingredient), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'dosageForms', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.dosage_form) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.dosage_form), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'pharmacyTypes', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.pharmacy_type) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.pharmacy_type), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(i.unit) AS v
        FROM public.pharmacy_items i
        WHERE i.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(i.unit), '') IS NOT NULL
      ) q
    ), '[]'::jsonb),
    'subUnits', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT trim(u.unit_name) AS v
        FROM public.pharmacy_item_units u
        JOIN public.pharmacy_items i ON i.id = u.item_id AND i.pharmacy_id = u.pharmacy_id
        WHERE u.pharmacy_id = p_pharmacy_id
          AND (p_branch_id IS NULL OR i.branch_id IS NULL OR i.branch_id = p_branch_id)
          AND CASE WHEN p_mode = 'deleted' THEN i.status = 'deleted' ELSE i.status <> 'deleted' END
          AND NULLIF(trim(u.unit_name), '') IS NOT NULL
      ) q
    ), '[]'::jsonb)
  )
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_item_filter_options(UUID, UUID, TEXT)
  TO authenticated, service_role;

COMMIT;
