-- 11. Task Upload Batches Table
CREATE TABLE IF NOT EXISTS task_upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 12. Allocated Targets Table
CREATE TABLE IF NOT EXISTS allocated_targets (
  target_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES task_upload_batches(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  target_legal_name TEXT NOT NULL,
  target_username TEXT NOT NULL,
  target_phone_number TEXT NOT NULL,
  city TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alloc_targets_user ON allocated_targets(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_alloc_targets_city ON allocated_targets(city);

ALTER TABLE task_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocated_targets ENABLE ROW LEVEL SECURITY;

-- 10. Task Upload Batches policies
CREATE POLICY "Admin can access task batches"
  ON task_upload_batches FOR ALL USING (has_capability('admin'));

-- 11. Allocated Targets policies
CREATE POLICY "Admins can access all allocated targets"
  ON allocated_targets FOR ALL USING (has_capability('admin'));
CREATE POLICY "Agents can view and update their own assigned targets"
  ON allocated_targets FOR SELECT USING (assigned_to_user_id = auth.uid());
CREATE POLICY "Agents can update their own assigned targets"
  ON allocated_targets FOR UPDATE USING (assigned_to_user_id = auth.uid()) WITH CHECK (assigned_to_user_id = auth.uid());
