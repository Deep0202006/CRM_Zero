import { createClient } from "@supabase/supabase-js";
import { resolveBackendEnvironment } from "./backendEnvironment";

export const backendEnvironment = resolveBackendEnvironment({
  deployment: process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (backendEnvironment.status === "unavailable" && typeof window !== "undefined") {
  console.error(
    `[backend-environment] deployment=${backendEnvironment.deployment} reason=${backendEnvironment.reason}`,
  );
}

export const isSupabaseConfigured = backendEnvironment.status === "configured";

export const supabase =
  backendEnvironment.status === "configured"
    ? createClient(backendEnvironment.url, backendEnvironment.anonKey)
    : createClient("http://127.0.0.1", "backend-unavailable", {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async () => {
            throw new Error(`BACKEND_UNAVAILABLE:${backendEnvironment.reason}`);
          },
        },
      });
