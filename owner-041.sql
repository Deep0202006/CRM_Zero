-- 041_field_visit_pincode.sql
-- Additive Field Visit pincode authority and standalone Mapping display values.

ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS pincode text NULL;

ALTER TABLE public.mapping_requests
  ADD COLUMN IF NOT EXISTS distributor_name_unregistered text NULL,
  ADD COLUMN IF NOT EXISTS retailer_name_unregistered text NULL,
  ALTER COLUMN distributor_lead_id DROP NOT NULL,
  ALTER COLUMN retailer_lead_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.field_visits'::regclass
      AND conname = 'field_visits_pincode_bounded'
  ) THEN
    ALTER TABLE public.field_visits
      ADD CONSTRAINT field_visits_pincode_bounded
      CHECK (pincode IS NULL OR (length(btrim(pincode)) BETWEEN 1 AND 32)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.mapping_requests'::regclass
      AND conname = 'mapping_requests_distributor_value_required'
  ) THEN
    ALTER TABLE public.mapping_requests
      ADD CONSTRAINT mapping_requests_distributor_value_required
      CHECK (
        distributor_lead_id IS NOT NULL
        OR (
          distributor_name_unregistered IS NOT NULL
          AND length(btrim(distributor_name_unregistered)) BETWEEN 1 AND 250
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.mapping_requests'::regclass
      AND conname = 'mapping_requests_retailer_value_required'
  ) THEN
    ALTER TABLE public.mapping_requests
      ADD CONSTRAINT mapping_requests_retailer_value_required
      CHECK (
        retailer_lead_id IS NOT NULL
        OR (
          retailer_name_unregistered IS NOT NULL
          AND length(btrim(retailer_name_unregistered)) BETWEEN 1 AND 250
        )
      ) NOT VALID;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
