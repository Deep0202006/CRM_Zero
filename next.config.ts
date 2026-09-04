import type { NextConfig } from "next";
import { classifyBuildEnvironment } from "./src/lib/backendEnvironment";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV: classifyBuildEnvironment({
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
      NODE_ENV: process.env.NODE_ENV,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }),
  },
};

export default nextConfig;
