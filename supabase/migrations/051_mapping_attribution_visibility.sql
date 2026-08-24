-- OWNER-MANUAL ONLY: do not apply from Codex/CI.
alter table public.mapping_requests add column if not exists requested_by_name_snapshot text null;
alter table public.mapping_requests add column if not exists mapped_by_name_snapshot text null;

update public.mapping_requests r set requested_by_name_snapshot = u.name
from public.users u where r.requested_by = u.user_id and r.requested_by_name_snapshot is null;
update public.mapping_requests r set mapped_by_name_snapshot = u.name
from public.users u where r.mapped_by = u.user_id and r.mapped_by_name_snapshot is null;

alter table public.mapping_requests drop constraint if exists mapping_requests_completed_attribution_check;
alter table public.mapping_requests add constraint mapping_requests_completed_attribution_check check (status <> 'Completed' or (mapped_by is not null and completed_at is not null));

create or replace function public.mapping_request_attribution_guard_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid := auth.uid(); actor_name text;
begin
  if actor is null then raise exception 'mapping authentication required'; end if;
  select name into actor_name from public.users where user_id = actor;
  if tg_op = 'INSERT' then
    if new.status <> 'Pending' then raise exception 'mapping requests must start Pending'; end if;
    new.requested_by := actor; new.mapped_by := null; new.completed_at := null; new.requested_by_name_snapshot := actor_name; new.mapped_by_name_snapshot := null;
  elsif old.status <> 'Pending' or new.status <> 'Completed' or new.requested_by is distinct from old.requested_by or new.request_id is distinct from old.request_id or new.created_at is distinct from old.created_at or new.distributor_lead_id is distinct from old.distributor_lead_id or new.retailer_lead_id is distinct from old.retailer_lead_id or new.distributor_name_unregistered is distinct from old.distributor_name_unregistered or new.retailer_name_unregistered is distinct from old.retailer_name_unregistered then
    raise exception 'mapping completion is immutable';
  else
    new.mapped_by := actor; new.mapped_by_name_snapshot := actor_name;
    if new.completed_at is null then new.completed_at := timezone('utc', now()); end if;
    if new.completed_at < old.created_at then raise exception 'mapping completion precedes creation'; end if;
  end if;
  return new;
end $$;

drop trigger if exists mapping_request_attribution_guard_v1 on public.mapping_requests;
create trigger mapping_request_attribution_guard_v1 before insert or update on public.mapping_requests for each row execute function public.mapping_request_attribution_guard_v1();

drop policy if exists "Mapping requests insert" on public.mapping_requests;
drop policy if exists "Mapping requests strict isolation select" on public.mapping_requests;
drop policy if exists "Mapping requests strict isolation update" on public.mapping_requests;
drop policy if exists mapping_requests_access on public.mapping_requests;
create policy mapping_requests_team_select on public.mapping_requests for select to authenticated using (public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin'));
create policy mapping_requests_team_insert on public.mapping_requests for insert to authenticated with check ((public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin')) and status = 'Pending' and mapped_by is null and completed_at is null and requested_by = auth.uid());
create policy mapping_requests_team_complete on public.mapping_requests for update to authenticated using ((public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin')) and status = 'Pending') with check ((public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin')) and status = 'Completed' and mapped_by = auth.uid() and completed_at is not null);
