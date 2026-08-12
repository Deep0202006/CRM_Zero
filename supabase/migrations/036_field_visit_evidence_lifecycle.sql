-- 036_field_visit_evidence_lifecycle.sql
-- OWNER-APPLIED ONLY. Additive lifecycle/address contract; no business rows are deleted or rewritten.

alter table public.field_visits drop constraint if exists valid_field_visit_selfie_purge_state;
alter table public.field_visits
  add column if not exists address text,
  add column if not exists address_contract_version smallint,
  add column if not exists selfie_uploaded_at timestamptz,
  add column if not exists selfie_purged_at timestamptz,
  add column if not exists selfie_purge_state text,
  add column if not exists selfie_purge_started_at timestamptz;

alter table public.attendance drop constraint if exists valid_attendance_selfie_purge_state;
alter table public.attendance
  add column if not exists selfie_captured boolean,
  add column if not exists selfie_storage_path text,
  add column if not exists selfie_uploaded_at timestamptz,
  add column if not exists selfie_purged_at timestamptz,
  add column if not exists selfie_purge_state text,
  add column if not exists selfie_purge_started_at timestamptz;

alter table public.field_visits
  add constraint valid_field_visit_selfie_purge_state
  check (selfie_purge_state is null or selfie_purge_state in ('available', 'purge_pending', 'purged')) not valid;
alter table public.attendance
  add constraint valid_attendance_selfie_purge_state
  check (selfie_purge_state is null or selfie_purge_state in ('available', 'purge_pending', 'purged')) not valid;

alter table public.field_visits drop constraint if exists valid_v2_outcome;
alter table public.field_visits
  add constraint valid_field_visit_outcome
  check (
    visit_outcome in ('registered', 'installed', 'interested', 'follow_up', 'payment_follow_up', 'not_interested')
    or (segment_type = 'Distributor' and visit_outcome = 'payment_done')
  ) not valid;

alter table public.field_visits
  add constraint valid_field_visit_address_version
  check (
    address_contract_version is null
    or (address_contract_version = 1 and address is not null and length(btrim(address)) between 1 and 500)
  ) not valid;

create index if not exists idx_field_visits_admin_created
  on public.field_visits (created_at desc, visit_id desc);
create index if not exists idx_field_visits_admin_user_created
  on public.field_visits (user_id, created_at desc, visit_id desc);
create index if not exists idx_field_visits_admin_segment_created
  on public.field_visits (segment_type, created_at desc, visit_id desc);
create index if not exists idx_field_visits_selfie_retention
  on public.field_visits (selfie_uploaded_at, visit_id)
  where selfie_storage_path is not null and selfie_purged_at is null;
create index if not exists idx_attendance_selfie_retention
  on public.attendance (selfie_uploaded_at, attendance_id)
  where selfie_storage_path is not null and selfie_purged_at is null;

comment on column public.field_visits.address is 'Human-readable visit address. NULL means legacy visit: address not captured.';
comment on column public.field_visits.selfie_uploaded_at is 'Successful private Storage upload time; starts five-day evidence retention.';
comment on column public.field_visits.selfie_purged_at is 'Storage object purge confirmation time; business row remains permanent.';
comment on column public.attendance.selfie_storage_path is 'Exact private visits-evidence object key for future attendance evidence.';
comment on column public.attendance.selfie_purged_at is 'Storage object purge confirmation time; attendance row remains permanent.';
