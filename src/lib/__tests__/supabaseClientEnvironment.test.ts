const createClient = jest.fn((url: string, key: string, options?: unknown) => ({
  url,
  key,
  options,
}));

jest.mock("@supabase/supabase-js", () => ({ createClient }));

const host = "gwfjkpsoaoherntwhdyf.supabase.co";
const productionUrl = `https://${host}`;

function publicAnonKey() {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ ref: host.split(".")[0], role: "anon" })}.fixture`;
}

describe("browser Supabase client selection", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
    createClient.mockClear();
  });

  it("uses the authorized production public values unchanged", async () => {
    const anonKey = publicAnonKey();
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = productionUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
    await jest.isolateModulesAsync(async () => {
      const clientModule = (await import("../supabaseClient")) as {
        isSupabaseConfigured: boolean;
      };
      expect(clientModule.isSupabaseConfigured).toBe(true);
    });
    expect(createClient.mock.calls[0]?.slice(0, 2)).toEqual([
      productionUrl,
      anonKey,
    ]);
  });

  it("uses a zero-network unavailable client for preview", async () => {
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "preview";
    process.env.NEXT_PUBLIC_SUPABASE_URL = productionUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = publicAnonKey();
    let configured = true;
    await jest.isolateModulesAsync(async () => {
      configured = ((await import("../supabaseClient")) as {
        isSupabaseConfigured: boolean;
      }).isSupabaseConfigured;
    });
    expect(configured).toBe(false);
    const options = createClient.mock.calls[0]?.[2] as {
      auth: Record<string, boolean>;
      global: { fetch: () => Promise<never> };
    };
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    await expect(options.global.fetch()).rejects.toThrow(
      "BACKEND_UNAVAILABLE:NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED",
    );
  });

  it("maps the test sentinel to a loopback-only public client", async () => {
    process.env.NEXT_PUBLIC_ZERODATA_DEPLOYMENT_ENV = "test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://e2e.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "e2e-anon-key";
    await jest.isolateModulesAsync(async () => {
      const clientModule = (await import("../supabaseClient")) as {
        isSupabaseConfigured: boolean;
      };
      expect(clientModule.isSupabaseConfigured).toBe(true);
    });
    expect(createClient.mock.calls[0]?.slice(0, 2)).toEqual([
      "http://127.0.0.1:54321",
      "zerodata-local-test-fixture",
    ]);
  });
});
