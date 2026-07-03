import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase config missing. Create .env.local with NEXT_PUBLIC_SUPABASE_URL " +
    "and NEXT_PUBLIC_SUPABASE_ANON_KEY — see Project Settings > API in your Supabase dashboard."
  );
}

// Detect if Supabase is fully configured with real keys
export const isSupabaseConfigured = 
  !!url && 
  !!anonKey && 
  !url.includes("your-project-ref") && 
  !anonKey.includes("your-anon-public-key");

export const supabase = createClient(url, anonKey);
