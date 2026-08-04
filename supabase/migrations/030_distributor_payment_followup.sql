-- Allow the canonical Distributor payment follow-up outcome for new V2 visits.
-- Existing rows are not rewritten or revalidated by this migration.
ALTER TABLE public.field_visits
  DROP CONSTRAINT IF EXISTS valid_v2_outcome;

ALTER TABLE public.field_visits
  ADD CONSTRAINT valid_v2_outcome
  CHECK (
    (location_accuracy_m IS NULL OR
      visit_outcome IN ('registered', 'installed', 'interested', 'follow_up', 'payment_follow_up', 'not_interested'))
    AND
    (visit_outcome <> 'payment_follow_up' OR
      (segment_type = 'Distributor' AND follow_up_date IS NOT NULL))
  ) NOT VALID;
