-- =====================================================================
-- PHASE 0: PRE-SEED DATABASE HARDENING & IDENTITY LINKING
-- =====================================================================

-- 1. Create the user_capabilities many-to-many junction if missing
CREATE TABLE IF NOT EXISTS public.user_capabilities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE NOT null,
    capability_code TEXT NOT null,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT null,
    CONSTRAINT unique_user_capability_matrix UNIQUE (user_id, capability_code)
);

-- 2. Explicitly activate Row Level Security across production entities
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;

-- 3. Define Context-Aware Row Level Security (RLS) Policies
CREATE POLICY "Users can read own data" ON public.users
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can read own capabilities" ON public.user_capabilities
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins have full access" ON public.users
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_capabilities 
            WHERE user_capabilities.user_id = auth.uid() 
            AND user_capabilities.capability_code = 'admin'
        )
    );

CREATE POLICY "Users can read assigned leads" ON public.leads
    FOR SELECT USING (
        assigned_to = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.user_capabilities 
            WHERE user_capabilities.user_id = auth.uid() 
            AND user_capabilities.capability_code = 'admin'
        )
    );

CREATE POLICY "Users can read assigned tickets" ON public.client_queries
    FOR SELECT USING (
        assigned_to = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.user_capabilities 
            WHERE user_capabilities.user_id = auth.uid() 
            AND user_capabilities.capability_code = 'admin'
        )
    );

-- 4. Deploy Performance Optimizations for Free-Tier Indexing
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_queries_assigned_to ON public.client_queries(assigned_to);
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.client_queries(problem_status);

-- =====================================================================
-- PHASE 3: AUTOMATED MAINTENANCE CRON OPERATIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job 1: Nightly KPI Snapshots Aggregator
SELECT cron.schedule(
    'nightly-kpi',
    '0 23 * * *',
    $$
    INSERT INTO public.daily_kpi_snapshots (date, total_leads, active_users, conversion_rate)
    SELECT 
        CURRENT_DATE,
        COUNT(*) as total_leads,
        (SELECT COUNT(*) FROM public.users WHERE last_active_at > NOW() - INTERVAL '7 days') as active_users,
        (COUNT(CASE WHEN status = 'Active' THEN 1 END)::float / NULLIF(COUNT(*), 0)) as conversion_rate
    FROM public.leads
    WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day'
    $$
);

-- Job 2: Nightly Contract Renewal Automation Sweep
SELECT cron.schedule(
    'nightly-renewals',
    '0 6 * * *',
    $$
    UPDATE public.leads 
    SET renewal_reminder_sent = false,
        status = 'Renewal Due'
    WHERE renewal_date <= CURRENT_DATE + INTERVAL '30 days'
    AND status = 'Active'
    AND renewal_reminder_sent = false
    $$
);

-- Job 3: Nightly Pipeline Re-engagement Framework
SELECT cron.schedule(
    'nightly-reengage',
    '0 7 * * *',
    $$
    UPDATE public.leads 
    SET status = 'New',
        re_engage_after = NULL
    WHERE re_engage_after <= CURRENT_DATE
    AND status = 'Not Interested'
    $$
);
