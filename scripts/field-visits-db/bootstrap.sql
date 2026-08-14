create schema if not exists public;
create table public.users (user_id uuid primary key);
create table public.attendance (
  attendance_id uuid primary key, user_id uuid not null references public.users(user_id), date date not null,
  clock_in timestamptz not null, clock_out timestamptz, selfie_url text, latitude double precision, longitude double precision,
  constraint unique_user_attendance_date unique(user_id,date)
);
create table public.field_visits (
  visit_id uuid primary key, lead_id text not null, user_id uuid not null references public.users(user_id), visit_date date not null,
  check_in_time timestamptz not null, check_in_lat double precision, check_in_lng double precision, check_in_photo_url text,
  visit_outcome text not null, visit_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  attendance_id uuid, person_met text, segment_type text, follow_up_date date, sync_status text, local_photo_blob text,
  location_accuracy_m numeric, location_captured_at timestamptz, location_acquisition_mode text, location_quality text,
  selfie_captured_at timestamptz, selfie_capture_method text, selfie_storage_path text
);
alter table public.field_visits add constraint valid_v2_outcome check (visit_outcome in ('registered','installed','interested','follow_up','not_interested')) not valid;
insert into public.users values ('00000000-0000-4000-8000-000000000001');
insert into public.attendance(attendance_id,user_id,date,clock_in,selfie_url) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','2026-08-01','2026-08-01T04:00:00Z','data:image/jpeg;base64,LEGACY');
insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type) values ('00000000-0000-4000-8000-000000000020','legacy','00000000-0000-4000-8000-000000000001','2026-08-01','2026-08-01T04:30:00Z','interested','Retailer');
