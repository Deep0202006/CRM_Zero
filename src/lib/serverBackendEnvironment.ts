import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BackendEnvironment } from "./backendEnvironment";
import { getServerBackendEnvironment } from "./serverBackendIdentity";

type ServerClientFailure = {
  ok: false;
  deployment: BackendEnvironment["deployment"];
  reason: string;
};

type ServerClientSuccess = {
  ok: true;
  deployment: "production" | "test";
  reason: "AUTHORIZED_PRODUCTION" | "AUTHORIZED_TEST_FIXTURE";
  client: SupabaseClient;
};

export type ServerClientResult = ServerClientFailure | ServerClientSuccess;

function failure(
  backend: BackendEnvironment,
  reason: string = backend.reason,
): ServerClientFailure {
  return {
    ok: false,
    deployment: backend.deployment,
    reason,
  };
}

export function createServerAnonClient(accessToken?: string): ServerClientResult {
  const backend = getServerBackendEnvironment();
  if (backend.status !== "configured") return failure(backend);

  return {
    ok: true,
    deployment: backend.deployment,
    reason: backend.reason,
    client: createClient(backend.url, backend.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      ...(accessToken
        ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
        : {}),
    }),
  };
}

export function createServerServiceClient(): ServerClientResult {
  const backend = getServerBackendEnvironment();
  if (backend.status !== "configured") return failure(backend);
  if (backend.deployment !== "production") {
    return failure(backend, "PRIVILEGED_CLIENT_NOT_AVAILABLE");
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey === "BUILD_TIME_PLACEHOLDER_KEY") {
    return failure(backend, "MISSING_SERVICE_ROLE_CONFIGURATION");
  }

  return {
    ok: true,
    deployment: backend.deployment,
    reason: backend.reason,
    client: createClient(backend.url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}
