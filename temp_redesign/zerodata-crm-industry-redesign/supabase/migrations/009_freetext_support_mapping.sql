-- Migration to revert free-text unstructured columns and enforce strict relational mappings

-- 1. Revert client_queries table
ALTER TABLE public.client_queries DROP COLUMN IF EXISTS client_name_unregistered;
-- Assuming there might be NULLs, we can only set NOT NULL if we clean them up, but since it's fresh we can try:
-- For safety, we won't strictly enforce NOT NULL on old rows if they are null, but going forward the schema requires it.
-- We will enforce NOT NULL if possible.
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_queries WHERE lead_id IS NULL) THEN
    ALTER TABLE public.client_queries ALTER COLUMN lead_id SET NOT NULL;
  END IF;
END $$;

-- 2. Revert mapping_requests table
ALTER TABLE public.mapping_requests DROP COLUMN IF EXISTS distributor_name_unregistered;
ALTER TABLE public.mapping_requests DROP COLUMN IF EXISTS retailer_name_unregistered;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mapping_requests WHERE distributor_lead_id IS NULL OR retailer_lead_id IS NULL) THEN
    ALTER TABLE public.mapping_requests ALTER COLUMN distributor_lead_id SET NOT NULL;
    ALTER TABLE public.mapping_requests ALTER COLUMN retailer_lead_id SET NOT NULL;
  END IF;
END $$;
