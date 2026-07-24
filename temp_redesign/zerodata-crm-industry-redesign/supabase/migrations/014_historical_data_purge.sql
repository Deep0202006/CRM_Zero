BEGIN;

-- Delete historical tasks status history to prevent FK errors
DELETE FROM task_status_history WHERE changed_at < '2026-07-07 18:30:00+00';

-- Delete historical tasks
DELETE FROM tasks WHERE created_at < '2026-07-07 18:30:00+00';

-- Delete historical call logs
DELETE FROM call_logs WHERE timestamp < '2026-07-07 18:30:00+00';

-- Delete historical queries
DELETE FROM client_queries WHERE created_at < '2026-07-07 18:30:00+00';

-- Delete historical mapping requests
DELETE FROM mapping_requests WHERE created_at < '2026-07-07 18:30:00+00';

-- Delete historical mappings
DELETE FROM mappings WHERE created_at < '2026-07-07 18:30:00+00';

-- Delete pipeline dependencies
DELETE FROM lead_registration_checklist WHERE created_at < '2026-07-07 18:30:00+00';
DELETE FROM lead_installation_details WHERE created_at < '2026-07-07 18:30:00+00';
DELETE FROM lead_payment_details WHERE created_at < '2026-07-07 18:30:00+00';

-- Delete historical pipeline leads
DELETE FROM leads WHERE created_at < '2026-07-07 18:30:00+00';

COMMIT;
