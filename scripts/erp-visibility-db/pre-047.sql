\set ON_ERROR_STOP on

create table if not exists public.capabilities (
  code text primary key,
  label text not null
);
grant select on public.capabilities to authenticated,service_role;
grant all on public.capabilities to service_role;
