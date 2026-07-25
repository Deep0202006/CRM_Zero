# Current Data Contract

## Database Schema (`field_visits`)
Based on `021_field_visits_hardening.sql`:
- **Core**: `visit_id`, `lead_id`, `user_id`, `visit_date`, `check_in_time`.
- **Evidence**: `check_in_lat`, `check_in_lng`, `check_in_photo_url`.
- **Details**: `visit_outcome`, `visit_notes`, `person_met`, `segment_type`, `follow_up_date`.
- **Tracking**: `attendance_id`, `sync_status`, `created_at`, `updated_at`.

## RLS Policies
- `is_valid_ist_date(visit_date)` function enforces that inserts only happen for the current India date.
- Insert policy strictly requires `user_id = auth.uid()` and valid IST date.
- Update policy allows users to update their own rows (needed for updating `sync_status`).

## Weaknesses
- **Attendance Linkage**: The application does not strictly validate that the `attendance_id` maps to an active "checked-in" state on the server at the exact time of insertion.
- **Lead Segment Enforcement**: RLS doesn't verify if the `user_id` has the correct capability (`field_ret` vs `field_dist`) for the specific `segment_type` being submitted.
