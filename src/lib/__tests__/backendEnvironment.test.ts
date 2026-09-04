import {
  AUTHORIZED_PRODUCTION_SUPABASE_HOST,
  TEST_FIXTURE_CONFIGURATION,
  TEST_FIXTURE_RUNTIME,
  classifyBuildEnvironment,
  resolveBackendEnvironment,
} from "../backendEnvironment";

const productionUrl = `https://${AUTHORIZED_PRODUCTION_SUPABASE_HOST}`;

function publicAnonKey(overrides: Record<string, unknown> = {}) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    ref: AUTHORIZED_PRODUCTION_SUPABASE_HOST.split(".")[0],
    role: "anon",
    ...overrides,
  })}.fixture-signature`;
}

describe("backend environment isolation", () => {
  it.each([
    [{ VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" }, "preview"],
    [
      { VERCEL_ENV: "development", VERCEL_TARGET_ENV: "development" },
      "development",
    ],
    [{ NODE_ENV: "test" }, "test"],
    [{ NODE_ENV: "development" }, "development"],
    [
      {
        NODE_ENV: "production",
        url: TEST_FIXTURE_CONFIGURATION.url,
        anonKey: TEST_FIXTURE_CONFIGURATION.anonKey,
      },
      "test",
    ],
    [{ NODE_ENV: "production" }, "unknown"],
    [{}, "unknown"],
  ])("classifies build metadata %#", (environment, expected) => {
    expect(classifyBuildEnvironment(environment)).toBe(expected);
  });

  it("preserves the authorized production configuration unchanged", () => {
    const anonKey = publicAnonKey();
    expect(
      resolveBackendEnvironment({
        deployment: "production",
        serverDeployment: "production",
        url: productionUrl,
        anonKey,
      }),
    ).toEqual({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: productionUrl,
      anonKey,
    });
  });

  it("classifies preview as an explicit unavailable-data state", () => {
    expect(resolveBackendEnvironment({ deployment: "preview" })).toEqual({
      status: "unavailable",
      deployment: "preview",
      reason: "PREVIEW_BACKEND_DISABLED",
    });
  });

  it("maps the exact local test sentinel to a loopback-only fixture", () => {
    expect(
      resolveBackendEnvironment({
        deployment: "test",
        ...TEST_FIXTURE_CONFIGURATION,
      }),
    ).toEqual({
      status: "configured",
      deployment: "test",
      reason: "AUTHORIZED_TEST_FIXTURE",
      ...TEST_FIXTURE_RUNTIME,
    });
  });

  it("never treats the test sentinel as hosted deployment authority", () => {
    expect(
      classifyBuildEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
        ...TEST_FIXTURE_CONFIGURATION,
      }),
    ).toBe("preview");
    expect(
      resolveBackendEnvironment({
        deployment: "preview",
        ...TEST_FIXTURE_CONFIGURATION,
      }).reason,
    ).toBe("NON_PRODUCTION_BACKEND_REJECTED");
  });

  it.each(["preview", "development", "test"] as const)(
    "rejects the production backend in %s",
    (deployment) => {
      expect(
        resolveBackendEnvironment({
          deployment,
          url: productionUrl,
          anonKey: publicAnonKey(),
        }),
      ).toEqual({
        status: "unavailable",
        deployment,
        reason: "NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED",
      });
    },
  );

  it.each(["preview", "development", "test"] as const)(
    "rejects any hosted backend in %s",
    (deployment) => {
      expect(
        resolveBackendEnvironment({
          deployment,
          url: "https://fixture.invalid.example",
          anonKey: "fixture",
        }).reason,
      ).toBe("NON_PRODUCTION_BACKEND_REJECTED");
    },
  );

  it("fails closed for missing and contradictory deployment identity", () => {
    expect(resolveBackendEnvironment({}).reason).toBe(
      "MISSING_DEPLOYMENT_IDENTITY",
    );
    expect(
      resolveBackendEnvironment({
        deployment: "preview",
        serverDeployment: "production",
      }).reason,
    ).toBe("CONTRADICTORY_DEPLOYMENT_IDENTITY");
  });

  it("rejects malformed deployment metadata", () => {
    expect(resolveBackendEnvironment({ deployment: "other" }).reason).toBe(
      "MALFORMED_DEPLOYMENT_IDENTITY",
    );
    expect(
      classifyBuildEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "other",
        NODE_ENV: "production",
      }),
    ).toBe("malformed");
  });

  it.each([
    [`${productionUrl}:444`, publicAnonKey()],
    [`${productionUrl}/rest`, publicAnonKey()],
    [productionUrl, "a.b.c"],
    [productionUrl, publicAnonKey({ role: "service_role" })],
    [productionUrl, publicAnonKey({ ref: "different-project" })],
  ])("rejects malformed production public configuration", (url, anonKey) => {
    expect(
      resolveBackendEnvironment({
        deployment: "production",
        url,
        anonKey,
      }).reason,
    ).toBe("MALFORMED_PUBLIC_CONFIGURATION");
  });

  it("keeps browser and server decisions identical for valid production", () => {
    const input = {
      deployment: "production",
      url: productionUrl,
      anonKey: publicAnonKey(),
    };
    expect(resolveBackendEnvironment(input)).toEqual(
      resolveBackendEnvironment({ ...input, serverDeployment: "production" }),
    );
  });
});
