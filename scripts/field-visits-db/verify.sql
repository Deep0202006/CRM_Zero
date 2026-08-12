\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.attendance) <> 1 then raise exception 'attendance row lost'; end if;
  if (select count(*) from public.field_visits) <> 1 then raise exception 'visit row lost'; end if;
  if (select address from public.field_visits limit 1) is not null then raise exception 'historic address fabricated'; end if;
  if (select selfie_url from public.attendance limit 1) <> 'data:image/jpeg;base64,LEGACY' then raise exception 'legacy evidence rewritten by migration'; end if;
end $$;
insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,address,address_contract_version)
values ('00000000-0000-4000-8000-000000000021','new','00000000-0000-4000-8000-000000000001','2026-08-12','2026-08-12T04:30:00Z','payment_done','Distributor','१२ मुख्य सड़क',1);
do $$ begin
  begin
    insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,address,address_contract_version)
    values ('00000000-0000-4000-8000-000000000022','bad','00000000-0000-4000-8000-000000000001','2026-08-12','2026-08-12T04:30:00Z','payment_done','Retailer','Road',1);
    raise exception 'retailer payment_done accepted';
  exception when check_violation then null; end;
  begin
    insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,address,address_contract_version)
    values ('00000000-0000-4000-8000-000000000023','bad','00000000-0000-4000-8000-000000000001','2026-08-12','2026-08-12T04:30:00Z','interested','Retailer',null,1);
    raise exception 'versioned null address accepted';
  exception when check_violation then null; end;
end $$;
