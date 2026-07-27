-- 024_add_phone_to_users.sql
-- Add an optional phone column to public.users for the identity rendering standard

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
