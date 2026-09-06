export const AUTHORIZED_PRODUCTION_SUPABASE_URL =
  "https://gwfjkpsoaoherntwhdyf.supabase.co";
export const AUTHORIZED_PRODUCTION_SUPABASE_HOST =
  "gwfjkpsoaoherntwhdyf.supabase.co";
export const AUTHORIZED_PRODUCTION_PROJECT_REF = "gwfjkpsoaoherntwhdyf";

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

export type DeploymentIdentity =
  | DeploymentEnvironment
  | "custom"
  | "unknown"
  | "contradictory";

export type BackendEnvironmentReason =
  | "AUTHORIZED_PRODUCTION"
  | "AUTHORIZED_TEST_FIXTURE"
  | "PREVIEW_BACKEND_DISABLED"
  | "DEVELOPMENT_BACKEND_DISABLED"
  | "TEST_BACKEND_DISABLED"
  | "CUSTOM_BACKEND_DISABLED"
  | "UNKNOWN_BACKEND_DISABLED"
  | "CONTRADICTORY_DEPLOYMENT_IDENTITY"
  | "NON_PRODUCTION_BACKEND_REJECTED"
  | "MISSING_PUBLIC_CONFIGURATION"
  | "MALFORMED_PUBLIC_CONFIGURATION"
  | "UNAUTHORIZED_PRODUCTION_BACKEND";

export type BackendEnvironment =
  | {
      status: "configured";
      deployment: "production";
      reason: "AUTHORIZED_PRODUCTION";
      url: typeof AUTHORIZED_PRODUCTION_SUPABASE_URL;
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
      deployment: DeploymentIdentity;
      reason: Exclude<
        BackendEnvironmentReason,
        "AUTHORIZED_PRODUCTION" | "AUTHORIZED_TEST_FIXTURE"
      >;
    };

export type DeploymentIdentityInput = {
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  NODE_ENV?: string;
  url?: string;
  anonKey?: string;
};

export type BackendEnvironmentInput = {
  deployment?: string;
  serverDeployment?: DeploymentIdentity;
  url?: string;
  anonKey?: string;
};

const STANDARD_VERCEL_ENVIRONMENTS = new Set([
  "production",
  "preview",
  "development",
]);

export function classifyBuildEnvironment(
  environment: DeploymentIdentityInput,
): DeploymentIdentity {
  const vercelEnv = environment.VERCEL_ENV;
  const targetEnv = environment.VERCEL_TARGET_ENV;

  if (vercelEnv !== undefined || targetEnv !== undefined) {
    if (
      (vercelEnv !== undefined &&
        !STANDARD_VERCEL_ENVIRONMENTS.has(vercelEnv)) ||
      (targetEnv !== undefined &&
        !STANDARD_VERCEL_ENVIRONMENTS.has(targetEnv))
    ) {
      return "custom";
    }
    if (!vercelEnv) return "unknown";
    if (targetEnv && targetEnv !== vercelEnv) return "contradictory";
    return vercelEnv as Exclude<DeploymentEnvironment, "test">;
  }

  if (
    environment.NODE_ENV === "test" &&
    environment.url === TEST_FIXTURE_CONFIGURATION.url &&
    environment.anonKey === TEST_FIXTURE_CONFIGURATION.anonKey
  ) {
    return "test";
  }
  if (environment.NODE_ENV === "development") return "development";
  return "unknown";
}

function parseDeployment(value: string | undefined): DeploymentIdentity {
  switch (value) {
    case "production":
    case "preview":
    case "development":
    case "test":
    case "custom":
    case "unknown":
    case "contradictory":
      return value;
    default:
      return "unknown";
  }
}

function decodeBase64UrlJson(value: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded)) as unknown;
    return decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isAuthorizedLegacyAnonJwt(value: string): boolean {
  const segments = value.split(".");
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) =>
        !segment ||
        !/^[A-Za-z0-9_-]+$/.test(segment) ||
        segment.length % 4 === 1,
    )
  ) {
    return false;
  }
  const header = decodeBase64UrlJson(segments[0]);
  const payload = decodeBase64UrlJson(segments[1]);
  return Boolean(
    header &&
      payload &&
      payload.ref === AUTHORIZED_PRODUCTION_PROJECT_REF &&
      payload.role === "anon",
  );
}

function isAuthorizedPublicKey(value: string): boolean {
  // No exact publishable-key SHA-256 fingerprint exists in repository authority.
  // Opaque sb_publishable_* keys therefore remain unavailable by design.
  if (value.startsWith("sb_publishable_")) return false;
  return isAuthorizedLegacyAnonJwt(value);
}

function unavailable(
  deployment: DeploymentIdentity,
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
  const serverDeployment = input.serverDeployment;

  if (
    deployment === "contradictory" ||
    serverDeployment === "contradictory" ||
    (serverDeployment !== undefined && serverDeployment !== deployment)
  ) {
    return unavailable(deployment, "CONTRADICTORY_DEPLOYMENT_IDENTITY");
  }

  if (deployment === "preview") {
    return unavailable(deployment, "PREVIEW_BACKEND_DISABLED");
  }
  if (deployment === "development") {
    return unavailable(deployment, "DEVELOPMENT_BACKEND_DISABLED");
  }
  if (deployment === "custom") {
    return unavailable(deployment, "CUSTOM_BACKEND_DISABLED");
  }
  if (deployment === "unknown") {
    return unavailable(deployment, "UNKNOWN_BACKEND_DISABLED");
  }

  if (deployment === "test") {
    if (
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
    return unavailable(
      deployment,
      input.url || input.anonKey
        ? "NON_PRODUCTION_BACKEND_REJECTED"
        : "TEST_BACKEND_DISABLED",
    );
  }

  if (!input.url || !input.anonKey) {
    return unavailable(deployment, "MISSING_PUBLIC_CONFIGURATION");
  }
  if (input.url !== AUTHORIZED_PRODUCTION_SUPABASE_URL) {
    return unavailable(deployment, "UNAUTHORIZED_PRODUCTION_BACKEND");
  }
  if (!isAuthorizedPublicKey(input.anonKey)) {
    return unavailable(deployment, "MALFORMED_PUBLIC_CONFIGURATION");
  }

  return {
    status: "configured",
    deployment,
    reason: "AUTHORIZED_PRODUCTION",
    url: AUTHORIZED_PRODUCTION_SUPABASE_URL,
    anonKey: input.anonKey,
  };
}
