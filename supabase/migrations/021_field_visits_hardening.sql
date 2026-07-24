-- Migration 021: Field Visits Hardening
-- Adds columns and strict RLS for production field visit usage.

-- 1. Create table if it doesn't exist (incorporating 019 for safety)
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

-- Enable RLS
ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;

-- 2. Add missing columns to field_visits
ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS attendance_id UUID,
  ADD COLUMN IF NOT EXISTS person_met TEXT,
  ADD COLUMN IF NOT EXISTS segment_type TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date DATE,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending_sync';

-- Create index on sync_status
CREATE INDEX IF NOT EXISTS idx_field_visits_sync_status ON public.field_visits(sync_status);

-- 2. Strict RLS enforcing India date logic for insert
-- Users can only insert visits for the CURRENT day in India Standard Time.
CREATE OR REPLACE FUNCTION is_valid_ist_date(visit_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN visit_date = (now() AT TIME ZONE 'Asia/Kolkata')::DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Overwrite Insert Policy
DROP POLICY IF EXISTS "Users can insert own field visits" ON public.field_visits;
CREATE POLICY "Users can insert own field visits"
ON public.field_visits FOR INSERT
WITH CHECK (
    user_id = auth.uid() 
    AND is_valid_ist_date(visit_date)
);

-- Users can update their own visits (e.g. changing sync status)
CREATE POLICY "Users can update own field visits"
ON public.field_visits FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 3. Storage Bucket for evidence
INSERT INTO storage.buckets (id, name, public)
VALUES ('visits-evidence', 'visits-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
-- 1. Users can upload to their own folder: user_id/*
CREATE POLICY "Users can upload visit evidence"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'visits-evidence' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 2. Users can read their own evidence
CREATE POLICY "Users can view own visit evidence"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'visits-evidence' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Admins can view all evidence
CREATE POLICY "Admins can view all visit evidence"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'visits-evidence'
  AND EXISTS (
      SELECT 1 FROM public.user_capabilities uc
      WHERE uc.user_id = auth.uid() AND uc.capability_code = 'admin'
  )
);
