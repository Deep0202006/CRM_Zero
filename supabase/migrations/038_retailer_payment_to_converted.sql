-- OWNER-APPLIED ONLY, after 037 commits the Converted enum value.
-- Exact Retailer Payment correction; no lead is deleted and no non-target stage is updated.

with corrected as (
  update public.leads
  set status = 'Converted'::public.lead_status
  where segment_type::text = 'Retailer' and status::text = 'Payment'
  returning lead_id
)
insert into public.pipeline_transition_operations(
  operation_id,lead_id,actor_id,expected_stage,target_stage,event_kind,reason
)
select
  md5('retailer_payment_stage_removed:' || lead_id::text)::uuid,
  lead_id,null,'Payment','Converted','system_correction','retailer_payment_stage_removed'
from corrected
on conflict (operation_id) do nothing;
