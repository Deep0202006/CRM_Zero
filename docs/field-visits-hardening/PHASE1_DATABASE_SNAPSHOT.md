# Database Snapshot (Schema-Only)

Based on migration files `021_field_visits_hardening.sql` and `FINAL_CONSOLIDATED_MIGRATION.sql`.

## `field_visits` Definition
**Columns:**
- `visit_id` (UUID, PK, default gen_random_uuid())
- `lead_id` (TEXT, NOT NULL)
- `user_id` (UUID, NOT NULL, REFERENCES public.users(user_id) ON DELETE CASCADE)
- `visit_date` (DATE, NOT NULL)
- `check_in_time` (TIMESTAMPTZ, NOT NULL)
- `check_in_lat` (DOUBLE PRECISION)
- `check_in_lng` (DOUBLE PRECISION)
- `check_in_photo_url` (TEXT)
- `visit_outcome` (TEXT, NOT NULL)
- `visit_notes` (TEXT)
- `attendance_id` (UUID)
- `person_met` (TEXT)
- `segment_type` (TEXT)
- `follow_up_date` (DATE)
- `sync_status` (TEXT, DEFAULT 'pending_sync')
- `created_at` (TIMESTAMPTZ, DEFAULT now(), NOT NULL)
- `updated_at` (TIMESTAMPTZ, DEFAULT now(), NOT NULL)

**Constraints:**
- Primary Key on `visit_id`.
- Foreign Key on `user_id` to `public.users`.

**Indexes:**
- `idx_field_visits_sync_status` on `sync_status`.

**Triggers:**
- Trigger Name: `trg_field_visits_updated_at`
- Timing: `BEFORE UPDATE`
- Event: `ON public.field_visits`
- Function: `update_field_visits_updated_at()`

**RLS Policies:**
- Policy Name: `"Users can insert own field visits"`
  - Command: `FOR INSERT`
  - Role: `public`
  - USING: N/A
  - WITH CHECK: `(user_id = auth.uid() AND is_valid_ist_date(visit_date))`
- Policy Name: `"Users can update own field visits"`
  - Command: `FOR UPDATE`
  - Role: `public`
  - USING: `(user_id = auth.uid())`
  - WITH CHECK: `(user_id = auth.uid())`

## `attendance` Definition
**Relevant Columns:**
- `id` (UUID, PK)
- `user_id` (UUID)
- `date` (DATE)
- `clock_in_time` (TIMESTAMPTZ)
- `clock_out_time` (TIMESTAMPTZ)

## Storage Definition
**Bucket Configuration:**
- Bucket ID: `'visits-evidence'`
- Name: `'visits-evidence'`
- Public: `false`

**Storage Policies (`storage.objects`):**
- Policy Name: `"Users can upload visit evidence"`
  - Command: `FOR INSERT`
  - Role: `authenticated`
  - USING: N/A
  - WITH CHECK: `(bucket_id = 'visits-evidence' AND (storage.foldername(name))[1] = auth.uid()::text)`
- Policy Name: `"Users can view own visit evidence"`
  - Command: `FOR SELECT`
  - Role: `authenticated`
  - USING: `(bucket_id = 'visits-evidence' AND (storage.foldername(name))[1] = auth.uid()::text)`
  - WITH CHECK: N/A
- Policy Name: `"Admins can view all visit evidence"`
  - Command: `FOR SELECT`
  - Role: `authenticated`
  - USING: `(bucket_id = 'visits-evidence' AND EXISTS (SELECT 1 FROM public.user_capabilities uc WHERE uc.user_id = auth.uid() AND uc.capability_code = 'admin'))`
  - WITH CHECK: N/A
