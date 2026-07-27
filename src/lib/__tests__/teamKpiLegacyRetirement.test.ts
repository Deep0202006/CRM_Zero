import fs from "fs";
import path from "path";

describe("legacy KPI path retirement", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/026_team_kpi_repair.sql"),
    "utf8",
  );
  const dbSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/db.ts"),
    "utf8",
  );

  it("stops obsolete snapshot triggers without deleting historical snapshot data", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS on_mapping_request_completed");
    expect(migration).toContain("DROP TRIGGER IF EXISTS on_client_query_resolved");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.update_kpi_mapping_request()");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.update_kpi_client_queries()");
    expect(migration).not.toContain("DROP TABLE");
  });

  it("does not pull or subscribe to KPI snapshots in the active sync path", () => {
    const pullDownSection = dbSource.slice(
      dbSource.indexOf("export async function pullDownSync"),
      dbSource.indexOf("// ─────────────────────────────────────────────────────────────────────────────\n// AUTO SYNC"),
    );
    expect(pullDownSection).not.toContain('"kpi_daily_snapshot"');

    const realtimeSection = dbSource.slice(
      dbSource.indexOf("const validTables = ["),
    );
    expect(realtimeSection).not.toContain('"kpi_snapshots"');
  });
});
