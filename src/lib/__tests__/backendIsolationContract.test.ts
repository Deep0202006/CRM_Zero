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
      .filter((file) =>
        /\bcreateClient\s*\(/.test(source(path.relative(process.cwd(), file))),
      )
      .map((file) => path.normalize(path.relative(process.cwd(), file)))
      .filter((file) => !approved.has(file));
    expect(offenders).toEqual([]);
  });

  it("keeps direct Supabase configuration reads inside browser/server boundaries", () => {
    const approved = new Set([
      path.normalize("src/lib/serverBackendEnvironment.ts"),
      path.normalize("src/lib/serverBackendIdentity.ts"),
      path.normalize("src/lib/supabaseClient.ts"),
    ]);
    const offenders = runtimeTypeScriptFiles(path.join(process.cwd(), "src"))
      .filter((file) =>
        /process\.env\.(?:NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE_KEY)/.test(
          source(path.relative(process.cwd(), file)),
        ),
      )
      .map((file) => path.normalize(path.relative(process.cwd(), file)))
      .filter((file) => !approved.has(file));
    expect(offenders).toEqual([]);
  });

  it("keeps privileged configuration outside the client graph", () => {
    for (const file of [
      "src/lib/backendEnvironment.ts",
      "src/lib/supabaseClient.ts",
      "src/components/BackendEnvironmentBoundary.tsx",
      "src/context/AuthContext.tsx",
      "next.config.ts",
    ]) {
      expect(source(file)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source(file)).not.toContain("serverBackendEnvironment");
    }
    expect(source("src/lib/supabaseClient.ts")).toContain(
      'import "client-only"',
    );
    expect(source("src/lib/serverBackendEnvironment.ts")).toContain(
      'import "server-only"',
    );
  });

  it("removes Proxy source, tests, contract claims, and domain-map entries", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/proxy.ts"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(process.cwd(), "src/lib/__tests__/backendProxy.test.ts"),
      ),
    ).toBe(false);
    expect(source("docs/contracts/BACKEND_ENVIRONMENT_ISOLATION.md")).not.toMatch(
      /\bProxy\b/,
    );
    expect(source("docs/engineering/DOMAIN_MAP.json")).not.toContain(
      "backendProxy.test.ts",
    );
  });

  it("does not commit deployment-agnostic public backend values", () => {
    const vercelSource = source("vercel.json");
    expect(vercelSource).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(vercelSource).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("renders only sanitized unavailable copy before authenticated CRM providers", () => {
    const boundary = source("src/components/BackendEnvironmentBoundary.tsx");
    const layout = source("src/app/layout.tsx");
    expect(boundary).toContain("Preview workspace");
    expect(boundary).toContain(
      "This preview is intentionally disconnected from live CRM data. Sign-in and data actions are unavailable.",
    );
    expect(boundary).toContain("CRM unavailable");
    expect(boundary).toContain(
      "This environment cannot securely connect to CRM data. Please contact your administrator.",
    );
    expect(boundary).toContain('role="status"');
    expect(boundary.indexOf('status !== "configured"')).toBeLessThan(
      boundary.indexOf("<AuthorizedCrmShell>"),
    );
    expect(layout).not.toContain("AuthProvider");
    expect(layout).not.toContain("DashboardLayout");
    expect(boundary).not.toMatch(/setTimeout|setInterval|localStorage|indexedDB/);
  });

  it("keeps unavailable auth closed without reading, deleting, or overwriting local CRM state", () => {
    const auth = source("src/context/AuthContext.tsx");
    const unavailableStart = auth.indexOf("if (!isSupabaseConfigured)");
    const firstDatabaseRead = auth.indexOf("const users = await db.users.toArray()");
    const unavailableBranch = auth.slice(unavailableStart, firstDatabaseRead);
    expect(unavailableBranch).not.toMatch(/\bdb\.|localStorage|sync|queue/i);
    expect(unavailableBranch).toContain("setCurrentUser(null)");
    expect(unavailableBranch).toContain("setCapabilities([])");
  });

  it("uses one sanitized 503 body at direct server factories", () => {
    const serverBoundary = source("src/lib/serverBackendEnvironment.ts");
    expect(serverBoundary).toContain('{ error: "CRM_UNAVAILABLE" }');
    const reasonLeaks = runtimeTypeScriptFiles(path.join(process.cwd(), "src/app/api"))
      .map((file) => source(path.relative(process.cwd(), file)))
      .filter((contents) => /Result\.reason|backend_reason/.test(contents));
    expect(reasonLeaks).toEqual([]);
  });

  it("routes every direct server Supabase handler through an authorized factory", () => {
    const apiRoot = path.join(process.cwd(), "src/app/api");
    const offenders = runtimeTypeScriptFiles(apiRoot)
      .filter((file) => path.basename(file) === "route.ts")
      .filter((file) => {
        const contents = source(path.relative(process.cwd(), file));
        return /\.(?:auth|storage)\b|(?<!Array|Buffer)\.from\(/.test(contents);
      })
      .filter((file) => {
        const contents = source(path.relative(process.cwd(), file));
        return !/serverBackendEnvironment|contextFor|createPipelineServerContext|requireChatContext/.test(
          contents,
        );
      })
      .map((file) => path.normalize(path.relative(process.cwd(), file)));
    expect(offenders).toEqual([]);
  });
});
