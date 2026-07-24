revoke execute
on function public.allocate_city_task_batch(
  text,
  text,
  jsonb,
  jsonb
)
from authenticated;
