import fs from "fs";
import path from "path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function runtimeTypeScriptFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : runtimeTypeScriptFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("backend isolation source contract", () => {
  it("centralizes every runtime Supabase client construction", () => {
    const approved = new Set([
      path.normalize("src/lib/serverBackendEnvironment.ts"),
      path.normalize("src/lib/supabaseClient.ts"),
    ]);
    const offenders = runtimeTypeScriptFiles(path.join(process.cwd(), "src"))
      .filter((file) => /\bcreateClient\s*\(/.test(source(path.relative(process.cwd(), file))))
      .map((file) => path.normalize(path.relative(process.cwd(), file)))
      .filter((file) => !approved.has(file));
    expect(offenders).toEqual([]);
  });

  it("keeps direct Supabase environment reads inside the three boundaries", () => {
    const approved = new Set([
      path.normalize("src/lib/serverBackendEnvironment.ts"),
      path.normalize("src/lib/serverBackendIdentity.ts"),
      path.normalize("src/lib/supabaseClient.ts"),
    ]);
    const offenders = runtimeTypeScriptFiles(path.join(process.cwd(), "src"))
      .filter((file) => /process\.env\.(?:NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE_KEY)/.test(source(path.relative(process.cwd(), file))))
      .map((file) => path.normalize(path.relative(process.cwd(), file)))
      .filter((file) => !approved.has(file));
    expect(offenders).toEqual([]);
  });

  it("keeps privileged configuration out of browser and proxy graphs", () => {
    for (const file of [
      "src/lib/backendEnvironment.ts",
      "src/lib/supabaseClient.ts",
      "src/proxy.ts",
      "next.config.ts",
    ]) {
      expect(source(file)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
    expect(source("src/proxy.ts")).not.toContain("serverBackendEnvironment");
    expect(source("src/lib/serverBackendEnvironment.ts")).toContain(
      'import "server-only"',
    );
  });

  it("does not commit deployment-agnostic public backend values", () => {
    const vercelSource = source("vercel.json");
    expect(vercelSource).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(vercelSource).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("keeps unavailable authentication closed and preserves queued ownership", () => {
    const auth = source("src/context/AuthContext.tsx");
    expect(auth).toContain("if (!isSupabaseConfigured)");
    expect(auth).toContain('localStorage.setItem("zerodata_outbox_owner_id", savedUserId)');
    expect(auth).toContain("setCurrentUser(null)");
    expect(auth).toContain("setCapabilities([])");
    expect(auth).toContain("setIsLoading(false)");
  });
});
