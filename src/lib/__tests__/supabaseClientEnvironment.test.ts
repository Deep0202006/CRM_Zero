jest.mock("client-only", () => ({}), { virtual: true });

const createClient = jest.fn((url: string, key: string) => ({ url, key }));
jest.mock("@supabase/supabase-js", () => ({ createClient }));

const productionUrl = "https://gwfjkpsoaoherntwhdyf.supabase.co";

function publicAnonKey() {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ ref: "gwfjkpsoaoherntwhdyf", role: "anon" })}.c2lnbmF0dXJl`;
}

describe("browser Supabase client selection", () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.resetModules();
    createClient.mockClear();
  });

  it("constructs one singleton only after authorized Production access", async () => {
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = productionUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = publicAnonKey();
    await jest.isolateModulesAsync(async () => {
      const clientModule = await import("../supabaseClient");
      expect(clientModule.isSupabaseConfigured).toBe(true);
      expect(createClient).not.toHaveBeenCalled();
      expect(clientModule.getBrowserSupabaseClient()).toBe(
        clientModule.getBrowserSupabaseClient(),
      );
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("constructs no client and exposes no internal reason in Preview", async () => {
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "preview";
    process.env.NEXT_PUBLIC_SUPABASE_URL = productionUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = publicAnonKey();
    await jest.isolateModulesAsync(async () => {
      const clientModule = await import("../supabaseClient");
      expect(clientModule.isSupabaseConfigured).toBe(false);
      expect(clientModule.getBrowserSupabaseClient()).toBeNull();
      expect(() => clientModule.supabase.auth).toThrow("CRM_UNAVAILABLE");
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("maps the exact test classification and sentinel to loopback", async () => {
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://e2e.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "e2e-anon-key";
    await jest.isolateModulesAsync(async () => {
      const clientModule = await import("../supabaseClient");
      expect(clientModule.getBrowserSupabaseClient()).toEqual({
        url: "http://127.0.0.1:54321",
        key: "zerodata-local-test-fixture",
      });
    });
  });
});
