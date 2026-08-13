\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.users(user_id uuid primary key,name text not null,email text not null unique,is_active boolean not null default true);
create table public.user_capabilities(user_id uuid not null references users(user_id),capability_code text not null,primary key(user_id,capability_code));
create table public.leads(lead_id uuid primary key,business_name text not null);
create function public.receivables_is_admin(p_user_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.user_capabilities where user_id=p_user_id and capability_code='admin')$$;
grant usage on schema public,auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;grant select on public.users,public.user_capabilities,public.leads to authenticated,service_role;grant all on public.users,public.user_capabilities,public.leads to service_role;
insert into users values('10000000-0000-4000-a000-000000000001','Admin','admin@example.com',true),('20000000-0000-4000-a000-000000000001','Employee One','one@example.com',true),('20000000-0000-4000-a000-000000000002','Employee Two','two@example.com',true),('20000000-0000-4000-a000-000000000003','Inactive','inactive@example.com',false);
insert into user_capabilities values('10000000-0000-4000-a000-000000000001','admin');
create table protected_writes(domain text primary key,writes bigint not null default 0);
insert into protected_writes(domain) values('leads'),('receivables'),('payments'),('tasks'),('calls'),('field_visits'),('attendance'),('chat'),('pipeline');
grant select on protected_writes to service_role;
