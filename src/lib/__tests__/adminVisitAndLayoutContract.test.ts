import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("admin visit authorization and responsive layout", () => {
  it("requires bearer authentication and rejects ordinary users", () => {
    const route = read("src/app/api/admin/visits/route.ts");
    const page = read("src/app/admin/visits/page.tsx");
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain('authorization.startsWith("Bearer ")');
    expect(route).not.toContain('searchParams.get("token")');
    expect(route).toContain('errorResponse(403, "Administrator access required.")');
    expect(page).toContain("Authorization: `Bearer ${token}`");
  });

  it("paginates by 50 and signs evidence only after View Selfie is clicked", () => {
    const route = read("src/app/api/admin/visits/route.ts");
    const page = read("src/app/admin/visits/page.tsx");
    const evidence = read("src/app/api/admin/visits/evidence/route.ts");
    expect(route).toContain("const PAGE_SIZE = 50");
    expect(route).toContain(".range((page - 1) * PAGE_SIZE");
    expect(page).toContain("View Selfie");
    expect(evidence).toContain("createSignedUrl");
    expect(evidence).toContain('select("is_active")');
    expect(evidence).toContain("capabilityError");
    expect(route).not.toContain("createSignedUrl");
    expect(route).toContain('in("capability_code", ["field_ret", "field_dist"])');
    expect(route).toContain("loadHistoricalRepresentativeIds");
    expect(route).toContain("Representative directory is temporarily unavailable.");
  });

  it("wraps identity, capability labels, and a separate action region", () => {
    const admin = read("src/app/admin/page.tsx");
    const capabilitySection = admin.slice(
      admin.indexOf('activeTab === "capabilities"'),
      admin.indexOf('activeTab === "managers"'),
    );
    expect(capabilitySection).toContain("grid min-w-0 gap-4");
    expect(capabilitySection).toContain("minmax(0,0.7fr)");
    expect(capabilitySection).toContain("minmax(0,2fr)");
    expect(capabilitySection).toContain("whitespace-normal break-words");
    expect(capabilitySection).toContain("whitespace-normal break-all");
    expect(capabilitySection).toContain("flex min-w-0 flex-wrap gap-2");
    expect(capabilitySection).not.toContain("min-w-[220px]");
  });

  it("adds no destructive browser or business-data operation to visit workflows", () => {
    const sources = [
      "src/lib/fieldVisits/repository.ts",
      "src/lib/fieldVisits/sync.ts",
      "src/app/visits/page.tsx",
      "src/app/api/admin/visits/route.ts",
    ].map(read).join("\n");
    expect(sources).not.toMatch(/\bTRUNCATE\b/i);
    expect(sources).not.toContain(".clear()");
    expect(sources).not.toContain("deleteDatabase");
    expect(sources).not.toMatch(/\.from\(["']field_visits["']\)\s*\.delete\(/);
  });
});
