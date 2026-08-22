insert into public.users(user_id,is_active) values ('00000000-0000-4000-8000-000000000004',true);
insert into public.user_capabilities(user_id,capability_code) values ('00000000-0000-4000-8000-000000000004','admin');
create or replace function public.receivables_is_admin(p_user_id uuid)
returns boolean language sql stable as $$
  select exists(select 1 from public.user_capabilities where user_id=p_user_id and capability_code='admin')
$$;

insert into public.erp_systems(erp_id,erp_name,erp_key,created_by) values
  ('60000000-0000-4000-a000-000000000001','MARG','marg','00000000-0000-4000-8000-000000000001');

-- repeat-retailer has two visits; shared-business deliberately exists in both segments.
insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,erp_usage_state,erp_id) values
  ('49000000-0000-4000-8000-000000000001','existing-retailer','00000000-0000-4000-8000-000000000001','2024-01-01','2024-01-01T00:00:00Z','interested','Retailer','erp','60000000-0000-4000-a000-000000000001'),
  ('49000000-0000-4000-8000-000000000002','custom-retailer','00000000-0000-4000-8000-000000000001','2024-01-02','2024-01-02T00:00:00Z','interested','Retailer',null,null),
  ('49000000-0000-4000-8000-000000000003','none-retailer','00000000-0000-4000-8000-000000000001','2024-01-03','2024-01-03T00:00:00Z','interested','Retailer',null,null),
  ('49000000-0000-4000-8000-000000000004','repeat-retailer','00000000-0000-4000-8000-000000000001','2024-01-04','2024-01-04T00:00:00Z','interested','Retailer',null,null),
  ('49000000-0000-4000-8000-000000000005','repeat-retailer','00000000-0000-4000-8000-000000000001','2024-01-05','2024-01-05T00:00:00Z','interested','Retailer',null,null),
  ('49000000-0000-4000-8000-000000000006','shared-business','00000000-0000-4000-8000-000000000001','2024-01-06','2024-01-06T00:00:00Z','interested','Retailer',null,null),
  ('49000000-0000-4000-8000-000000000007','shared-business','00000000-0000-4000-8000-000000000002','2024-01-07','2024-01-07T00:00:00Z','interested','Distributor',null,null),
  ('49000000-0000-4000-8000-000000000008','distributor-only','00000000-0000-4000-8000-000000000002','2024-01-08','2024-01-08T00:00:00Z','interested','Distributor',null,null);
