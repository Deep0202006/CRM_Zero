\set ON_ERROR_STOP on

insert into public.users(user_id,name,email,is_active) values
 ('91000000-0000-4000-a000-000000000001','Link Admin','link-admin@example.test',true),
 ('92000000-0000-4000-a000-000000000001','Link Employee','link-employee@example.test',true),
 ('92500000-0000-4000-a000-000000000001','Payload Employee','payload-employee@example.test',true);
insert into public.user_capabilities(user_id,capability_code)
values ('91000000-0000-4000-a000-000000000001','admin');

set role service_role;
insert into public.distributor_accounts(
 distributor_id,distributor_name,distributor_reference,identity_key,assigned_to,
 installation_status,training_status,mapping_status,activity_status,billing_status,created_by
) values
 ('93000000-0000-4000-a000-000000000001','Canonical Alpha','CANON-ALPHA','reference:canon-alpha','92000000-0000-4000-a000-000000000001','done','done','done','active','billed','91000000-0000-4000-a000-000000000001'),
 ('93000000-0000-4000-a000-000000000002','Canonical Unbilled','CANON-UNBILLED','reference:canon-unbilled','92000000-0000-4000-a000-000000000001','done','done','done','active','not_billed','91000000-0000-4000-a000-000000000001'),
 ('93000000-0000-4000-a000-000000000003','Ambiguous Exact','AMBIG-A','reference:ambig-a','92000000-0000-4000-a000-000000000001','done','done','done','active','billed','91000000-0000-4000-a000-000000000001'),
 ('93000000-0000-4000-a000-000000000004','Ambiguous Exact','AMBIG-B','reference:ambig-b','92000000-0000-4000-a000-000000000001','done','done','done','active','billed','91000000-0000-4000-a000-000000000001');

-- This authoritative historical row exists before migration 045. The post-
-- migration assertions require every value to remain unchanged and the new
-- canonical UUID to remain NULL.
insert into public.receivables(
 receivable_id,bill_reference,bill_reference_key,distributor_name,
 distributor_identity_key,distributor_code,contact_person,contact_phone,
 bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by,
 created_at,updated_at,version
) values (
 '94000000-0000-4000-a000-000000000001','HIST-045','hist-045','Historical Distributor',
 'code:historical-045','HISTORICAL-045','Historical Contact','9999999999',
 1234.56,date '2026-08-01',date '2026-08-20','92000000-0000-4000-a000-000000000001','manual','91000000-0000-4000-a000-000000000001',
 timestamptz '2026-08-01 00:00:00+00',timestamptz '2026-08-02 00:00:00+00',7
);
reset role;
