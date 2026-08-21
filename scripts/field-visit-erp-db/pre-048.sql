do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.user_capabilities (user_id uuid not null references public.users(user_id), capability_code text not null, primary key(user_id,capability_code));
alter table public.users add column is_active boolean not null default true;
insert into public.users values
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');
insert into public.user_capabilities values
  ('00000000-0000-4000-8000-000000000001','field_ret'),
  ('00000000-0000-4000-8000-000000000002','field_dist'),
  ('00000000-0000-4000-8000-000000000003','erp_partner_viewer');
create or replace function public.erp_normalized_key_v1(p_value text) returns text language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p_value,'')), '\s+', ' ', 'g')) $$;
create table public.erp_systems (erp_id uuid primary key, erp_name text not null, erp_key text not null unique, created_by uuid not null references public.users(user_id));
alter table public.field_visits add column pincode text null;
-- Sentinel authorities: Migration 048 and its confirmation boundary must not write here.
create table public.distributor_accounts (distributor_id uuid primary key, erp_id uuid null);
create table public.pipeline_entries (pipeline_id uuid primary key);
create table public.call_logs (log_id uuid primary key);
create table public.receivables (receivable_id uuid primary key);
create table public.receivable_payments (payment_id uuid primary key);
insert into public.distributor_accounts values ('00000000-0000-4000-8000-000000000030', null);
insert into public.pipeline_entries values ('00000000-0000-4000-8000-000000000031');
insert into public.call_logs values ('00000000-0000-4000-8000-000000000032');
insert into public.receivables values ('00000000-0000-4000-8000-000000000033');
insert into public.receivable_payments values ('00000000-0000-4000-8000-000000000034');
grant usage on schema public to service_role;
