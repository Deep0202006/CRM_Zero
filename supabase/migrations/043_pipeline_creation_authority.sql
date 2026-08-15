-- OWNER-APPLIED ONLY. Canonical Pipeline creation authority; no business row is rewritten.
begin;

create table if not exists public.pipeline_create_operations (
  operation_id uuid primary key,
  lead_id uuid not null unique references public.leads(lead_id) on delete restrict,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  request_hash text not null,
  identity_hash text not null,
  origin text not null default 'pipeline_create_lead_v1',
  confirmed_at timestamptz not null default now(),
  constraint pipeline_create_origin_frozen check (origin = 'pipeline_create_lead_v1')
);

alter table public.pipeline_create_operations enable row level security;
revoke all on public.pipeline_create_operations from public, anon, authenticated;
grant select, insert on public.pipeline_create_operations to service_role;

create index if not exists pipeline_create_operations_actor_confirmed_idx
  on public.pipeline_create_operations(actor_id, confirmed_at desc);

create or replace function public.pipeline_normalize_identity_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '', 'g')
$$;

create or replace function public.pipeline_normalize_phone(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select regexp_replace(coalesce(p_value, ''), '[^0-9]+', '', 'g')
$$;

create or replace function public.guard_pipeline_lead_creation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('zerodata.pipeline_create', true), '') <> 'approved' then
    raise exception using errcode = '42501', message = 'Lead creation requires the canonical Pipeline create boundary.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_pipeline_lead_creation on public.leads;
create trigger trg_guard_pipeline_lead_creation
before insert on public.leads
for each row execute function public.guard_pipeline_lead_creation();

drop policy if exists "Owners create own leads" on public.leads;
revoke insert on public.leads from anon, authenticated;

create or replace function public.pipeline_create_lead_v1(
  p_operation_id uuid,
  p_lead_id uuid,
  p_actor_id uuid,
  p_business_name text,
  p_contact_person text,
  p_phone text,
  p_segment_type text,
  p_lead_source text,
  p_area text,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_active boolean;
  v_business text := public.pipeline_normalize_identity_text(p_business_name);
  v_phone text := public.pipeline_normalize_phone(p_phone);
  v_area text := public.pipeline_normalize_identity_text(p_area);
  v_identity_name_phone text;
  v_identity_name_area text;
  v_request_hash text;
  v_first_lock bigint;
  v_second_lock bigint;
  v_operation public.pipeline_create_operations%rowtype;
  v_lead public.leads%rowtype;
  v_owner_name text;
begin
  if p_operation_id is null or p_lead_id is null or p_actor_id is null
     or v_business = '' or btrim(coalesce(p_contact_person, '')) = '' or v_phone = ''
     or p_segment_type not in ('Retailer', 'Distributor')
     or btrim(coalesce(p_lead_source, '')) = '' or p_created_at is null then
    return jsonb_build_object('success', false, 'code', 'PIPELINE_INVALID_CREATE');
  end if;

  v_identity_name_phone := 'name_phone:' || p_segment_type || ':' || v_business || ':' || v_phone;
  v_identity_name_area := 'name_area:' || p_segment_type || ':' || v_business || ':' || v_area;
  v_request_hash := md5(concat_ws(chr(31), p_lead_id::text, p_actor_id::text, btrim(p_business_name),
    btrim(p_contact_person), btrim(p_phone), p_segment_type, btrim(p_lead_source), btrim(coalesce(p_area, '')), p_created_at::text));

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_operation from public.pipeline_create_operations where operation_id = p_operation_id;
  if found then
    if v_operation.lead_id <> p_lead_id or v_operation.actor_id <> p_actor_id or v_operation.request_hash <> v_request_hash then
      return jsonb_build_object('success', false, 'code', 'PIPELINE_OPERATION_MISMATCH');
    end if;
    select * into v_lead from public.leads where lead_id = v_operation.lead_id;
    select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
    return jsonb_build_object('success', true, 'code', 'LEAD_ALREADY_CONFIRMED', 'operation_id', p_operation_id,
      'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
  end if;

  select is_active into v_actor_active from public.users where user_id = p_actor_id;
  if not coalesce(v_actor_active, false) then
    return jsonb_build_object('success', false, 'code', 'PIPELINE_ACTOR_INACTIVE');
  end if;

  v_first_lock := least(hashtextextended(v_identity_name_phone, 0), hashtextextended(v_identity_name_area, 0));
  v_second_lock := greatest(hashtextextended(v_identity_name_phone, 0), hashtextextended(v_identity_name_area, 0));
  perform pg_advisory_xact_lock(v_first_lock);
  if v_second_lock <> v_first_lock then perform pg_advisory_xact_lock(v_second_lock); end if;

  select * into v_lead
  from public.leads l
  where (
      public.pipeline_normalize_identity_text(l.business_name) = v_business
      and public.pipeline_normalize_phone(l.phone) = v_phone
    ) or (
      v_area <> ''
      and l.segment_type::text = p_segment_type
      and public.pipeline_normalize_identity_text(l.business_name) = v_business
      and public.pipeline_normalize_identity_text(l.area) = v_area
    )
  order by l.created_at, l.lead_id
  limit 1;
  if found then
    select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
    return jsonb_build_object('success', false, 'code', 'LEAD_ALREADY_EXISTS',
      'existing', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
  end if;

  perform set_config('zerodata.pipeline_create', 'approved', true);
  insert into public.leads(lead_id, business_name, contact_person, phone, segment_type, status, assigned_to, created_at, stage_entered_at, lead_source, area)
  values (p_lead_id, btrim(p_business_name), btrim(p_contact_person), btrim(p_phone),
    case when p_segment_type = 'Retailer' then 'Retailer'::public.lead_segment else 'Distributor'::public.lead_segment end,
    'New', p_actor_id, p_created_at, p_created_at, btrim(p_lead_source), nullif(btrim(coalesce(p_area, '')), ''))
  returning * into v_lead;

  insert into public.pipeline_create_operations(operation_id, lead_id, actor_id, request_hash, identity_hash)
  values (p_operation_id, p_lead_id, p_actor_id, v_request_hash, md5(v_identity_name_phone));
  select name into v_owner_name from public.users where user_id = p_actor_id;
  return jsonb_build_object('success', true, 'code', 'LEAD_CREATED', 'operation_id', p_operation_id,
    'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
end;
$$;

revoke all on function public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz) to service_role;

commit;
