\set ON_ERROR_STOP on

set role service_role;

select public.import_distributor_master_v1(
  :'operation_id'::uuid,
  '91000000-0000-4000-a000-000000000001'::uuid,
  repeat(:'hash_character',64),
  repeat(:'payload_hash_character',64),
  repeat(:'plan_hash_character',64),
  'master-concurrency.xlsx',
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'row_number',2,
    'payment_id',:'payment_id',
    'receivable_id','97000000-0000-4000-a000-000000000001',
    'import_key','FIXTURE-CONCURRENT-PAYMENT',
    'amount','100.00',
    'payment_date',current_date,
    'payment_mode','Bank',
    'payment_reference','UTR-CONCURRENT',
    'note','Concurrent historical payment'
  ))
);

reset role;
