import {
  AUTHORIZED_PRODUCTION_SUPABASE_URL,
  TEST_FIXTURE_CONFIGURATION,
  TEST_FIXTURE_RUNTIME,
  classifyBuildEnvironment,
  resolveBackendEnvironment,
} from "../backendEnvironment";

function publicAnonKey(overrides: Record<string, unknown> = {}) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    ref: "gwfjkpsoaoherntwhdyf",
    role: "anon",
    ...overrides,
  })}.c2lnbmF0dXJl`;
}

const production = {
  deployment: "production",
  serverDeployment: "production" as const,
  url: AUTHORIZED_PRODUCTION_SUPABASE_URL,
  anonKey: publicAnonKey(),
};

describe("backend environment authority", () => {
  it("authorizes only the exact agreeing Production identity and configuration", () => {
    expect(resolveBackendEnvironment(production)).toEqual({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: AUTHORIZED_PRODUCTION_SUPABASE_URL,
      anonKey: production.anonKey,
    });
  });

  it.each([
    { ...production, url: undefined },
    { ...production, anonKey: undefined },
  ])("fails closed when Production public configuration is missing", (input) => {
    expect(resolveBackendEnvironment(input).status).toBe("unavailable");
  });

  it.each([
    ["http://gwfjkpsoaoherntwhdyf.supabase.co", publicAnonKey()],
    ["https://foreign.supabase.co", publicAnonKey()],
    [`${AUTHORIZED_PRODUCTION_SUPABASE_URL}/rest`, publicAnonKey()],
    [AUTHORIZED_PRODUCTION_SUPABASE_URL, "not-a-jwt"],
    [AUTHORIZED_PRODUCTION_SUPABASE_URL, publicAnonKey({ ref: "foreign" })],
    [AUTHORIZED_PRODUCTION_SUPABASE_URL, publicAnonKey({ role: "authenticated" })],
    [AUTHORIZED_PRODUCTION_SUPABASE_URL, publicAnonKey({ role: "service_role" })],
  ])("rejects invalid Production URL or legacy public JWT %#", (url, anonKey) => {
    expect(
      resolveBackendEnvironment({ ...production, url, anonKey }).status,
    ).toBe("unavailable");
  });

  it("does not claim signature verification and rejects malformed JWT syntax", () => {
    expect(
      resolveBackendEnvironment({
        ...production,
        anonKey: "e30.e30.not+base64url",
      }).status,
    ).toBe("unavailable");
  });

  it("rejects shape-only opaque publishable keys without repository fingerprint authority", () => {
    expect(
      resolveBackendEnvironment({
        ...production,
        anonKey: `sb_publishable_${"x".repeat(80)}`,
      }).status,
    ).toBe("unavailable");
  });

  it("fails closed for contradictory build/runtime identity", () => {
    expect(
      resolveBackendEnvironment({
        ...production,
        serverDeployment: "preview",
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "CONTRADICTORY_DEPLOYMENT_IDENTITY",
    });
  });

  it.each(["preview", "development", "custom", "unknown"] as const)(
    "keeps %s unavailable with production-looking values",
    (deployment) => {
      expect(
        resolveBackendEnvironment({ ...production, deployment, serverDeployment: deployment }),
      ).toMatchObject({ status: "unavailable", deployment });
    },
  );

  it("recognizes custom, unknown, and contradictory Vercel identities", () => {
    expect(
      classifyBuildEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "qa",
      }),
    ).toBe("custom");
    expect(classifyBuildEnvironment({ VERCEL_TARGET_ENV: "preview" })).toBe(
      "unknown",
    );
    expect(
      classifyBuildEnvironment({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe("contradictory");
  });

  it("authorizes the loopback fixture only under NODE_ENV=test without Vercel metadata", () => {
    const sentinel = { NODE_ENV: "test", ...TEST_FIXTURE_CONFIGURATION };
    expect(classifyBuildEnvironment(sentinel)).toBe("test");
    expect(
      resolveBackendEnvironment({
        deployment: classifyBuildEnvironment(sentinel),
        ...TEST_FIXTURE_CONFIGURATION,
      }),
    ).toEqual({
      status: "configured",
      deployment: "test",
      reason: "AUTHORIZED_TEST_FIXTURE",
      ...TEST_FIXTURE_RUNTIME,
    });
    expect(
      classifyBuildEnvironment({ NODE_ENV: "production", ...TEST_FIXTURE_CONFIGURATION }),
    ).toBe("unknown");
    expect(
      classifyBuildEnvironment({
        NODE_ENV: "test",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
        ...TEST_FIXTURE_CONFIGURATION,
      }),
    ).toBe("preview");
  });

  it("never authorizes a hosted endpoint for test", () => {
    expect(
      resolveBackendEnvironment({
        deployment: "test",
        url: AUTHORIZED_PRODUCTION_SUPABASE_URL,
        anonKey: publicAnonKey(),
      }).status,
    ).toBe("unavailable");
  });

  it("keeps browser and server decision tables aligned", () => {
    const browser = resolveBackendEnvironment({
      deployment: production.deployment,
      url: production.url,
      anonKey: production.anonKey,
    });
    expect(resolveBackendEnvironment(production)).toEqual(browser);
  });
});
