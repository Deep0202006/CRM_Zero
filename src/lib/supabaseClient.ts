import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "BUILD_TIME_PLACEHOLDER_KEY";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL && typeof window !== 'undefined') {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
}

// Detect if Supabase is fully configured with real keys
export const isSupabaseConfigured = 
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && 
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && 
  !url.includes("your-project-ref") && 
  !anonKey.includes("your-anon-public-key") &&
  !url.includes("placeholder");

export const supabase = createClient(url, anonKey);
