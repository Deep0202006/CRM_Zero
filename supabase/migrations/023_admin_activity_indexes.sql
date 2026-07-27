-- 023_admin_activity_indexes.sql
-- Create compound indexes to ensure sub-10ms read latency for day-wise activity filtering by user

-- call_logs
CREATE INDEX IF NOT EXISTS idx_call_logs_created_user ON public.call_logs(timestamp, user_id);

-- tasks
CREATE INDEX IF NOT EXISTS idx_tasks_created_user ON public.tasks(created_at, assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_user ON public.tasks(due_date, assigned_to);

-- mapping_requests
CREATE INDEX IF NOT EXISTS idx_mapping_requests_created_user ON public.mapping_requests(created_at, mapped_by);
