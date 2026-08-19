\set ON_ERROR_STOP on

do $$
declare delete_action "char"; nullable text;
begin
 select c.confdeltype into delete_action from pg_constraint c
 where c.conrelid='public.receivables'::regclass and c.conname='receivables_distributor_id_fkey';
 select is_nullable into nullable from information_schema.columns
 where table_schema='public' and table_name='receivables' and column_name='distributor_id';
 if delete_action<>'r' or nullable<>'YES' then raise exception 'canonical FK is not nullable ON DELETE RESTRICT'; end if;
 if to_regclass('public.receivables_distributor_id_lookup_idx') is null
    or to_regclass('public.receivables_distributor_bill_reference_uidx') is null then
   raise exception 'canonical indexes are missing';
 end if;
end $$;

do $$
declare actual jsonb;
begin
 select to_jsonb(r)-array['distributor_id'] into actual from public.receivables r
 where receivable_id='94000000-0000-4000-a000-000000000001';
 if (select distributor_id is not null from public.receivables where receivable_id='94000000-0000-4000-a000-000000000001')
    or actual<>jsonb_build_object(
      'receivable_id','94000000-0000-4000-a000-000000000001','bill_reference','HIST-045','bill_reference_key','hist-045',
      'distributor_name','Historical Distributor','distributor_identity_key','code:historical-045','distributor_code','HISTORICAL-045',
      'contact_person','Historical Contact','contact_phone','9999999999','bill_amount',1234.56,'bill_due_date','2026-08-01',
      'next_follow_up_date','2026-08-20','assigned_to','92000000-0000-4000-a000-000000000001','lifecycle_status','active',
      'source','manual','source_batch_id',null,'source_row_number',null,'created_by','91000000-0000-4000-a000-000000000001',
      'created_at','2026-08-01T00:00:00+00:00','updated_at','2026-08-02T00:00:00+00:00','version',7,
      'cancelled_at',null,'cancelled_by',null,'cancellation_reason',null
    ) then raise exception 'migration 045 mutated the historical financial row: %',actual;
 end if;
end $$;

set role service_role;
do $$
declare result jsonb; resolved text;
begin
 result:=public.execute_receivable_command_v1(
  '95000000-0000-4000-a000-000000000001','create','91000000-0000-4000-a000-000000000001',repeat('1',64),
  jsonb_build_object('receivable_id','96000000-0000-4000-a000-000000000001','distributor_id','93000000-0000-4000-a000-000000000001','bill_reference','CANON-MANUAL','contact_person','Owner','bill_amount','1000.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','92500000-0000-4000-a000-000000000001'));
 if not coalesce((result->>'success')::boolean,false) then raise exception 'canonical manual create failed: %',result; end if;
 if not exists(select 1 from public.receivables where receivable_id='96000000-0000-4000-a000-000000000001' and distributor_id='93000000-0000-4000-a000-000000000001' and distributor_name='Canonical Alpha' and distributor_code='CANON-ALPHA' and assigned_to='92000000-0000-4000-a000-000000000001') then raise exception 'canonical manual identity/assignment was not persisted from Distributor Status'; end if;

 result:=public.execute_receivable_command_v1(
  '95000000-0000-4000-a000-000000000002','create','91000000-0000-4000-a000-000000000001',repeat('2',64),
  jsonb_build_object('receivable_id','96000000-0000-4000-a000-000000000002','bill_reference','LEGACY-MANUAL','distributor_name','Legacy Manual','distributor_code','LEGACY','contact_person','Owner','bill_amount','200.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','92000000-0000-4000-a000-000000000001'));
 if not coalesce((result->>'success')::boolean,false) or not exists(select 1 from public.receivables where receivable_id='96000000-0000-4000-a000-000000000002' and distributor_id is null) then raise exception 'legacy manual path is incompatible: %',result; end if;

 select resolution into resolved from public.resolve_receivable_distributors_v1('[{"row_number":2,"distributor_code":" canon-alpha ","distributor_name":"wrong"}]');
 if resolved<>'RESOLVED' then raise exception 'exact reference resolution failed'; end if;
 select resolution into resolved from public.resolve_receivable_distributors_v1('[{"row_number":2,"distributor_code":"","distributor_name":"Canonical Alph"}]');
 if resolved<>'INVALID_DISTRIBUTOR' then raise exception 'near-name fuzzy match was accepted'; end if;
 select resolution into resolved from public.resolve_receivable_distributors_v1('[{"row_number":2,"distributor_code":"","distributor_name":"Ambiguous Exact"}]');
 if resolved<>'AMBIGUOUS_DISTRIBUTOR' then raise exception 'ambiguous exact name did not fail closed'; end if;
 select resolution into resolved from public.resolve_receivable_distributors_v1('[{"row_number":2,"distributor_code":"CANON-UNBILLED","distributor_name":"Canonical Unbilled"}]');
 if resolved<>'INVALID_DISTRIBUTOR_STATUS' then raise exception 'unbilled distributor accepted'; end if;

 result:=public.import_receivables_v1(
  '95000000-0000-4000-a000-000000000003','91000000-0000-4000-a000-000000000001',repeat('3',64),'canonical.csv',repeat('4',64),
  jsonb_build_array(jsonb_build_object('row_number',2,'receivable_id','96000000-0000-4000-a000-000000000003','distributor_id','93000000-0000-4000-a000-000000000001','bill_reference','CANON-IMPORT','distributor_name','Untrusted Name','distributor_code','WRONG','contact_person','Owner','contact_phone','','bill_amount','300.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','92000000-0000-4000-a000-000000000001','notes','')));
 if not coalesce((result->>'success')::boolean,false) or not exists(select 1 from public.receivables where receivable_id='96000000-0000-4000-a000-000000000003' and distributor_id='93000000-0000-4000-a000-000000000001' and distributor_name='Canonical Alpha' and distributor_code='CANON-ALPHA') then raise exception 'canonical import failed: %',result; end if;
end $$;

do $$
declare outstanding jsonb;
begin
 outstanding:=public.distributor_outstanding_receivables_v1('91000000-0000-4000-a000-000000000001','93000000-0000-4000-a000-000000000001',500);
 if (outstanding->>'total')::integer<>2 or jsonb_array_length(outstanding->'rows')<>2 then raise exception 'exact outstanding read is not canonical/bounded: %',outstanding; end if;
 if has_function_privilege('authenticated','public.distributor_outstanding_receivables_v1(uuid,uuid,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.resolve_receivable_distributors_v1(jsonb)','EXECUTE') then raise exception 'canonical helper RPC exposed to browser role'; end if;
end $$;
reset role;

select 'migration 045 canonical link integration passed' as result;
