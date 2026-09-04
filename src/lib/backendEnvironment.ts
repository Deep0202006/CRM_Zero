export const AUTHORIZED_PRODUCTION_SUPABASE_HOST =
  "gwfjkpsoaoherntwhdyf.supabase.co";

export const TEST_FIXTURE_CONFIGURATION = {
  url: "https://e2e.supabase.co",
  anonKey: "e2e-anon-key",
} as const;

export const TEST_FIXTURE_RUNTIME = {
  url: "http://127.0.0.1:54321",
  anonKey: "zerodata-local-test-fixture",
} as const;

export type DeploymentEnvironment =
  | "production"
  | "preview"
  | "development"
  | "test";

export type BackendEnvironmentReason =
  | "AUTHORIZED_PRODUCTION"
  | "AUTHORIZED_TEST_FIXTURE"
  | "PREVIEW_BACKEND_DISABLED"
  | "DEVELOPMENT_BACKEND_DISABLED"
  | "TEST_BACKEND_DISABLED"
  | "NON_PRODUCTION_BACKEND_REJECTED"
  | "NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED"
  | "MISSING_DEPLOYMENT_IDENTITY"
  | "MALFORMED_DEPLOYMENT_IDENTITY"
  | "CONTRADICTORY_DEPLOYMENT_IDENTITY"
  | "MISSING_PUBLIC_CONFIGURATION"
  | "MALFORMED_PUBLIC_CONFIGURATION"
  | "UNAUTHORIZED_PRODUCTION_BACKEND";

export type BackendEnvironment =
  | {
      status: "configured";
      deployment: "production";
      reason: "AUTHORIZED_PRODUCTION";
      url: string;
      anonKey: string;
    }
  | {
      status: "configured";
      deployment: "test";
      reason: "AUTHORIZED_TEST_FIXTURE";
      url: typeof TEST_FIXTURE_RUNTIME.url;
      anonKey: typeof TEST_FIXTURE_RUNTIME.anonKey;
    }
  | {
      status: "unavailable";
      deployment: DeploymentEnvironment | "unknown";
      reason: Exclude<BackendEnvironmentReason, "AUTHORIZED_PRODUCTION">;
    };

type BuildEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  NODE_ENV?: string;
  url?: string;
  anonKey?: string;
};

type BackendEnvironmentInput = {
  deployment?: string;
  serverDeployment?: string;
  url?: string;
  anonKey?: string;
};

const DEPLOYMENTS = new Set<DeploymentEnvironment>([
  "production",
  "preview",
  "development",
  "test",
]);

export function classifyBuildEnvironment(
  environment: BuildEnvironment,
): DeploymentEnvironment | "unknown" | "malformed" {
  if (environment.VERCEL_ENV !== undefined) {
    if (
      environment.VERCEL_ENV === "production" ||
      environment.VERCEL_ENV === "preview" ||
      environment.VERCEL_ENV === "development"
    ) {
      if (
        environment.VERCEL_TARGET_ENV !== undefined &&
        environment.VERCEL_TARGET_ENV !== environment.VERCEL_ENV
      ) {
        return "malformed";
      }
      return environment.VERCEL_ENV;
    }
    return "malformed";
  }
  if (environment.VERCEL_TARGET_ENV !== undefined) return "malformed";

  if (
    environment.url === TEST_FIXTURE_CONFIGURATION.url &&
    environment.anonKey === TEST_FIXTURE_CONFIGURATION.anonKey
  ) {
    return "test";
  }

  if (environment.NODE_ENV === "test") return "test";
  if (environment.NODE_ENV === "development") return "development";
  return "unknown";
}

function parseDeployment(
  value: string | undefined,
): DeploymentEnvironment | "unknown" | "malformed" {
  if (!value || value === "unknown") return "unknown";
  return DEPLOYMENTS.has(value as DeploymentEnvironment)
    ? (value as DeploymentEnvironment)
    : "malformed";
}

function parseSupabaseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.pathname !== "/" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.port
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPlausibleAnonKey(value: string): boolean {
  if (value.startsWith("sb_publishable_")) return value.length >= 32;
  const segments = value.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return false;
  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(globalThis.atob(padded)) as {
      ref?: unknown;
      role?: unknown;
    };
    return (
      payload.ref === AUTHORIZED_PRODUCTION_SUPABASE_HOST.split(".")[0] &&
      payload.role === "anon"
    );
  } catch {
    return false;
  }
}

function unavailable(
  deployment: BackendEnvironment["deployment"],
  reason: Exclude<
    BackendEnvironmentReason,
    "AUTHORIZED_PRODUCTION" | "AUTHORIZED_TEST_FIXTURE"
  >,
): BackendEnvironment {
  return { status: "unavailable", deployment, reason };
}

export function resolveBackendEnvironment(
  input: BackendEnvironmentInput,
): BackendEnvironment {
  const deployment = parseDeployment(input.deployment);
  const serverDeployment = input.serverDeployment
    ? parseDeployment(input.serverDeployment)
    : undefined;

  if (deployment === "malformed" || serverDeployment === "malformed") {
    return unavailable("unknown", "MALFORMED_DEPLOYMENT_IDENTITY");
  }
  if (deployment === "unknown") {
    return unavailable("unknown", "MISSING_DEPLOYMENT_IDENTITY");
  }
  if (
    serverDeployment !== undefined &&
    (serverDeployment === "unknown" || serverDeployment !== deployment)
  ) {
    return unavailable(deployment, "CONTRADICTORY_DEPLOYMENT_IDENTITY");
  }

  const parsedUrl = parseSupabaseUrl(input.url);
  const targetsProduction =
    parsedUrl?.hostname === AUTHORIZED_PRODUCTION_SUPABASE_HOST;

  if (
    deployment === "test" &&
    input.url === TEST_FIXTURE_CONFIGURATION.url &&
    input.anonKey === TEST_FIXTURE_CONFIGURATION.anonKey
  ) {
    return {
      status: "configured",
      deployment,
      reason: "AUTHORIZED_TEST_FIXTURE",
      ...TEST_FIXTURE_RUNTIME,
    };
  }

  if (deployment !== "production") {
    if (targetsProduction) {
      return unavailable(
        deployment,
        "NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED",
      );
    }
    if (input.url || input.anonKey) {
      return unavailable(deployment, "NON_PRODUCTION_BACKEND_REJECTED");
    }
    const reason =
      deployment === "preview"
        ? "PREVIEW_BACKEND_DISABLED"
        : deployment === "development"
          ? "DEVELOPMENT_BACKEND_DISABLED"
          : "TEST_BACKEND_DISABLED";
    return unavailable(deployment, reason);
  }

  if (!input.url || !input.anonKey) {
    return unavailable(deployment, "MISSING_PUBLIC_CONFIGURATION");
  }
  if (!parsedUrl || !isPlausibleAnonKey(input.anonKey)) {
    return unavailable(deployment, "MALFORMED_PUBLIC_CONFIGURATION");
  }
  if (!targetsProduction) {
    return unavailable(deployment, "UNAUTHORIZED_PRODUCTION_BACKEND");
  }

  return {
    status: "configured",
    deployment,
    reason: "AUTHORIZED_PRODUCTION",
    url: parsedUrl.origin,
    anonKey: input.anonKey,
  };
}
