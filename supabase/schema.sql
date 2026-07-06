-- Supabase Database Schema for Internal CRM PWA
-- Includes enums, tables, indices, constraints, RLS policies, triggers, and pg_cron setups.

-- Create enums
CREATE TYPE lead_segment AS ENUM ('Distributor', 'Retailer');

-- Sequence: New -> Contacted -> Interested -> Registration -> Installation -> Payment
CREATE TYPE lead_status AS ENUM ('New', 'Contacted', 'Interested', 'Not Interested', 'Registration', 'Installation', 'Payment');

CREATE TYPE query_status AS ENUM ('Open', 'In Progress', 'Resolved');

CREATE TYPE mapping_request_status AS ENUM ('Pending', 'Resolved', 'Overdue');

CREATE TYPE ticket_category AS ENUM ('Access', 'Bug', 'Data', 'Other');
CREATE TYPE ticket_priority AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE ticket_status AS ENUM ('Open', 'In Progress', 'Resolved');

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table (extends Supabase auth.users or stands alone for simulation)
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Capabilities Table
CREATE TABLE IF NOT EXISTS capabilities (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- 3. User Capabilities Table (Many-to-Many RBAC)
CREATE TABLE IF NOT EXISTS user_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  capability_code TEXT NOT NULL REFERENCES capabilities(code) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_user_capability UNIQUE (user_id, capability_code)
);

-- 4. Leads Table
CREATE TABLE IF NOT EXISTS leads (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  phone TEXT NOT NULL,
  segment_type lead_segment NOT NULL,
  status lead_status NOT NULL DEFAULT 'New',
  loss_reason TEXT,
  assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  onboarded_at TIMESTAMP WITH TIME ZONE
);

-- 5. Client Queries Table (Simplified to Client Problem & Problem Status)
CREATE TABLE IF NOT EXISTS client_queries (
  query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  client_problem TEXT NOT NULL,
  problem_status query_status NOT NULL DEFAULT 'Open',
  assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- 6. Mappings Table (Links Distributor to Retailer)
CREATE TABLE IF NOT EXISTS mappings (
  mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  retailer_lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  mapped_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  request_source TEXT NOT NULL DEFAULT 'Web',
  completion_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_mapping UNIQUE (distributor_lead_id, retailer_lead_id)
);

-- 7. Mapping Requests Table
CREATE TABLE IF NOT EXISTS mapping_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  assigned_to_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  status mapping_request_status NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Internal Tickets Table
CREATE TABLE IF NOT EXISTS internal_tickets (
  ticket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category ticket_category NOT NULL DEFAULT 'Other',
  priority ticket_priority NOT NULL DEFAULT 'Low',
  status ticket_status NOT NULL DEFAULT 'Open',
  description TEXT NOT NULL,
  assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- 9. Attendance Table (Anti-fraud verification)
CREATE TABLE IF NOT EXISTS attendance (
  attendance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  clock_out TIMESTAMP WITH TIME ZONE,
  selfie_url TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  CONSTRAINT unique_user_attendance_date UNIQUE (user_id, date)
);

-- 10. Call Logs Table
CREATE TABLE IF NOT EXISTS call_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  next_followup_date TIMESTAMP WITH TIME ZONE
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads(segment_type);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_queries_lead ON client_queries(lead_id);
CREATE INDEX IF NOT EXISTS idx_queries_status ON client_queries(problem_status);
CREATE INDEX IF NOT EXISTS idx_user_caps_user ON user_capabilities(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_mappings_dist_ret ON mappings(distributor_lead_id, retailer_lead_id);
CREATE INDEX IF NOT EXISTS idx_mapping_reqs_assigned ON mapping_requests(assigned_to_id);

-- SEED DATA FOR CAPABILITIES
INSERT INTO capabilities (code, label) VALUES
  ('admin', 'Administrator'),
  ('dist_onboarding', 'Distributor Onboarding'),
  ('dist_support', 'Distributor Support'),
  ('ret_onboarding', 'Retailer Onboarding'),
  ('ret_support', 'Retailer Support'),
  ('field_dist', 'Field Distributor Agent'),
  ('field_ret', 'Field Retailer Agent'),
  ('tech_support', 'Technical Support'),
  ('task_assigner', 'Task Assigner')
ON CONFLICT (code) DO NOTHING;


-- RLS ENFORCEMENT HELPER FUNCTIONS
-- Secure Definier functions to execute capability queries safely

-- Check if user is Admin or has a specific capability
CREATE OR REPLACE FUNCTION has_capability(cap TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Admin capability overrides all checks
  IF EXISTS (
    SELECT 1 FROM user_capabilities 
    WHERE user_id = auth.uid() AND capability_code = 'admin'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_capabilities 
    WHERE user_id = auth.uid() AND capability_code = cap
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check segment-level access based on user capabilities
CREATE OR REPLACE FUNCTION has_segment_access(segment lead_segment)
RETURNS BOOLEAN AS $$
BEGIN
  -- Admin capability overrides all checks
  IF EXISTS (
    SELECT 1 FROM user_capabilities 
    WHERE user_id = auth.uid() AND capability_code = 'admin'
  ) THEN
    RETURN TRUE;
  END IF;

  IF segment = 'Distributor' THEN
    RETURN EXISTS (
      SELECT 1 FROM user_capabilities 
      WHERE user_id = auth.uid() 
      AND capability_code IN ('dist_onboarding', 'dist_support', 'field_dist')
    );
  ELSIF segment = 'Retailer' THEN
    RETURN EXISTS (
      SELECT 1 FROM user_capabilities 
      WHERE user_id = auth.uid() 
      AND capability_code IN ('ret_onboarding', 'ret_support', 'field_ret')
    );
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ROW LEVEL SECURITY (RLS) POLICIES

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- 1. Users policies
CREATE POLICY "Users are viewable by authenticated users" 
  ON users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Admins can modify user records" 
  ON users FOR ALL USING (has_capability('admin'));

-- 2. User Capabilities policies
CREATE POLICY "Users can view their own capabilities or admins can view all" 
  ON user_capabilities FOR SELECT USING (user_id = auth.uid() OR has_capability('admin'));
CREATE POLICY "Only admins can modify user capabilities" 
  ON user_capabilities FOR ALL USING (has_capability('admin'));

-- 3. Leads policies (segmented visibility)
CREATE POLICY "Leads segment access select" 
  ON leads FOR SELECT USING (has_segment_access(segment_type));
CREATE POLICY "Leads segment access insert" 
  ON leads FOR INSERT WITH CHECK (has_segment_access(segment_type));
CREATE POLICY "Leads segment access update" 
  ON leads FOR UPDATE USING (has_segment_access(segment_type)) WITH CHECK (has_segment_access(segment_type));
CREATE POLICY "Leads segment access delete" 
  ON leads FOR DELETE USING (has_capability('admin'));

-- 4. Client Queries policies (checks lead segment)
CREATE POLICY "Queries access select" 
  ON client_queries FOR SELECT USING (
    EXISTS (SELECT 1 FROM leads WHERE lead_id = client_queries.lead_id AND has_segment_access(segment_type))
  );
CREATE POLICY "Queries access insert" 
  ON client_queries FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM leads WHERE lead_id = client_queries.lead_id AND has_segment_access(segment_type))
  );
CREATE POLICY "Queries access update" 
  ON client_queries FOR UPDATE USING (
    EXISTS (SELECT 1 FROM leads WHERE lead_id = client_queries.lead_id AND has_segment_access(segment_type))
  );
CREATE POLICY "Queries access delete" 
  ON client_queries FOR DELETE USING (has_capability('admin'));

-- 5. Mappings policies (requires onboarding or support capability)
CREATE POLICY "Mappings access select" 
  ON mappings FOR SELECT USING (
    has_capability('dist_onboarding') OR has_capability('dist_support') OR 
    has_capability('ret_onboarding') OR has_capability('ret_support')
  );
CREATE POLICY "Mappings access insert" 
  ON mappings FOR INSERT WITH CHECK (
    has_capability('dist_onboarding') OR has_capability('dist_support') OR 
    has_capability('ret_onboarding') OR has_capability('ret_support')
  );
CREATE POLICY "Mappings access update" 
  ON mappings FOR UPDATE USING (
    has_capability('dist_onboarding') OR has_capability('dist_support') OR 
    has_capability('ret_onboarding') OR has_capability('ret_support')
  );
CREATE POLICY "Mappings access delete" 
  ON mappings FOR DELETE USING (has_capability('admin'));

-- 6. Mapping Requests policies (only assigned support or admin)
CREATE POLICY "Mapping requests select" 
  ON mapping_requests FOR SELECT USING (assigned_to_id = auth.uid() OR has_capability('admin'));
CREATE POLICY "Mapping requests update" 
  ON mapping_requests FOR UPDATE USING (assigned_to_id = auth.uid() OR has_capability('admin'));
CREATE POLICY "Mapping requests insert" 
  ON mapping_requests FOR INSERT WITH CHECK (has_capability('admin') OR EXISTS (
    SELECT 1 FROM leads WHERE lead_id = mapping_requests.requester_id AND has_segment_access(segment_type)
  ));
CREATE POLICY "Mapping requests delete" 
  ON mapping_requests FOR DELETE USING (has_capability('admin'));

-- 7. Internal Tickets policies
CREATE POLICY "Users can select their own raised tickets or tech_support/admin sees all" 
  ON internal_tickets FOR SELECT USING (raised_by = auth.uid() OR has_capability('tech_support'));
CREATE POLICY "Users can create tickets" 
  ON internal_tickets FOR INSERT WITH CHECK (raised_by = auth.uid());
CREATE POLICY "Assigned agents or admins can update tickets" 
  ON internal_tickets FOR UPDATE USING (assigned_to = auth.uid() OR has_capability('tech_support') OR has_capability('admin'));

-- 8. Attendance policies
CREATE POLICY "Users can view and log their own attendance" 
  ON attendance FOR SELECT USING (user_id = auth.uid() OR has_capability('admin'));
CREATE POLICY "Users can clock in/out their own attendance" 
  ON attendance FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their own clock out time" 
  ON attendance FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 9. Call Logs policies
CREATE POLICY "Call logs access select" 
  ON call_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM leads WHERE lead_id = call_logs.lead_id AND has_segment_access(segment_type))
  );
CREATE POLICY "Call logs access insert" 
  ON call_logs FOR INSERT WITH CHECK (
    user_id = auth.uid() AND EXISTS (SELECT 1 FROM leads WHERE lead_id = call_logs.lead_id AND has_segment_access(segment_type))
  );


-- AUTOMATION & TRIGGERS

-- Trigger to track when mapping requests are updated
CREATE OR REPLACE FUNCTION update_mapping_request_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_update_mapping_request_timestamp
BEFORE UPDATE ON mapping_requests
FOR EACH ROW EXECUTE FUNCTION update_mapping_request_timestamp();

-- pg_cron setup to automatically sweep overdue mapping requests older than 24 hours
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'flag-overdue-mapping-requests',
  '0 * * * *', -- runs at minute 0 of every hour
  $$ UPDATE mapping_requests SET status = 'Overdue' WHERE status = 'Pending' AND created_at < NOW() - INTERVAL '24 hours' $$
);
