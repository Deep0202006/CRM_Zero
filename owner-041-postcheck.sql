-- owner-041-postcheck.sql
-- Read-only SQL Editor postcheck. Historical NULL pincodes are valid.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_visits'
      AND column_name = 'pincode' AND data_type = 'text' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'field_visits.pincode must exist as nullable text';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mapping_requests'
      AND column_name IN ('distributor_lead_id', 'retailer_lead_id') AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'mapping lead references must allow standalone free-text rows';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mapping_requests'
      AND column_name IN ('distributor_name_unregistered', 'retailer_name_unregistered')
      AND data_type = 'text' AND is_nullable = 'YES'
  ) <> 2 THEN
    RAISE EXCEPTION 'mapping free-text columns are missing or incompatible';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN ('public.field_visits'::regclass, 'public.mapping_requests'::regclass)
      AND conname IN (
        'field_visits_pincode_bounded',
        'mapping_requests_distributor_value_required',
        'mapping_requests_retailer_value_required'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'owner-041 safety constraints are incomplete';
  END IF;
END
$$;

SELECT
  (SELECT count(*) FROM public.field_visits) AS field_visit_rows_after,
  (SELECT count(*) FROM public.field_visits WHERE pincode IS NULL) AS historical_null_pincodes,
  (SELECT count(*) FROM public.mapping_requests) AS mapping_rows_after;
