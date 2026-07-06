-- Migration to support free-text entries for client queries and mappings
-- This allows users to manually type distributor/retailer names that may not exist in the leads table

-- 1. Modify client_queries table
ALTER TABLE client_queries
  ALTER COLUMN lead_id DROP NOT NULL;

ALTER TABLE client_queries
  ADD COLUMN IF NOT EXISTS client_name_unregistered TEXT;

-- 2. Modify mappings table
ALTER TABLE mappings
  ALTER COLUMN distributor_lead_id DROP NOT NULL,
  ALTER COLUMN retailer_lead_id DROP NOT NULL;

ALTER TABLE mappings
  ADD COLUMN IF NOT EXISTS distributor_name_unregistered TEXT,
  ADD COLUMN IF NOT EXISTS retailer_name_unregistered TEXT;

-- 3. Modify mapping_requests table
ALTER TABLE mapping_requests
  ALTER COLUMN distributor_lead_id DROP NOT NULL,
  ALTER COLUMN retailer_lead_id DROP NOT NULL;

ALTER TABLE mapping_requests
  ADD COLUMN IF NOT EXISTS distributor_name_unregistered TEXT,
  ADD COLUMN IF NOT EXISTS retailer_name_unregistered TEXT;
