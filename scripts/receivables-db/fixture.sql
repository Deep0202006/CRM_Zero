\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
create table public.users (
  user_id uuid primary key,
  name text not null,
  email text not null unique,
  is_active boolean not null default true
);
create table public.user_capabilities (
  user_id uuid not null references public.users(user_id) on delete restrict,
  capability_code text not null,
  primary key(user_id,capability_code)
);
grant select on public.users,public.user_capabilities to authenticated,service_role;
grant all on public.users,public.user_capabilities to service_role;

