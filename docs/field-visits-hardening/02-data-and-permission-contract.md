# Data and Permission Contract

- RLS missing for segment enforcement (field_ret vs field_dist).
- The `field_visits` table schema in Supabase migration might lack `sync_status`, `attendance_id`, `person_met`, `follow_up_date`, `segment_type`.
- Attendance is currently not deeply linked to the visit at the DB level, leaving it vulnerable to frontend bypass.
- Private storage bucket policies are unknown or non-existent for the selfie images. Storage must enforce `user_id` directory structure.
