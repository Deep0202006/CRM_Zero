-- Receivables production completion: assignment authority hardening.
-- Additive only. Apply once after 033 through the Supabase migration mechanism.

create or replace function public.receivables_enforce_operational_assignee_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.user_id = new.assigned_to and u.is_active = true
  ) or exists (
    select 1 from public.user_capabilities c
    where c.user_id = new.assigned_to and c.capability_code = 'admin'
  ) then
    raise exception 'INVALID_ASSIGNEE'
      using errcode = 'ZD001', hint = 'Assign an active non-Admin operational employee.';
  end if;
  return new;
end;
$$;

revoke all on function public.receivables_enforce_operational_assignee_v1() from public, anon, authenticated;

create trigger receivables_operational_assignee_guard_v1
before insert or update of assigned_to on public.receivables
for each row execute function public.receivables_enforce_operational_assignee_v1();
