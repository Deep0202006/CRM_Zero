# Data Contract

## field_visits Table
- `visit_id` (UUID, PK)
- `lead_id` (UUID, FK)
- `user_id` (UUID, FK)
- `visit_date` (Date)
- `check_in_time` (Timestamp)
- `check_in_lat` (Float)
- `check_in_lng` (Float)
- `check_in_photo_url` (Text)
- `visit_outcome` (Enum: Interested, Not Interested, Callback, Order Placed)
- `visit_notes` (Text)
- `created_at` (Timestamp)
- `updated_at` (Timestamp)
