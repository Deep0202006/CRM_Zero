-- Migration 019: Field Visits
-- Enables field representatives to log shop visits with geolocation and photo proof.

CREATE TABLE IF NOT EXISTS public.field_visits (
    visit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    visit_date DATE NOT NULL,
    check_in_time TIMESTAMPTZ NOT NULL,
    check_in_lat DOUBLE PRECISION,
    check_in_lng DOUBLE PRECISION,
    check_in_photo_url TEXT,
    visit_outcome TEXT NOT NULL,
    visit_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_field_visits_user_date ON public.field_visits(user_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_field_visits_lead_id ON public.field_visits(lead_id);

-- Enable RLS
ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Admins can read all visits
CREATE POLICY "Admins can view all field visits"
ON public.field_visits FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_capabilities uc
        WHERE uc.user_id = auth.uid() AND uc.capability_code = 'admin'
    )
);

-- Users can read their own visits
CREATE POLICY "Users can view own field visits"
ON public.field_visits FOR SELECT
USING (user_id = auth.uid());

-- Users can insert their own visits
CREATE POLICY "Users can insert own field visits"
ON public.field_visits FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_field_visits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_field_visits_updated_at ON public.field_visits;
CREATE TRIGGER trg_field_visits_updated_at
BEFORE UPDATE ON public.field_visits
FOR EACH ROW
EXECUTE FUNCTION update_field_visits_updated_at();

-- Force schema cache refresh
NOTIFY pgrst, 'reload schema';
