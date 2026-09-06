import "client-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveBackendEnvironment } from "./backendEnvironment";

export const backendEnvironment = resolveBackendEnvironment({
  deployment: process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const isSupabaseConfigured = backendEnvironment.status === "configured";

let authorizedClient: SupabaseClient | undefined;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (backendEnvironment.status !== "configured") return null;
  authorizedClient ??= createClient(
    backendEnvironment.url,
    backendEnvironment.anonKey,
  );
  return authorizedClient;
}

function requireBrowserSupabaseClient(): SupabaseClient {
  const client = getBrowserSupabaseClient();
  if (!client) throw new Error("CRM_UNAVAILABLE");
  return client;
}

// Compatibility facade for existing browser callers. It never constructs a
// Supabase client until an authorized property is actually used.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = requireBrowserSupabaseClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});
