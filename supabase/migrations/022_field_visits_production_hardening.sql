-- 022_field_visits_production_hardening.sql
-- Description: Hardens the Field Visits schema with V2 location/media metadata, restricts RLS, and fixes the offline date bug.

-- 1. Add V2 validation columns to field_visits
ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_acquisition_mode text,
  ADD COLUMN IF NOT EXISTS location_quality text,
  ADD COLUMN IF NOT EXISTS selfie_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS selfie_capture_method text,
  ADD COLUMN IF NOT EXISTS selfie_storage_path text;

-- 2. Enforce the canonical outcomes via a NOT VALID CHECK constraint for V2 rows
ALTER TABLE public.field_visits
  ADD CONSTRAINT valid_v2_outcome 
  CHECK (
    (location_accuracy_m IS NULL) OR 
    (visit_outcome IN ('registered', 'installed', 'interested', 'follow_up', 'not_interested'))
  ) NOT VALID;

-- 3. Add foreign key for attendance_id 
-- attendance PK is attendance_id (UUID). Historical data may be missing links.
ALTER TABLE public.field_visits
  ADD CONSTRAINT fk_field_visits_attendance 
  FOREIGN KEY (attendance_id) 
  REFERENCES public.attendance(attendance_id) 
  NOT VALID;

-- 4. Fix the is_valid_ist_date sync blocking issue 
-- Instead of requiring visit_date = current date, we allow visit_date to match the corresponding attendance.date.
-- Since the old policy used is_valid_ist_date directly, we update the INSERT policy to check attendance date too.
DROP POLICY IF EXISTS "Users can insert own field visits" ON public.field_visits;
CREATE POLICY "Users can insert own field visits"
ON public.field_visits FOR INSERT
WITH CHECK (
    user_id = auth.uid() AND
    (
        is_valid_ist_date(visit_date) OR 
        (
            attendance_id IS NOT NULL AND 
            visit_date = (SELECT date FROM public.attendance WHERE attendance_id = field_visits.attendance_id)
        )
    )
);

-- 5. Create public.field_visit_media to hold raw base64 backups if needed by backend operations, offloading the sync queue payload.
CREATE TABLE IF NOT EXISTS public.field_visit_media (
    media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES public.field_visits(visit_id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    media_data text NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.field_visit_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own media"
ON public.field_visit_media FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Only admins need to read this media fallback directly from this table, if at all.
CREATE POLICY "Admins can view media"
ON public.field_visit_media FOR SELECT
USING (public.has_capability('admin'));

-- 6. Restrict the Field Representative RLS policy on field_visits so they can only insert and read their own visits.
-- They must not be able to update visits after sync.
DROP POLICY IF EXISTS "Users can update own field visits" ON public.field_visits;
-- We do not recreate it. Updates are not allowed for field reps.
-- Wait, what if admins need to update it?
CREATE POLICY "Admins can update field visits"
ON public.field_visits FOR UPDATE
USING (public.has_capability('admin'));

-- 7. Include field_visits and field_visit_media in the realtime publication configuration.
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE public.field_visits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.field_visit_media;
