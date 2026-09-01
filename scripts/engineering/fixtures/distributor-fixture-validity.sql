\set ON_ERROR_STOP on

begin;

do $proof$
declare
  v_actor uuid;
  v_constraint text;
  v_invalid_rejected boolean := false;
begin
  select user_id into v_actor from public.users order by user_id limit 1;
  if v_actor is null then raise exception 'FIXTURE_ACTOR_MISSING'; end if;

  begin
    insert into public.distributor_accounts(
      distributor_id, distributor_name, distributor_reference, identity_key,
      assigned_to, installation_status, training_status, activity_status,
      billing_status, created_by
    ) values (
      md5('engineering-invalid-distributor-fixture')::uuid,
      'Invalid lifecycle fixture', 'ENGINEERING-INVALID', 'code:engineering-invalid',
      v_actor, 'pending', 'pending', 'active', 'not_billed', v_actor
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'distributor_status_sequence' then raise; end if;
    v_invalid_rejected := true;
  end;

  if not v_invalid_rejected then raise exception 'INVALID_DISTRIBUTOR_FIXTURE_ACCEPTED'; end if;

  insert into public.distributor_accounts(
    distributor_id, distributor_name, distributor_reference, identity_key,
    assigned_to, installation_status, training_status, activity_status,
    billing_status, created_by
  ) values (
    md5('engineering-valid-distributor-fixture')::uuid,
    'Valid lifecycle fixture', 'ENGINEERING-VALID', 'code:engineering-valid',
    v_actor, 'done', 'pending', 'not_applicable', 'not_billed', v_actor
  );

  if not exists(select 1 from public.distributor_accounts where distributor_reference='ENGINEERING-VALID') then
    raise exception 'VALID_FIXTURE_DID_NOT_REACH_ASSERTION';
  end if;
end
$proof$;

rollback;
