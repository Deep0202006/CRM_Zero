-- 017_update_allocated_targets.sql

-- 1. Rename existing columns to match the new strict naming convention (safe rename)
DO $$
BEGIN
  IF EXISTS(SELECT *
    FROM information_schema.columns
    WHERE table_name='allocated_targets' and column_name='target_legal_name')
  THEN
      ALTER TABLE "public"."allocated_targets" RENAME COLUMN "target_legal_name" TO "target_name";
  END IF;

  IF EXISTS(SELECT *
    FROM information_schema.columns
    WHERE table_name='allocated_targets' and column_name='target_phone_number')
  THEN
      ALTER TABLE "public"."allocated_targets" RENAME COLUMN "target_phone_number" TO "target_mobile";
  END IF;
END $$;

-- 2. Add new columns for Excel mapping
ALTER TABLE allocated_targets 
  ADD COLUMN IF NOT EXISTS target_address TEXT,
  ADD COLUMN IF NOT EXISTS target_area TEXT,
  ADD COLUMN IF NOT EXISTS target_state TEXT,
  ADD COLUMN IF NOT EXISTS target_email TEXT,
  ADD COLUMN IF NOT EXISTS pspa_code TEXT,
  ADD COLUMN IF NOT EXISTS third_party_code TEXT,
  ADD COLUMN IF NOT EXISTS dlic1 TEXT,
  ADD COLUMN IF NOT EXISTS dlic2 TEXT,
  ADD COLUMN IF NOT EXISTS dlic3 TEXT,
  ADD COLUMN IF NOT EXISTS dlic4 TEXT,
  ADD COLUMN IF NOT EXISTS food_license TEXT;

-- 3. Create the compound tracking index for fast querying
CREATE INDEX IF NOT EXISTS idx_alloc_targets_compound ON allocated_targets (assigned_to_user_id, is_completed, city);
