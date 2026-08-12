create extension if not exists pgcrypto;
create schema if not exists auth;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.lead_status as enum ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due');
create type public.segment_type as enum ('Retailer','Distributor');
create type public.task_status_enum as enum ('Pending','In Progress','Completed','Missed');
create type public.task_priority_enum as enum ('High','Medium','Low');
create type public.task_source_enum as enum ('template','manual');
create table public.users(user_id uuid primary key, name text not null, email text, is_active boolean not null default true);
create table public.leads(
  lead_id uuid primary key, business_name text not null, contact_person text not null, phone text not null,
  segment_type public.segment_type not null, status public.lead_status not null, assigned_to uuid references public.users(user_id),
  created_at timestamptz not null default now(), stage_entered_at timestamptz, onboarded_at timestamptz,
  lead_source text, area text, re_engage_after date, renewal_date date
);
create table public.tasks(
  task_id uuid primary key, assigned_to uuid not null references public.users(user_id), assigned_by uuid references public.users(user_id),
  title text not null, description text, priority public.task_priority_enum not null, status public.task_status_enum not null,
  source public.task_source_enum not null, template_id uuid, related_lead_id uuid references public.leads(lead_id), due_date date not null,
  created_at timestamptz not null default now()
);
create table public.pipeline_transition_operations(
  operation_id uuid primary key, lead_id uuid not null references public.leads(lead_id) on delete restrict,
  actor_id uuid not null references public.users(user_id) on delete restrict, expected_stage text not null, target_stage text not null,
  confirmed_at timestamptz not null default now(),
  constraint pipeline_transition_expected_stage_frozen check(expected_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due')),
  constraint pipeline_transition_target_stage_frozen check(target_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due'))
);
alter table public.leads enable row level security;
create policy "Leads insert" on public.leads for insert to authenticated with check (true);
create policy "Leads segment access select" on public.leads for select to authenticated using (true);
create policy "Leads segment access update" on public.leads for update to authenticated using (true);
create or replace function public.track_lead_stage_change() returns trigger language plpgsql as $$ begin if new.status is distinct from old.status then new.stage_entered_at=now(); end if; return new; end $$;
create trigger trg_lead_stage_change before update of status on public.leads for each row execute function public.track_lead_stage_change();
create or replace function public.guard_pipeline_employee_status_write() returns trigger language plpgsql as $$ begin if new.status is distinct from old.status and auth.uid() is not null and coalesce(current_setting('zerodata.pipeline_transition',true),'') <> 'approved' then raise exception using errcode='42501'; end if; return new; end $$;
create trigger trg_guard_pipeline_employee_status_write before update of status on public.leads for each row execute function public.guard_pipeline_employee_status_write();
create or replace function public.transition_lead_stage(p_operation_id text,p_lead_id text,p_expected text,p_target text) returns jsonb language sql as $$ select '{}'::jsonb $$;

insert into public.users values
('10000000-0000-4000-a000-000000000001','Owner','owner@example.test',true),
('10000000-0000-4000-a000-000000000002','Other','other@example.test',true),
('10000000-0000-4000-a000-000000000003','Admin','admin@example.test',true),
('10000000-0000-4000-a000-000000000004','Inactive','inactive@example.test',false);
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to) values
('20000000-0000-4000-a000-000000000001','Retail Payment','Person','1','Retailer','Payment','10000000-0000-4000-a000-000000000001'),
('20000000-0000-4000-a000-000000000002','Retail Installation','Person','2','Retailer','Installation','10000000-0000-4000-a000-000000000001'),
('20000000-0000-4000-a000-000000000003','Distributor Payment','Person','3','Distributor','Payment','10000000-0000-4000-a000-000000000001'),
('20000000-0000-4000-a000-000000000004','Other owner','Person','4','Distributor','Installation','10000000-0000-4000-a000-000000000002');
insert into public.tasks values
('30000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',null,'Follow up: Retail Payment (Payment)','Lead moved to Payment. Follow up before it goes stale.','Medium','Pending','manual',null,'20000000-0000-4000-a000-000000000001',current_date,now()),
('30000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000001',null,'Manual customer work','Keep this genuine task.','Medium','Pending','manual',null,'20000000-0000-4000-a000-000000000001',current_date,now()),
('30000000-0000-4000-a000-000000000003','10000000-0000-4000-a000-000000000001',null,'Collect GST certificate: Retail Payment','Required for registration.','Medium','In Progress','manual',null,'20000000-0000-4000-a000-000000000001',current_date,now());
