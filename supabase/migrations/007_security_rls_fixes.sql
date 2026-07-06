-- Enable RLS on remaining tables to comply with Part 2 Security Checklist

ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_shift_config ENABLE ROW LEVEL SECURITY;

-- Add basic read-only policies for all authenticated users to capabilities
CREATE POLICY "Capabilities are readable by authenticated users"
ON public.capabilities
FOR SELECT
TO authenticated
USING (true);

-- Add read-only policies for all authenticated users to attendance_shift_config
CREATE POLICY "Attendance shift config is readable by authenticated users"
ON public.attendance_shift_config
FOR SELECT
TO authenticated
USING (true);

-- Allow admin users to modify attendance_shift_config
CREATE POLICY "Admins can update attendance shift config"
ON public.attendance_shift_config
FOR ALL
TO authenticated
USING (public.has_capability('admin'))
WITH CHECK (public.has_capability('admin'));
