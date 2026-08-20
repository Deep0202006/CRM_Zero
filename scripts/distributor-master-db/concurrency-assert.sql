\set ON_ERROR_STOP on

do $$
begin
  if (select count(*) from public.receivable_payments
      where receivable_id='97000000-0000-4000-a000-000000000001'
        and lower(btrim(import_key))='fixture-concurrent-payment')<>1 then
    raise exception 'MASTER_CONCURRENT_PAYMENT_DUPLICATED';
  end if;
  if (select confirmed_paid_amount from public.receivables_financial_read_v1
      where receivable_id='97000000-0000-4000-a000-000000000001')<>500.00 then
    raise exception 'MASTER_CONCURRENT_BALANCE_INVALID';
  end if;
end $$;
