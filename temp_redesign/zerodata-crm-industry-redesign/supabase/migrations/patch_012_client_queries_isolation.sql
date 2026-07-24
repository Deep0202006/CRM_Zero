-- =====================================================================
-- PATCH 012: Isolate Client Queries from Onboarding Leads
-- =====================================================================

-- 1. Drop old triggers that might reference the old column if any
DROP TRIGGER IF EXISTS trg_query_task ON public.client_queries;

-- 2. Modify client_queries schema
-- We remove lead_id to sever the connection to prospects
-- We add client_username and client_name for existing clients
ALTER TABLE public.client_queries DROP COLUMN IF EXISTS lead_id CASCADE;
ALTER TABLE public.client_queries ADD COLUMN IF NOT EXISTS client_username text;
ALTER TABLE public.client_queries ADD COLUMN IF NOT EXISTS client_name text;

-- (Optional) If we want strict constraints going forward:
-- UPDATE public.client_queries SET client_username = 'Unknown' WHERE client_username IS NULL;
-- UPDATE public.client_queries SET client_name = 'Unknown' WHERE client_name IS NULL;
-- ALTER TABLE public.client_queries ALTER COLUMN client_username SET NOT NULL;
-- ALTER TABLE public.client_queries ALTER COLUMN client_name SET NOT NULL;

-- 3. Update Row Level Security (RLS) policies
-- We completely decouple it from the leads table segment checks.
-- Anyone with 'admin', 'ret_support', or 'dist_support' capability can view and log queries.

DROP POLICY IF EXISTS "Support reps can view all queries" ON public.client_queries;
DROP POLICY IF EXISTS "Support reps can insert queries" ON public.client_queries;
DROP POLICY IF EXISTS "Support reps can update queries" ON public.client_queries;

CREATE POLICY "Support capabilities view access" ON public.client_queries
FOR SELECT USING (
    has_capability('admin') OR has_capability('ret_support') OR has_capability('dist_support')
);

CREATE POLICY "Support capabilities insert access" ON public.client_queries
FOR INSERT WITH CHECK (
    has_capability('admin') OR has_capability('ret_support') OR has_capability('dist_support')
);

CREATE POLICY "Support capabilities update access" ON public.client_queries
FOR UPDATE USING (
    has_capability('admin') OR has_capability('ret_support') OR has_capability('dist_support')
) WITH CHECK (
    has_capability('admin') OR has_capability('ret_support') OR has_capability('dist_support')
);
