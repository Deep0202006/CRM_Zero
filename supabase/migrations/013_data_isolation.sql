-- Drop existing policies that grant broad access
DROP POLICY IF EXISTS "Leads segment access" ON leads;
DROP POLICY IF EXISTS "Users can view tasks in their segments" ON tasks;
DROP POLICY IF EXISTS "Users can view queries in their segment" ON client_queries;
DROP POLICY IF EXISTS "Users can view call logs in their segment" ON call_logs;
DROP POLICY IF EXISTS "Users can view mapping requests in their segment" ON mapping_requests;
DROP POLICY IF EXISTS "Users can view mappings in their segment" ON mappings;
DROP POLICY IF EXISTS "Sales users can view all leads" ON leads;
DROP POLICY IF EXISTS "Sales users can insert leads" ON leads;
DROP POLICY IF EXISTS "Sales users can update leads" ON leads;

-- Drop incorrect strict isolation policies from previous attempt
DROP POLICY IF EXISTS "Leads strict isolation select" ON leads;
DROP POLICY IF EXISTS "Leads strict isolation update" ON leads;
DROP POLICY IF EXISTS "Leads insert" ON leads;

DROP POLICY IF EXISTS "Tasks strict isolation select" ON tasks;
DROP POLICY IF EXISTS "Tasks strict isolation update" ON tasks;
DROP POLICY IF EXISTS "Tasks insert" ON tasks;

DROP POLICY IF EXISTS "Call logs strict isolation select" ON call_logs;
DROP POLICY IF EXISTS "Call logs strict isolation update" ON call_logs;
DROP POLICY IF EXISTS "Call logs insert" ON call_logs;

DROP POLICY IF EXISTS "Queries strict isolation select" ON client_queries;
DROP POLICY IF EXISTS "Queries strict isolation update" ON client_queries;
DROP POLICY IF EXISTS "Queries insert" ON client_queries;

DROP POLICY IF EXISTS "Mappings strict isolation select" ON mappings;
DROP POLICY IF EXISTS "Mappings strict isolation update" ON mappings;
DROP POLICY IF EXISTS "Mappings insert" ON mappings;

DROP POLICY IF EXISTS "Mapping requests strict isolation select" ON mapping_requests;
DROP POLICY IF EXISTS "Mapping requests strict isolation update" ON mapping_requests;
DROP POLICY IF EXISTS "Mapping requests insert" ON mapping_requests;

-- Leads Strict Isolation
CREATE POLICY "Leads strict isolation select" 
  ON leads FOR SELECT 
  USING (
    assigned_to = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Leads strict isolation update" 
  ON leads FOR UPDATE 
  USING (
    assigned_to = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Leads insert" 
  ON leads FOR INSERT 
  WITH CHECK (true);

-- Tasks Strict Isolation
CREATE POLICY "Tasks strict isolation select" 
  ON tasks FOR SELECT 
  USING (
    assigned_to = auth.uid() OR 
    assigned_by = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Tasks strict isolation update" 
  ON tasks FOR UPDATE 
  USING (
    assigned_to = auth.uid() OR 
    assigned_by = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Tasks insert" 
  ON tasks FOR INSERT 
  WITH CHECK (true);

-- Call Logs Strict Isolation
CREATE POLICY "Call logs strict isolation select" 
  ON call_logs FOR SELECT 
  USING (
    user_id = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Call logs strict isolation update" 
  ON call_logs FOR UPDATE 
  USING (
    user_id = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Call logs insert" 
  ON call_logs FOR INSERT 
  WITH CHECK (true);

-- Client Queries Strict Isolation
CREATE POLICY "Queries strict isolation select" 
  ON client_queries FOR SELECT 
  USING (
    assigned_to = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Queries strict isolation update" 
  ON client_queries FOR UPDATE 
  USING (
    assigned_to = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Queries insert" 
  ON client_queries FOR INSERT 
  WITH CHECK (true);

-- Mappings Strict Isolation
CREATE POLICY "Mappings strict isolation select" 
  ON mappings FOR SELECT 
  USING (
    mapped_by = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Mappings strict isolation update" 
  ON mappings FOR UPDATE 
  USING (
    mapped_by = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Mappings insert" 
  ON mappings FOR INSERT 
  WITH CHECK (true);

-- Mapping Requests Strict Isolation
CREATE POLICY "Mapping requests strict isolation select" 
  ON mapping_requests FOR SELECT 
  USING (
    assigned_to_id = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Mapping requests strict isolation update" 
  ON mapping_requests FOR UPDATE 
  USING (
    assigned_to_id = auth.uid() OR 
    has_capability('admin')
  );

CREATE POLICY "Mapping requests insert" 
  ON mapping_requests FOR INSERT 
  WITH CHECK (true);
