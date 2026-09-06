import "server-only";

import {
  classifyBuildEnvironment,
  resolveBackendEnvironment,
  type BackendEnvironment,
} from "./backendEnvironment";

export function getServerBackendEnvironment(): BackendEnvironment {
  const serverDeployment = classifyBuildEnvironment({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
    NODE_ENV: process.env.NODE_ENV,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  return resolveBackendEnvironment({
    deployment: process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV,
    serverDeployment,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
