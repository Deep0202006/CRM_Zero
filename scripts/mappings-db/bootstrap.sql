\set ON_ERROR_STOP on
drop schema if exists auth cascade;
drop schema if exists public cascade;
create schema auth;
create schema public;
create extension if not exists pgcrypto;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.users (user_id uuid primary key, name text not null, is_active boolean default true);
create table public.user_capabilities (user_id uuid not null references public.users(user_id) on delete cascade, capability_code text not null);
create function public.has_capability(p_code text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select exists(select 1 from public.user_capabilities where user_id=auth.uid() and capability_code=p_code) $$;
create table public.mapping_requests (
  request_id uuid primary key, distributor_lead_id text, retailer_lead_id text,
  distributor_name_unregistered text, retailer_name_unregistered text,
  requested_by uuid references public.users(user_id) on delete set null,
  mapped_by uuid references public.users(user_id) on delete set null,
  status text not null default 'Pending', notes text, created_at timestamptz not null default timezone('utc',now()), completed_at timestamptz
);
alter table public.mapping_requests enable row level security;
create role anon; create role authenticated;
grant usage on schema public, auth to anon, authenticated;
grant select,insert,update,delete on public.mapping_requests to authenticated;
grant select on public.users, public.user_capabilities to authenticated;
insert into public.users(user_id,name) values
 ('10000000-0000-4000-8000-000000000001','Employee A'),
 ('10000000-0000-4000-8000-000000000002','Employee B'),
 ('10000000-0000-4000-8000-000000000003','Admin'),
 ('10000000-0000-4000-8000-000000000004','Unrelated');
insert into public.user_capabilities values
 ('10000000-0000-4000-8000-000000000001','ret_support'),
 ('10000000-0000-4000-8000-000000000002','ret_support'),
 ('10000000-0000-4000-8000-000000000003','admin');
insert into public.mapping_requests(request_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,mapped_by,status,notes,created_at,completed_at) values
 ('20000000-0000-4000-8000-000000000001','Historic Distributor','Historic Retailer','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Completed','historic',timezone('utc',now())-interval '1 day',timezone('utc',now())-interval '1 hour');
