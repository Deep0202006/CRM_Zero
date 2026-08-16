-- owner-044-precheck.sql
-- Read-only SQL Editor precheck. No production rows are mutated.

SELECT
  to_regclass('public.field_visits') IS NOT NULL AS field_visits_exists,
  to_regclass('public.mapping_requests') IS NOT NULL AS mapping_requests_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_visits' AND column_name = 'pincode'
  ) AS pincode_already_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mapping_requests' AND column_name = 'distributor_name_unregistered'
  ) AS mapping_free_text_already_exists,
  (SELECT count(*) FROM public.field_visits) AS field_visit_rows_before,
  (SELECT count(*) FROM public.mapping_requests) AS mapping_rows_before;
