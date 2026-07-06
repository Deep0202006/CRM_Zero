-- 006_mapping_requests.sql

-- Drop existing mapping_requests table (since this is just a log, dropping is acceptable as discussed)
DROP TABLE IF EXISTS public.mapping_requests CASCADE;

-- Recreate mapping_requests with new structure
CREATE TABLE public.mapping_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_lead_id UUID NOT NULL REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  retailer_lead_id UUID NOT NULL REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  mapped_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('Pending', 'Completed')) DEFAULT 'Pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.mapping_requests ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
CREATE POLICY mapping_requests_access ON public.mapping_requests
FOR ALL
USING (
  has_capability('ret_support') OR has_capability('dist_support') OR has_capability('admin')
);

-- Trigger for KPI update on status transition to 'Completed'
CREATE OR REPLACE FUNCTION update_kpi_mapping_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
    UPDATE public.kpi_daily_snapshot
    SET mapping_requests_resolved = mapping_requests_resolved + 1
    WHERE user_id = NEW.mapped_by AND date = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_mapping_request_completed ON public.mapping_requests;

CREATE TRIGGER on_mapping_request_completed
AFTER UPDATE ON public.mapping_requests
FOR EACH ROW
EXECUTE FUNCTION update_kpi_mapping_request();
