import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerBackendEnvironment } from "./serverBackendIdentity";

type ServerClientFailure = {
  ok: false;
};

type ServerClientSuccess = {
  ok: true;
  client: SupabaseClient;
};

export type ServerClientResult = ServerClientFailure | ServerClientSuccess;

function failure(): ServerClientFailure {
  return { ok: false };
}

export function createServerAnonClient(accessToken?: string): ServerClientResult {
  const backend = getServerBackendEnvironment();
  if (backend.status !== "configured") return failure();

  return {
    ok: true,
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
  if (backend.status !== "configured") return failure();
  if (backend.deployment !== "production") {
    return failure();
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey === "BUILD_TIME_PLACEHOLDER_KEY") {
    return failure();
  }

  return {
    ok: true,
    client: createClient(backend.url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

export function backendUnavailableResponse(): Response {
  return Response.json({ error: "CRM_UNAVAILABLE" }, { status: 503 });
}
