\set ON_ERROR_STOP on
do $$ declare v_actor uuid:='00000000-0000-4000-8000-000000000001'; v_result jsonb; v_before bigint; begin
 if (select count(*) from public.field_visits where erp_id is null and erp_usage_state is null)<>1 then raise exception 'ERP_HISTORICAL_BACKFILL'; end if;
 select count(*) into v_before from public.erp_systems;
 select public.confirm_field_visit_erp_v1(v_actor,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000024','lead_id','erp-retailer','visit_date','2026-08-12','check_in_time','2026-08-12T04:30:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address','pincode','110001','created_at','2026-08-12T04:30:00Z','updated_at','2026-08-12T04:30:00Z','erp_usage_state','erp','erp_name_input',' MARG ')) into v_result;
 if not coalesce((v_result->>'success')::boolean,false) or (select count(*) from public.erp_systems where erp_key='marg')<>1 then raise exception 'ERP_CREATE_OR_VISIT_FAILED: %',v_result; end if;
 select public.confirm_field_visit_erp_v1(v_actor,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000025','lead_id','none-retailer','visit_date','2026-08-12','check_in_time','2026-08-12T04:31:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address','pincode','110001','created_at','2026-08-12T04:31:00Z','updated_at','2026-08-12T04:31:00Z','erp_usage_state','none')) into v_result;
 if not coalesce((v_result->>'success')::boolean,false) or (select count(*) from public.erp_systems)<>v_before+1 then raise exception 'NONE_CREATED_ERP: %',v_result; end if;
 select public.confirm_field_visit_erp_v1(v_actor,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000024','lead_id','erp-retailer','visit_date','2026-08-12','check_in_time','2026-08-12T04:30:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address','pincode','110001','created_at','2026-08-12T04:30:00Z','updated_at','2026-08-12T04:30:00Z','erp_usage_state','erp','erp_name_input','marg')) into v_result;
 if not coalesce((v_result->>'already_confirmed')::boolean,false) or (select count(*) from public.field_visits where visit_id='00000000-0000-4000-8000-000000000024')<>1 then raise exception 'RETRY_NOT_IDEMPOTENT'; end if;
 if has_function_privilege('authenticated','public.confirm_field_visit_erp_v1(uuid,jsonb)','execute') then raise exception 'BROWSER_WRITE_ALLOWED'; end if;
end $$;
select 'Migration 048 Field Visit ERP integration passed' as result;
